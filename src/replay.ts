/**
 * Node-facing diagnostics entry: re-exports the pure contract and fold
 * functions so `scripts/replay-*.mjs` can replay scripted session logs
 * through the exact client fold logic without a browser or a cordis context.
 * The functions themselves live in their domain modules; this entry only
 * assembles a node-importable surface (the tsdown host build bundles it as
 * `lib/replay.js`).
 */

export {
  parseChartSpec,
  isPairKind,
  type ChartSpec,
  type ChartSeries,
  type ChartSpecParseResult,
} from './chartspec.ts'

export {
  EMPTY_SCANNER,
  MAX_NODE_WIDGET_BYTES,
  MAX_WIDGET_BYTES,
  MAX_WIDGETS_PER_NODE,
  MAX_WIDGET_TITLE,
  finishScanner,
  parseWidgetSpec,
  pushScannerText,
  utf8ByteLength,
  type WidgetAcc,
  type WidgetKind,
  type WidgetScannerState,
  type WidgetSpec,
} from './widget.ts'

export {
  widgetSrcdoc,
} from './to-iframe.ts'

export {
  WIDGET_KIND,
  buildWidgetViewNode,
  fallbackWidgetState,
  widgetFromResult,
  widgetMatchOf,
  widgetStartState,
  widgetUpdateState,
  type VisualizerWidgetData,
  type WidgetContextState,
  type WidgetSource,
} from './client/widget-fold.ts'
