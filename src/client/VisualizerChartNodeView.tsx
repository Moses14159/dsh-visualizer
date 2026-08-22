/**
 * The keyed `conversation.chat.node` renderer for `visualizer-chart`.
 *
 * Pure presentation: reads `node.data.spec` (already validated upstream — the
 * Definition re-validates on fold), resolves the active DSH theme from CSS
 * variables, maps the spec to an echarts option, and renders it. echarts is
 * loaded lazily (`import('echarts')` on first chart mount) so the core client
 * bundle stays lean; until the chunk resolves, a bounded placeholder is
 * shown. Any load/render failure degrades to a JSON card — never a blank row
 * or a thrown error in the chat.
 *
 * Styling: DSH theme tokens only (CSS variables), no literal colors — the
 * plugin must stay neutral across DSH color schemes. The sampled token values
 * are handed to the pure mapper as a {@link ChartTheme}.
 */
import { memo, useEffect, useRef, useState } from 'react'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { chartSpecToOption, DEFAULT_THEME, type ChartTheme } from '../to-echarts.ts'
import type { ChartSpec } from '../chartspec.ts'

/** Full props of the keyed renderer (the type resolves through the plugin's
 *  ChatNodeDataMap augmentation in visualizer-definition.ts). All visible
 *  strings are inline (no i18n dictionary), so the `t` from PropsLocale is
 *  accepted but unused. */
export type VisualizerChartViewProps = ChatNodeViewProps<'visualizer-chart'>

/** A rendered chart instance (init + dispose pairs). */
type EChartsInstance = {
  setOption(option: object): void
  resize(): void
  dispose(): void
}

interface ChartHandle {
  readonly chart: EChartsInstance
  readonly dispose: () => void
  readonly canvas: HTMLElement
  readonly host: HTMLElement
}

/** DSH theme tokens sampled into the mapper's theme vocabulary. */
const THEME_TOKEN_SOURCES: Readonly<Record<keyof Omit<ChartTheme, 'palette'>, readonly string[]>> = {
  textPrimary: ['--dsw-alias-label-primary', '--dsw-alias-brand-text'],
  textSecondary: ['--dsw-alias-label-secondary'],
  axisLine: ['--dsw-alias-border-l2', '--dsw-alias-border-l1'],
  splitLine: ['--dsw-alias-border-l1', '--dsw-alias-border-l2'],
  tooltipBg: ['--dsw-alias-bg-overlay', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-base'],
  tooltipBorder: ['--dsw-alias-border-l2', '--dsw-alias-border-l1'],
  fontFamily: [],
}

/** Read one CSS variable chain from the document root; empty string = miss. */
function readToken(names: readonly string[]): string | undefined {
  if (typeof document === 'undefined') return undefined
  const style = getComputedStyle(document.documentElement)
  for (const name of names) {
    const value = style.getPropertyValue(name).trim()
    if (value !== '') return value
  }
  return undefined
}

/** Series palette tuned to stay legible on both DSH light and dark themes. */
const PALETTE = ['#4e6ef2', '#00a870', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'] as const

/**
 * Resolve the theme the chart renders with: DSH CSS tokens where present,
 * {@link DEFAULT_THEME} fallbacks elsewhere. Pure with respect to the DOM —
 * called once per mount.
 * @returns the effective theme.
 */
export function resolveChartTheme(): ChartTheme {
  const fontFamily = readToken(THEME_TOKEN_SOURCES.fontFamily)
    ?? DEFAULT_THEME.fontFamily
  const token = (key: keyof Omit<ChartTheme, 'palette'>): string => (
    readToken(THEME_TOKEN_SOURCES[key]) ?? DEFAULT_THEME[key]
  )
  return {
    palette: PALETTE,
    textPrimary: token('textPrimary'),
    textSecondary: token('textSecondary'),
    axisLine: token('axisLine'),
    splitLine: token('splitLine'),
    tooltipBg: token('tooltipBg'),
    tooltipBorder: token('tooltipBorder'),
    fontFamily,
  }
}

/**
 * Map and render one validated spec into an echarts instance. Tree-shakable
 * echarts imports (core + the exact chart/component/renderer modules the
 * mapper emits) keep the inlined client payload small.
 * @param host - container element.
 * @param spec - validated ChartSpec.
 * @param theme - resolved renderer theme.
 * @returns handle with dispose; throws on init failure.
 */
async function mountChart(host: HTMLElement, spec: ChartSpec, theme: ChartTheme): Promise<ChartHandle> {
  const [{ init, use }, { BarChart, LineChart, PieChart, ScatterChart }, { GridComponent, TitleComponent, TooltipComponent, LegendComponent }, { CanvasRenderer }] = await Promise.all([
    import('echarts/core'),
    import('echarts/charts'),
    import('echarts/components'),
    import('echarts/renderers'),
  ])
  // Register exactly what the mapper emits (idempotent across mounts).
  use([BarChart, LineChart, PieChart, ScatterChart, GridComponent, TitleComponent, TooltipComponent, LegendComponent, CanvasRenderer])
  const option = chartSpecToOption(spec, theme)
  const chart = init(host, undefined, { renderer: 'canvas' })
  const canvas = host.querySelector('canvas') ?? host
  chart.setOption(option as unknown as Parameters<typeof chart.setOption>[0])
  return { chart, canvas, host, dispose: () => { chart.dispose() } }
}

/** One chart mount: effect-driven init/dispose with resize tracking. */
function ChartMount({ spec }: { spec: ChartSpec }): React.ReactNode {
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<ChartHandle | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (host === null) return
    let cancelled = false
    let observer: ResizeObserver | undefined
    const theme = resolveChartTheme()
    void mountChart(host, spec, theme)
      .then((handle) => {
        if (cancelled) { handle.dispose(); return }
        handleRef.current = handle
        observer = new ResizeObserver(() => {
          // echarts reads its own size; a resize just forces a re-layout.
          try { handle.chart.resize() } catch { /* instance gone */ }
        })
        observer.observe(handle.canvas)
      })
      .catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      observer?.disconnect()
      handleRef.current?.dispose()
      handleRef.current = null
    }
  }, [spec])

  return (
    <div
      ref={hostRef}
      style={{
        width: '100%',
        height: 'min(400px, 56vh)',
        minHeight: 240,
        color: 'var(--dsw-alias-label-primary)',
        font: '12px/1.5 "SF Mono", ui-monospace, monospace',
      }}
      aria-label="chart"
      role="img"
    >
      {failed && <span>chart failed to load</span>}
    </div>
  )
}

/** The chat node card: header row + chart canvas. */
export const VisualizerChartNodeView = memo(function VisualizerChartNodeView({
  node,
}: VisualizerChartViewProps): React.ReactNode {
  const { spec } = node.data
  const kind = spec.kind
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: '12px 14px',
        borderRadius: 12,
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 6,
            fontSize: 11,
            background: 'var(--dsw-alias-bg-layer-2)',
            color: 'var(--dsw-alias-label-secondary)',
            textTransform: 'lowercase',
            fontFamily: 'ui-monospace, monospace',
          }}
        >
          {kind}
        </span>
        {spec.title !== undefined && (
          <span style={{ fontWeight: 600, fontSize: 13 }}>{spec.title}</span>
        )}
      </div>
      <ChartMount spec={spec} />
    </div>
  )
})
