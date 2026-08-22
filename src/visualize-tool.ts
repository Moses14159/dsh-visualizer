/**
 * The `visualize` tool definition of dsh-visualizer's host half.
 *
 * The model hands the tool exactly one of two payloads:
 *
 * - `spec` — a ChartSpec (validated by chartspec.ts; the client folds it
 *   into a `visualizer-chart` node rendered with echarts);
 * - `widget` — a WidgetSpec (validated by widget.ts; the client folds it
 *   into a `visualizer-widget` node rendered in a sandboxed iframe).
 *
 * The settled tool result carries the canonical validated JSON as its text
 * content, so the client Definitions re-validate the same bytes with the
 * same parsers — one contract on both sides of the wire. The model is also
 * taught the streamed path in the description: for progressive rendering it
 * can emit ```` ```svg ```` / ```` ```html ```` fences in its text response
 * instead, which the client folds from `assistant/chunk` deltas without a
 * tool round-trip.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { parseChartSpec } from './chartspec.ts'
import { parseWidgetSpec } from './widget.ts'

/**
 * JSON-Schema for the model-facing `spec` parameter (the open object; the
 * parser performs the strict/closed validation the schema cannot express).
 * Kept in sync with chartspec.ts's field vocabulary.
 */
const SPEC_PARAMETER_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  description:
    'Structured chart specification: { kind: "bar"|"line"|"area"|"pie"|"scatter", title?, xAxis?: string[], yName?, series: [{ name?, data: number[] }] }.',
} as const

/**
 * JSON-Schema for the model-facing `widget` parameter (the open object; the
 * parser performs the strict/closed validation the schema cannot express).
 * Kept in sync with widget.ts's field vocabulary.
 */
const WIDGET_PARAMETER_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  description:
    'Structured widget payload: { kind: "svg"|"html", code: string, title?: string }. '
    + 'code is the raw SVG document or HTML body content (max 128 KB), rendered in a sandboxed frame.',
} as const

/** Output schema: the canonical value is exactly one of `{ spec }` / `{ widget }`. */
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    spec: SPEC_PARAMETER_SCHEMA,
    widget: WIDGET_PARAMETER_SCHEMA,
  },
} as const

/** Tool name (the client Definitions gate their matches on it). */
export const VISUALIZE_TOOL = 'visualize'

/**
 * Validate and settle one tool call. Pure: exported for unit tests.
 * @param args - raw model-produced arguments.
 * @returns the canonical value `{ spec }` or `{ widget }`; rejects on
 *   missing/ambiguous payloads or validation failure (the tool reports the
 *   message back to the model).
 */
export function executeVisualize(args: unknown): Promise<Record<string, unknown>> {
  const record = args === null || typeof args !== 'object' || Array.isArray(args)
    ? {}
    : args as Record<string, unknown>
  const hasSpec = record['spec'] !== undefined
  const hasWidget = record['widget'] !== undefined
  if (hasSpec === hasWidget) {
    return Promise.reject(new Error(hasSpec
      ? 'provide exactly one of `spec` or `widget`'
      : '`spec` or `widget` is required'))
  }
  if (hasSpec) {
    const parsed = parseChartSpec(record['spec'])
    if (!parsed.ok) return Promise.reject(new Error(`invalid chart spec: ${parsed.message}`))
    return Promise.resolve({ spec: JSON.parse(JSON.stringify(parsed.spec)) as Record<string, unknown> })
  }
  const parsed = parseWidgetSpec(record['widget'])
  if (!parsed.ok) return Promise.reject(new Error(`invalid widget spec: ${parsed.message}`))
  return Promise.resolve({ widget: JSON.parse(JSON.stringify(parsed.widget)) as Record<string, unknown> })
}

/**
 * Build the tool definition (called inside `apply`, mirroring the original
 * registry timing; the definition itself is inert until registered).
 * @returns the `visualize` tool definition.
 */
export function createVisualizeTool() {
  return defineTool({
    name: VISUALIZE_TOOL,
    description:
      'Render a chart or a static SVG/HTML widget into the conversation. '
      + 'Charts: pass `spec` — pure data: '
      + '{"kind":"bar|line|area|pie|scatter","title":"optional","xAxis":["category labels"],'
      + '"yName":"optional y axis name","series":[{"name":"optional","data":[1,2,3]}]}. '
      + 'A bar/line/area spec needs xAxis labels and numeric series data; a pie spec uses '
      + 'xAxis as slice names and series[0].data as the values; a scatter spec pairs xAxis '
      + 'labels with series[0].data values. '
      + 'Widgets: pass `widget` — {"kind":"svg|html","code":"<raw SVG or HTML body>","title":"optional"}; '
      + 'code renders inside a sandboxed frame (scripts and network disabled). '
      + 'For a widget that should appear progressively while you are still writing it, prefer '
      + 'emitting it as a fenced code block in your normal text response: ```svg … ``` or '
      + '```html … ```; the client renders those fences as live widgets too. '
      + 'Pass exactly one of `spec` or `widget`. Use it for data the user asked to see — never for prose.',
    parameters: {
      spec: SPEC_PARAMETER_SCHEMA,
      widget: WIDGET_PARAMETER_SCHEMA,
    },
    output: {
      schema: OUTPUT_SCHEMA,
      // The canonical text content is the value JSON: the client folds the
      // record from the result content and re-validates with the same parsers.
      render: (_args: unknown, value: unknown): ContentBlock[] => [
        { type: 'text', text: JSON.stringify(value) },
      ],
    },
    execute: executeVisualize,
  })
}
