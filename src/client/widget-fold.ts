/**
 * The `visualizer-widget` definition's pure fold logic, split from the
 * cordis-adjacent register helper so unit tests exercise it without a cordis
 * context. DSH types are imported type-only (erased at runtime); the widget
 * contract in ../widget.ts is the shared validation boundary.
 *
 * Two independent sources fold into the same node kind:
 *
 * - `stream`: model text fences (` ```svg ` / ` ```html `) inside the step's
 *   `assistant/chunk` text deltas — fed incrementally through WidgetScanner
 *   so the node republishes live while the model is still writing;
 * - `tool`: a `visualize` call whose settled `tool/result` carries a
 *   validated WidgetSpec — one complete widget per call.
 *
 * Determinism: `match` reads only the current event, every event of one
 * Context carries or derives the same stable id (`step:<turn>:<step>` for
 * streams, `widget:<callId>` for tool calls), and `update` folds one Match
 * into State in log order — replayable by seq like every built-in
 * Definition.
 */
import type {
  ChatConversationViewNode, ConversationMatch, ConversationNodeContext,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  EMPTY_SCANNER,
  MAX_NODE_WIDGET_BYTES,
  MAX_WIDGETS_PER_NODE,
  finishScanner,
  parseWidgetSpec,
  pushScannerText,
  utf8ByteLength,
  type WidgetAcc,
  type WidgetScannerState,
  type WidgetSpec,
} from '../widget.ts'
import { callIdOf, resultText } from './visualizer-fold.ts'

/** The kind this plugin renders under (dispatch key of the chat node seat). */
export const WIDGET_KIND = 'visualizer-widget'

/** How the widgets in one node arrived (badge + copy in the renderer). */
export type WidgetSource = 'stream' | 'tool'

/** Chat payload published for one widget node. */
export interface VisualizerWidgetData {
  readonly widgets: readonly WidgetAcc[]
  readonly source: WidgetSource
  /** Durable tool identity when source is 'tool'. */
  readonly callId?: string
  /** Widgets omitted by the per-node count/byte caps. */
  readonly dropped: number
}

/** Definition-local fold state. */
export interface WidgetContextState {
  readonly source: WidgetSource
  readonly callId?: string
  readonly turn: number
  readonly step: number
  readonly scan: WidgetScannerState
  /** Settled accs: tool-delivered widgets, or finalized stream widgets. */
  readonly widgets: readonly WidgetAcc[]
  /** True once the step settled (final message/step end) — no further folds. */
  readonly settled: boolean
}

/** Build the stable id a step-scoped stream event belongs to. */
function stepId(turn: unknown, step: unknown): string | undefined {
  if (typeof turn !== 'number' || typeof step !== 'number') return undefined
  if (!Number.isSafeInteger(turn) || !Number.isSafeInteger(step)) return undefined
  if (turn < 0 || step < 0) return undefined
  return `step:${turn}:${step}`
}

/**
 * Definition-local identity for one raw session event.
 * @param event - raw session event.
 * @returns `{ id, role }`, or null when the event does not belong to this
 *   definition.
 */
export function widgetMatchOf(event: {
  type: string
  data: Record<string, unknown>
}): { readonly id: string; readonly role: 'start' | 'update' } | null {
  switch (event.type) {
    case 'step/start': {
      const id = stepId(event.data['turn'], event.data['step'])
      return id === undefined ? null : { id, role: 'start' }
    }
    case 'assistant/chunk':
    case 'assistant/message':
    case 'step/end':
    case 'llm/retry': {
      const id = stepId(event.data['turn'], event.data['step'])
      return id === undefined ? null : { id, role: 'update' }
    }
    case 'tool/call': {
      if (event.data['name'] !== 'visualize') return null
      const callId = event.data['callId']
      if (typeof callId !== 'string' || callId === '') return null
      return { id: `widget:${callId}`, role: 'start' }
    }
    case 'tool/result': {
      const id = callIdOf(event)
      if (id === undefined) return null
      return { id: `widget:${id}`, role: 'update' }
    }
    default:
      return null
  }
}

