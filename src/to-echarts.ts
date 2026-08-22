/**
 * ChartSpec -> echarts option mapping.
 *
 * Pure module: input is a validated {@link ChartSpec} (see chartspec.ts) and
 * an optional {@link ChartTheme}, output is a plain EChartsOption-shaped
 * object. No DOM, no echarts runtime import here — the renderer hands this
 * object to `echarts.init(..).setOption(..)`.
 *
 * The mapper owns every aesthetic default (palette, axis/label/split-line
 * colors, tooltip and legend styling, bar radii, line symbols, pie radii) so
 * the rendered chart is consistent and legible on light and dark themes
 * alike. The client reads its theme from DSH CSS variables at mount time and
 * passes it in; {@link DEFAULT_THEME} keeps the pure module usable (and
 * unit-testable) without a DOM.
 *
 * Kept free of DSH imports so the mapping is unit-testable in isolation and
 * reusable from any renderer context.
 *
 * @module dsh-visualizer/to-echarts
 */

import type { ChartSpec, ChartSeries } from './chartspec.ts'

/**
 * Theme vocabulary the mapper consumes. All colors are CSS color strings;
 * `fontFamily` is a CSS font-family stack.
 */
export interface ChartTheme {
  /** Series color cycle (index by series position). */
  readonly palette: readonly string[]
  /** Primary text: title, tooltip text, pie labels. */
  readonly textPrimary: string
  /** Secondary text: axis labels, legend, axis names. */
  readonly textSecondary: string
  /** Axis line + tick color. */
  readonly axisLine: string
  /** Grid split-line color. */
  readonly splitLine: string
  /** Tooltip surface + border. */
  readonly tooltipBg: string
  readonly tooltipBorder: string
  /** Font stack for every text element. */
  readonly fontFamily: string
}

/** Light-theme fallback used when the renderer cannot read CSS variables. */
export const DEFAULT_THEME: ChartTheme = {
  palette: ['#4166e6', '#22a06b', '#e8a33d', '#d94f4f', '#8b5cf6', '#0ea5e9', '#ec4899', '#64748b'],
  textPrimary: '#1f2937',
  textSecondary: '#6b7280',
  axisLine: '#d1d5db',
  splitLine: '#e5e7eb',
  tooltipBg: '#ffffff',
  tooltipBorder: '#d1d5db',
  fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "PingFang SC", "Microsoft YaHei", sans-serif',
}

/**
 * Minimal option shape: the fields this mapper emits, structurally
 * compatible with `EChartsOption` (echarts' own type is a deep union this
 * module deliberately does not import, to stay pure and version-light).
 */
export interface MappedEchartsOption {
  readonly animation: boolean
  readonly color?: readonly string[]
  readonly textStyle?: Record<string, unknown>
  readonly tooltip: unknown
  readonly grid?: Record<string, unknown>
  readonly legend: { data: readonly string[]; show?: boolean; top?: number; textStyle?: Record<string, unknown>; icon?: string; itemWidth?: number; itemHeight?: number; itemGap?: number } | { show: false }
  readonly xAxis?: {
    readonly type: 'category' | 'value'
    readonly name?: string
    readonly data?: readonly string[]
    readonly axisLabel?: Record<string, unknown>
    readonly axisLine?: Record<string, unknown>
    readonly axisTick?: Record<string, unknown>
    readonly splitLine?: Record<string, unknown>
    readonly nameTextStyle?: Record<string, unknown>
  }
  readonly yAxis?: {
    readonly type: 'category' | 'value'
    readonly name?: string
    readonly axisLabel?: Record<string, unknown>
    readonly axisLine?: Record<string, unknown>
    readonly axisTick?: Record<string, unknown>
    readonly splitLine?: Record<string, unknown>
    readonly nameTextStyle?: Record<string, unknown>
  }
  readonly title?: Record<string, unknown>
  readonly series: readonly Record<string, unknown>[]
}

/** Legend labels for a multi-series spec (empty = no legend). */
function legendLabels(series: readonly ChartSeries[]): readonly string[] {
  return series.length <= 1 ? [] : series.map((item, index) => item.name ?? `series ${index + 1}`)
}

/** One bar/line/area series entry, styled per kind. */
function cartesianSeries(kind: 'bar' | 'line' | 'area', series: readonly ChartSeries[]): Record<string, unknown>[] {
  return series.map((item, index) => ({
    type: kind === 'area' ? 'line' : kind,
    name: item.name ?? `series ${index + 1}`,
    data: item.data,
    ...kind === 'bar' ? {
      barMaxWidth: 48,
      itemStyle: { borderRadius: [5, 5, 0, 0] },
    } : {},
    ...kind === 'line' || kind === 'area' ? {
      smooth: true,
      symbol: 'circle',
      symbolSize: 7,
      lineStyle: { width: 2.5 },
      ...kind === 'area' ? { areaStyle: { opacity: 0.16 } } : {},
    } : {},
  }))
}

