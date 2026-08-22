/**
 * The definition's pure fold logic, split from the cordis-adjacent register
 * helper so unit tests exercise it without a cordis context. DSH types are
 * imported type-only (erased at runtime); the parser is the shared
 * validation boundary.
 */
import type { ChatConversationViewNode, ConversationMatch, ConversationNodeContext } from '@deepseek-ai/dsh-client-runtime/client'
import { parseChartSpec, type ChartSpec } from '../chartspec.ts'

/** The kind this plugin renders under (dispatch key of the chat node seat). */
export const VISUALIZER_KIND = 'visualizer-chart'

/** The tool name this plugin owns (must match the host half tool). */
export const VISUALIZE_TOOL = 'visualize'

/** Chat payload published for one visualized call. */
export interface VisualizerChartData {
  readonly spec: ChartSpec
  /** Durable tool identity the node anchors next to. */
  readonly callId: string
}

/** Definition-local fold state. */
export interface VisualizerState {
  readonly callId: string
  readonly spec: ChartSpec | undefined
}

/**
 * Read the first text block of a settled tool result.
 *
 * The durable shape is nested: `message.content[0]` is a `tool-result` block
 * whose own `content` array carries the real blocks, and our host tool emits
 * `[{ type: 'text', text: <spec JSON> }]` there. Walk both levels (outer
 * blocks + tool-result inner blocks) so shape drift on either level degrades
 * to "no text" instead of a broken render.
 * @param match - folded match.
 * @returns text content, when present.
 */
export function resultText(match: ConversationMatch): string | undefined {
  if (match.event.type !== 'tool/result') return undefined
  const message = match.event.data['message']
  if (message === null || typeof message !== 'object') return undefined
  const blocks = (message as { content?: unknown })['content']
  if (!Array.isArray(blocks)) return undefined
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; content?: unknown; text?: unknown }
    // Direct text block (flat shape) or tool-result inner content (the
    // durable shape) are both accepted.
    if (record['type'] === 'text' && typeof record['text'] === 'string') return record['text']
    if (record['type'] !== 'tool-result') continue
    const inner = record['content']
    if (!Array.isArray(inner)) continue
    for (const candidate of inner) {
      if (candidate !== null && typeof candidate === 'object') {
        const innerBlock = candidate as { type?: unknown; text?: unknown }
        if (innerBlock['type'] === 'text' && typeof innerBlock['text'] === 'string') {
          return innerBlock['text']
        }
      } else if (typeof candidate === 'string') {
        return candidate
      }
    }
  }
  return undefined
}

/**
 * Parse a result's JSON text into a validated ChartSpec.
 *
 * The host tool's canonical value is `{ spec: ChartSpec }` and its render
 * emits the whole envelope as text, so the parsed root may wrap the spec in
 * a `spec` key. Accept both the bare spec and the one-level envelope (a
 * stray envelope from a hand-written producer degrades to undefined — never
 * to a broken render).
 * @param match - folded tool/result match.
 * @returns validated spec, or undefined on any parse/validation failure.
 */
export function specFromResult(match: ConversationMatch): ChartSpec | undefined {
  const text = resultText(match)
  if (text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  // Unwrap the canonical `{ spec: ... }` envelope emitted by the host tool.
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    const nested = record['spec']
    if (nested !== null && typeof nested === 'object') parsed = nested
  }
  const result = parseChartSpec(parsed)
  return result.ok ? result.spec : undefined
}

/**
 * Definition-local id: the call's durable id. `tool/call` is gated on the
 * `visualize` name (only our calls may start a Context); `tool/result`
 * matches by callId, and an orphan result without a start can never build a
 * node — the engine requires a start for a Context body.
 * @param event - raw session event.
 * @returns id, when this event belongs to a visualizer call.
 */
export function callIdOf(event: {
  type: string
  data: Record<string, unknown> & { callId?: unknown }
}): string | undefined {
  if (event.type === 'tool/call' && event.data['name'] === VISUALIZE_TOOL) {
    return typeof event.data['callId'] === 'string' && event.data['callId'] !== ''
      ? event.data['callId']
      : undefined
  }
  if (event.type === 'tool/result') {
    const message = event.data['message']
    if (message === null || typeof message !== 'object') return undefined
    const source = (message as { source?: { callId?: unknown } })['source']
    const id = source?.callId
    return typeof id === 'string' && id !== '' ? id : undefined
  }
  return undefined
}

/**
 * Rebuild state from result-only matches (start outside the loaded window).
 * @param context - assembled context.
 * @returns recovered state, when a result carries a valid spec.
 */
export function fallbackState(
  context: ConversationNodeContext<VisualizerState>,
): VisualizerState | undefined {
  for (const match of context.matches) {
    if (match.event.type !== 'tool/result') continue
    const id = callIdOf(match.event)
    const spec = specFromResult(match)
    if (id !== undefined && spec !== undefined) return { callId: id, spec }
  }
  return undefined
}

/**
 * Materialize the chat node, or null while no valid spec is folded yet.
 * @param context - assembled context.
 * @returns final node.
 */
export function buildVisualizerViewNode(
  context: ConversationNodeContext<VisualizerState>,
): ChatConversationViewNode | null {
  const fallback = context.state === undefined ? fallbackState(context) : undefined
  const spec = context.state?.spec ?? fallback?.spec
  const callId = context.state?.callId ?? fallback?.callId
  if (spec === undefined || callId === undefined) return null
  return {
    key: context.key,
    kind: VISUALIZER_KIND,
    id: context.id,
    target: 'chat',
    anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
    location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data: { spec, callId } satisfies VisualizerChartData,
  }
}
