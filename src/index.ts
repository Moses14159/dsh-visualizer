/**
 * Host half of dsh-visualizer: registers ONE model-facing tool, `visualize`,
 * accepting either a ChartSpec (`spec`) or a WidgetSpec (`widget`).
 *
 * No DSH source change: `ctx.tools.register` is the documented host seam.
 * Everything the client needs rides the existing `tool/call` + `tool/result`
 * session events (charts and tool-delivered widgets) plus the existing
 * `assistant/chunk` events (streamed fenced widgets), so the durable log
 * needs no new event family.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createVisualizeTool } from './visualize-tool.ts'

/** Stable Cordis plugin name. */
export const name = 'dsh-visualizer'

/**
 * Services this plugin reads at apply time. The loader defers activation
 * until the 'tools' service (provided by @deepseek-ai/dsh-tools) exists,
 * mirroring every other DSH tool plugin; without this the registry access
 * below throws "cannot get property 'tools' without inject".
 */
export const inject = ['tools']

/**
 * Register the `visualize` tool with the host tools registry.
 * @param ctx - host cordis context (provides `tools`).
 * @returns disposer (running with the fiber automatically).
 */
export function registerVisualizeTool(ctx: Context): () => void {
  return ctx.tools.register(createVisualizeTool())
}

/** Apply the host half: register the visualize tool. */
export function apply(ctx: Context): void {
  ctx.effect(() => registerVisualizeTool(ctx), 'dsh-visualizer: visualize tool')
}