/** Build a complete (closed) accumulator from a validated tool widget. */
function accOfWidget(widget: WidgetSpec): WidgetAcc {
  return { ...widget, closed: true, overflow: false }
}

/**
 * Parse a settled tool result's JSON text into a validated WidgetSpec.
 *
 * The host tool's canonical value is `{ widget: WidgetSpec }` and its render
 * emits the whole envelope as text; the parsed root may wrap the widget in a
 * `widget` key. Accept both the bare spec and the one-level envelope; a chart
 * result (which wraps `spec` instead) parses to undefined, leaving it to the
 * `visualizer-chart` definition.
 * @param match - folded tool/result match.
 * @returns validated widget, or undefined on any parse/validation failure.
 */
export function widgetFromResult(match: ConversationMatch): WidgetSpec | undefined {
  const text = resultText(match)
  if (text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const record = parsed as Record<string, unknown>
    const nested = record['widget']
    if (nested !== null && typeof nested === 'object') parsed = nested
  }
  const result = parseWidgetSpec(parsed)
  return result.ok ? result.widget : undefined
}

/**
 * Create the State from the start Match (step/start for streams, tool/call
 * for tool-delivered widgets).
 * @param context - assembled context.
 * @param match - start match.
 * @returns fresh state.
 */
export function widgetStartState(
  context: ConversationNodeContext<WidgetContextState>,
  match: ConversationMatch,
): WidgetContextState {
  if (match.event.type === 'tool/call') {
    const data = match.event.data as Record<string, unknown>
    return {
      source: 'tool',
      callId: typeof data['callId'] === 'string' ? data['callId'] : context.id,
      turn: typeof data['turn'] === 'number' ? data['turn'] : 0,
      step: typeof data['step'] === 'number' ? data['step'] : 0,
      scan: EMPTY_SCANNER,
      widgets: [],
      settled: false,
    }
  }
  const data = match.event.data as Record<string, unknown>
  return {
    source: 'stream',
    turn: typeof data['turn'] === 'number' ? data['turn'] : 0,
    step: typeof data['step'] === 'number' ? data['step'] : 0,
    scan: EMPTY_SCANNER,
    widgets: [],
    settled: false,
  }
}

/**
 * Fold one update Match into State.
 * @param context - context with current state.
 * @param match - update match in ascending log order.
 * @returns next state (immutable).
 */
export function widgetUpdateState(
  context: ConversationNodeContext<WidgetContextState> & { readonly state: WidgetContextState },
  match: ConversationMatch,
): WidgetContextState {
  const state = context.state
  if (state.source === 'tool') {
    if (match.event.type !== 'tool/result') return state
    const widget = widgetFromResult(match)
    if (widget === undefined) return state
    return { ...state, widgets: [accOfWidget(widget)], settled: true }
  }
  // Stream source: retries replace the whole step content, so everything
  // folded so far (open fences and closed accs alike) is discarded.
  if (match.event.type === 'llm/retry') {
    return { ...state, scan: EMPTY_SCANNER, widgets: [], settled: false }
  }
  if (state.settled) return state
  if (match.event.type === 'assistant/chunk') {
    const chunk = (match.event.data as { chunk?: { type?: unknown; text?: unknown } })['chunk']
    if (chunk === null || typeof chunk !== 'object' || chunk['type'] !== 'text-delta') return state
    const text = chunk['text']
    if (typeof text !== 'string' || text === '') return state
    return { ...state, scan: pushScannerText(state.scan, text) }
  }
  if (match.event.type === 'assistant/message' || match.event.type === 'step/end') {
    const done = finishScanner(state.scan)
    return { ...state, scan: EMPTY_SCANNER, widgets: [...state.widgets, ...done], settled: true }
  }
  return state
}

/** Walk a message content array for text blocks (narrow structural guard). */
function* messageTexts(content: unknown): Generator<string> {
  if (!Array.isArray(content)) return
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const record = block as { type?: unknown; text?: unknown }
    if (record['type'] === 'text' && typeof record['text'] === 'string') yield record['text']
  }
}

