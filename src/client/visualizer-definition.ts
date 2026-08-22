/**
 * ConversationNodeDefinition for the `visualize` tool's lifecycle.
 *
 * fold: `tool/call` (visualize, start) + `tool/result` (same callId, update)
 * -> one `visualizer-chart` Chat Node carrying the parsed ChartSpec.
 *
 * The spec is read from the tool/result content text (JSON string) — the
 * canonical model-facing output the plugin's own host tool produces — and
 * re-validated with the same parser the host half used, because session-log
 * content is replayable but not trusted. Any parse/validation failure
 * degrades to "no node": the generic tool row still renders the call.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeDataMap } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  VISUALIZER_KIND,
  VISUALIZE_TOOL,
  buildVisualizerViewNode,
  callIdOf,
  fallbackState,
  specFromResult,
  type VisualizerState,
  type VisualizerChartData,
} from './visualizer-fold.ts'

export {
  VISUALIZER_KIND,
  VISUALIZE_TOOL,
  buildVisualizerViewNode,
  callIdOf,
  fallbackState,
  specFromResult,
}
export type { VisualizerState, VisualizerChartData }

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'visualizer-chart': VisualizerChartData
  }
}

/** The Definition: start on visualize calls, update on results, render a chart. */
export const visualizerDefinition: ConversationNodeDefinition<VisualizerState> = {
  kind: VISUALIZER_KIND,
  target: 'chat',
  match: (event) => {
    const id = callIdOf(event as { type: string; data: Record<string, unknown> & { callId?: unknown } })
    if (id === undefined) return null
    const role = event.type === 'tool/call' ? 'start' : 'update'
    return { id, role }
  },
  start: (context, match) => {
    const id = match.event.type === 'tool/call' && typeof match.event.data['callId'] === 'string'
      ? match.event.data['callId'] as string
      : context.id
    // The start event carries only the call; the spec arrives with the
    // result. State is born empty — the node stays invisible until an update
    // (or a cold-replay fallback) lands a valid spec.
    return { callId: id, spec: undefined }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    if (context.state.spec !== undefined) return context.state
    const spec = specFromResult(match)
    if (spec === undefined) return context.state
    return { callId: context.state.callId, spec }
  },
  publication: (match) => (match.event.type === 'tool/result' ? 'immediate' : 'animation-frame'),
  buildViewNode: (context) => buildVisualizerViewNode(context),
}

/**
 * Register the definition with the client runtime.
 * @param ctx - client cordis context (provides `conversationEvents`).
 * @returns disposer (fiber-managed).
 */
export function registerVisualizerDefinition(ctx: Context): () => void {
  return ctx.conversationEvents.register(visualizerDefinition)
}
