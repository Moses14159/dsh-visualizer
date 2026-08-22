/**
 * ConversationNodeDefinition for the widget lifecycle.
 *
 * fold: step-scoped `assistant/chunk` text deltas (streamed fenced widgets)
 * and `tool/call`+`tool/result` pairs carrying a WidgetSpec (complete
 * widgets) -> one `visualizer-widget` Chat Node holding every widget of that
 * step/call, republished live while the model is still writing.
 *
 * The node only materializes when the fold produced at least one widget;
 * any parse/scan failure degrades to "no node" — the ordinary markdown code
 * block still renders the fence text.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ChatNodeDataMap } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  WIDGET_KIND,
  buildWidgetViewNode,
  fallbackWidgetState,
  widgetMatchOf,
  widgetStartState,
  widgetUpdateState,
  type VisualizerWidgetData,
  type WidgetContextState,
} from './widget-fold.ts'

export {
  WIDGET_KIND,
  buildWidgetViewNode,
  fallbackWidgetState,
  widgetMatchOf,
  widgetStartState,
  widgetUpdateState,
}
export type { VisualizerWidgetData, WidgetContextState }

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    'visualizer-widget': VisualizerWidgetData
  }
}

/** The Definition: start on step boundaries or visualize tool calls, update
 *  on streamed text / settled results, publish a live widget card. */
export const widgetDefinition: ConversationNodeDefinition<WidgetContextState> = {
  kind: WIDGET_KIND,
  target: 'chat',
  match: (event) => widgetMatchOf(event as { type: string; data: Record<string, unknown> }),
  start: (context, match) => widgetStartState(context, match),
  update: (context, match) => widgetUpdateState(context, match),
  publication: (match) => {
    if (match.event.type === 'step/start') return 'none'
    // Streaming text republishes on animation frames (the built-in
    // assistant-step cadence); settled facts publish immediately.
    if (match.event.type === 'assistant/chunk') return 'animation-frame'
    return 'immediate'
  },
  buildViewNode: (context) => buildWidgetViewNode(context),
}

/**
 * Register the definition with the client runtime.
 * @param ctx - client cordis context (provides `conversationEvents`).
 * @returns disposer (fiber-managed).
 */
export function registerWidgetDefinition(ctx: Context): () => void {
  return ctx.conversationEvents.register(widgetDefinition)
}