/** One pie series (single series; slices from xAxis labels + data). */
function pieSeries(spec: ChartSpec, theme: ChartTheme): Record<string, unknown>[] {
  const data = spec.series[0]?.data ?? []
  const labels = spec.xAxis ?? data.map((_, index) => String(index + 1))
  return [{
    type: 'pie',
    radius: ['42%', '68%'],
    center: ['50%', '50%'],
    itemStyle: { borderRadius: 6, borderColor: theme.tooltipBg, borderWidth: 2 },
    label: { color: theme.textPrimary, fontSize: 12 },
    labelLine: { length: 12, length2: 8, lineStyle: { color: theme.axisLine } },
    data: data.map((value, index) => ({
      name: labels[index] ?? `slice ${index + 1}`,
      value,
    })),
  }]
}

/** One scatter series (points from xAxis labels at data values). */
function scatterSeries(spec: ChartSpec): Record<string, unknown>[] {
  const data = spec.series[0]?.data ?? []
  const labels = spec.xAxis ?? []
  return [{
    type: 'scatter',
    symbolSize: 11,
    itemStyle: { opacity: 0.85 },
    data: data.map((value, index) => {
      const label = labels[index]
      return label === undefined ? value : { value: [label, value] }
    }),
  }]
}

/** Shared axis chrome: colored labels, hidden ticks, subtle split lines. */
function axisChrome(theme: ChartTheme, vertical: boolean): Record<string, unknown> {
  return {
    axisLabel: { color: theme.textSecondary, fontSize: 11, fontFamily: theme.fontFamily },
    axisTick: { show: false },
    axisLine: { lineStyle: { color: theme.axisLine } },
    ...vertical ? { splitLine: { lineStyle: { color: theme.splitLine, width: 1 } } } : { splitLine: { show: false } },
    nameTextStyle: { color: theme.textSecondary, fontSize: 11, fontFamily: theme.fontFamily },
  }
}

/** Tooltip chrome: theme surface, border, and text color. */
function tooltipOf(theme: ChartTheme, trigger: 'axis' | 'item'): Record<string, unknown> {
  return {
    trigger,
    confine: true,
    backgroundColor: theme.tooltipBg,
    borderColor: theme.tooltipBorder,
    borderWidth: 1,
    padding: [8, 12],
    textStyle: { color: theme.textPrimary, fontSize: 12, fontFamily: theme.fontFamily },
  }
}

/** Chart title chrome (the node header repeats the title; this one is the
 *  in-canvas caption for screenshots/exports). */
function titleOf(spec: ChartSpec, theme: ChartTheme): Record<string, unknown> | undefined {
  if (spec.title === undefined) return undefined
  return {
    text: spec.title,
    left: 'center',
    top: 4,
    textStyle: { fontSize: 14, fontWeight: 600, color: theme.textPrimary, fontFamily: theme.fontFamily },
  }
}

/** Grid inset; reserves headroom for the title and the legend. */
function gridTop(spec: ChartSpec, showLegend: boolean): number {
  let top = 18
  if (showLegend) top += 24
  if (spec.title !== undefined) top += 26
  return top
}

/**
 * Map a validated ChartSpec to an echarts option.
 * @param spec - validated chart specification.
 * @param theme - renderer theme; defaults to {@link DEFAULT_THEME}.
 * @returns plain option object (safe to pass to setOption).
 */
export function chartSpecToOption(spec: ChartSpec, theme: ChartTheme = DEFAULT_THEME): MappedEchartsOption {
  const labels = legendLabels(spec.series)
  const showLegend = labels.length > 0
  const isPie = spec.kind === 'pie'
  const title = titleOf(spec, theme)
  return {
    animation: false,
    color: theme.palette,
    textStyle: { fontFamily: theme.fontFamily, color: theme.textPrimary },
    tooltip: tooltipOf(theme, isPie ? 'item' : 'axis'),
    legend: showLegend
      ? {
        data: labels,
        top: spec.title === undefined ? 6 : 30,
        icon: 'roundRect',
        itemWidth: 12,
        itemHeight: 8,
        itemGap: 14,
        textStyle: { color: theme.textSecondary, fontSize: 11, fontFamily: theme.fontFamily },
      }
      : { show: false },
    grid: isPie ? undefined : {
      left: 14,
      right: 18,
      top: gridTop(spec, showLegend),
      bottom: 8,
      containLabel: true,
    },
    ...title === undefined ? {} : { title },
    ...isPie
      ? { series: pieSeries(spec, theme) }
      : spec.kind === 'scatter'
        ? {
          xAxis: {
            type: 'category' as const,
            ...spec.xAxis === undefined ? {} : { data: spec.xAxis },
            ...axisChrome(theme, false),
          },
          yAxis: {
            type: 'value' as const,
            ...spec.yName === undefined ? {} : { name: spec.yName },
            ...axisChrome(theme, true),
          },
          series: scatterSeries(spec),
        }
        : {
          xAxis: {
            type: 'category' as const,
            ...spec.xAxis === undefined ? {} : { data: spec.xAxis },
            ...axisChrome(theme, false),
          },
          yAxis: {
            type: 'value' as const,
            ...spec.yName === undefined ? {} : { name: spec.yName },
            ...axisChrome(theme, true),
          },
          series: cartesianSeries(spec.kind, spec.series),
        },
  }
}
