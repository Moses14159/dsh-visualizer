/**
 * Client half of dsh-visualizer: folds the plugin's durable events into two
 * conversation node kinds —
 *
 * - `visualizer-chart`: the `visualize` tool's `tool/call` + `tool/result`
 *   with a ChartSpec, rendered with echarts;
 * - `visualizer-widget`: streamed ```` ```svg ```` / ```` ```html ```` fences
 *   folded from the step's `assistant/chunk` deltas (live, progressive), and
 *   `visualize` tool calls carrying a WidgetSpec, rendered in sandboxed
 *   inert iframes.
 *
 * No DSH source change: the events already exist in the session log, the
 * `conversation.chat.node` seat is declared by ui-conversation, and the
 * registration contract is consumed type-only (erased before the client
 * purity gate).
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerVisualizerDefinition } from './visualizer-definition.ts'
import { registerWidgetDefinition } from './visualizer-widget-definition.ts'
import { VisualizerChartNodeView } from './VisualizerChartNodeView.tsx'
import { VisualizerWidgetNodeView } from './VisualizerWidgetNodeView.tsx'

/** Services the client half needs: the event definition registry and the slot
 *  system — both provided by @deepseek-ai/dsh-client-runtime. echarts is
 *  inlined at build time, so no module-table service is needed. */
export const inject = ['conversationEvents', 'slots']

export function apply(ctx: Context): void {
  // One Definition per activation (HMR-safe through the registry's effect
  // disposers). Each node only materializes when a valid payload was folded —
  // any drift degrades to the generic tool row / plain markdown code block,
  // never to a blank or broken render.
  ctx.effect(
    () => registerVisualizerDefinition(ctx),
    'dsh-visualizer: visualizer-chart definition',
  )
  ctx.effect(
    () => registerWidgetDefinition(ctx),
    'dsh-visualizer: visualizer-widget definition',
  )

  // Keyed chat-node renderers: ui-conversation's seat dispatches by the
  // Node's `kind`, so the slot registration needs only the string key — no
  // value import across packages.
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'visualizer-chart' },
    VisualizerChartNodeView,
  ))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register(
    { name: 'conversation.chat.node', key: 'visualizer-widget' },
    VisualizerWidgetNodeView,
  ))
}