/**
 * Rebuild state from a cold window: the engine knows no start Match, so the
 * fold scans the settled evidence it does have — a `tool/result` carrying a
 * widget, or the step's final `assistant/message` text scanned whole.
 * @param context - assembled context.
 * @returns recovered state, when any widget content exists.
 */
export function fallbackWidgetState(
  context: ConversationNodeContext<WidgetContextState>,
): WidgetContextState | undefined {
  for (const match of context.matches) {
    if (match.event.type !== 'tool/result') continue
    const id = callIdOf(match.event)
    const widget = widgetFromResult(match)
    if (id === undefined || widget === undefined) continue
    const data = match.event.data as Record<string, unknown>
    return {
      source: 'tool',
      callId: id,
      turn: typeof data['turn'] === 'number' ? data['turn'] : 0,
      step: typeof data['step'] === 'number' ? data['step'] : 0,
      scan: EMPTY_SCANNER,
      widgets: [accOfWidget(widget)],
      settled: true,
    }
  }
  let state: WidgetContextState | undefined
  for (const match of context.matches) {
    if (match.event.type !== 'assistant/message') continue
    const data = match.event.data as Record<string, unknown>
    const turn = typeof data['turn'] === 'number' ? data['turn'] : 0
    const step = typeof data['step'] === 'number' ? data['step'] : 0
    state ??= { source: 'stream', turn, step, scan: EMPTY_SCANNER, widgets: [], settled: true }
    const message = data['message']
    if (message === null || typeof message !== 'object') continue
    for (const text of messageTexts((message as { content?: unknown })['content'])) {
      state = { ...state, scan: pushScannerText(state.scan, text) }
    }
  }
  if (state === undefined) return undefined
  const done = finishScanner(state.scan)
  if (done.length === 0 && state.widgets.length === 0) return undefined
  return { ...state, scan: EMPTY_SCANNER, widgets: [...state.widgets, ...done] }
}

/** Live accumulator for a fence still open (streaming in progress). The
 *  partial pending line is content — the model may be mid-line right now. */
function liveAcc(scan: WidgetScannerState): WidgetAcc | undefined {
  if (scan.kind === undefined) return undefined
  const raw = scan.content + scan.pending
  if (raw === '') return undefined
  const code = raw.endsWith('\n') ? raw.slice(0, -1) : raw
  return {
    kind: scan.kind,
    code,
    ...scan.title === undefined ? {} : { title: scan.title },
    closed: false,
    overflow: scan.overflow,
  }
}

/** Apply the per-node count/byte caps over the materialized widget list. */
function capWidgets(all: readonly WidgetAcc[]): { widgets: readonly WidgetAcc[]; dropped: number } {
  const widgets: WidgetAcc[] = []
  let bytes = 0
  let dropped = 0
  for (const acc of all) {
    const size = utf8ByteLength(acc.code)
    if (widgets.length >= MAX_WIDGETS_PER_NODE || bytes + size > MAX_NODE_WIDGET_BYTES) {
      dropped += 1
      continue
    }
    widgets.push(acc)
    bytes += size
  }
  return { widgets, dropped }
}

/**
 * Materialize the chat node, or null while no widget content is folded yet.
 * @param context - assembled context.
 * @returns final node.
 */
export function buildWidgetViewNode(
  context: ConversationNodeContext<WidgetContextState>,
): ChatConversationViewNode | null {
  const fallback = context.state === undefined ? fallbackWidgetState(context) : undefined
  const state = context.state ?? fallback
  if (state === undefined) return null
  const live = liveAcc(state.scan)
  const capped = capWidgets([...state.widgets, ...state.scan.closed, ...live === undefined ? [] : [live]])
  if (capped.widgets.length === 0) return null
  return {
    key: context.key,
    kind: WIDGET_KIND,
    id: context.id,
    target: 'chat',
    anchorSeq: context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0,
    location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    visibility: 'visible',
    data: {
      widgets: capped.widgets,
      source: state.source,
      ...state.callId === undefined ? {} : { callId: state.callId },
      dropped: capped.dropped,
    } satisfies VisualizerWidgetData,
  }
}
