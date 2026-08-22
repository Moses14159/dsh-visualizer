/**
 * ChartSpec -> echarts option mapping tests.
 */
import { describe, expect, it } from 'vitest'
import { parseChartSpec } from '../src/chartspec.ts'
import { chartSpecToOption, DEFAULT_THEME, type ChartTheme } from '../src/to-echarts.ts'

/** Helper: validate then map (the renderer's real path). */
function optionOf(input: unknown, theme?: ChartTheme): ReturnType<typeof chartSpecToOption> {
  const parsed = parseChartSpec(input)
  if (!parsed.ok) throw new Error(`fixture rejected: ${parsed.message}`)
  return chartSpecToOption(parsed.spec, theme)
}

describe('chartSpecToOption', () => {
  it('maps a bar spec to category x + value y + a styled bar series', () => {
    const option = optionOf({ kind: 'bar', xAxis: ['A', 'B'], yName: 'n', series: [{ data: [1, 2] }] })
    expect(option.xAxis).toMatchObject({ type: 'category', data: ['A', 'B'] })
    expect(option.yAxis).toMatchObject({ type: 'value', name: 'n' })
    expect(option.series).toHaveLength(1)
    expect(option.series[0]).toEqual({
      type: 'bar', name: 'series 1', data: [1, 2],
      barMaxWidth: 48, itemStyle: { borderRadius: [5, 5, 0, 0] },
    })
    expect(option.legend).toEqual({ show: false })
  })

  it('names series from series.name and shows a legend for multi-series', () => {
    const option = optionOf({
      kind: 'line',
      series: [{ name: 'a', data: [1] }, { name: 'b', data: [2] }],
    })
    expect(option.legend).toMatchObject({ data: ['a', 'b'] })
    expect(option.series).toHaveLength(2)
    expect(option.series[0]).toMatchObject({
      type: 'line', name: 'a', smooth: true, symbol: 'circle', symbolSize: 7,
    })
  })

  it('maps an area spec as a smooth line with areaStyle', () => {
    const option = optionOf({ kind: 'area', series: [{ data: [1, 2] }] })
    expect(option.series).toEqual([{
      type: 'line', name: 'series 1', data: [1, 2],
      smooth: true, symbol: 'circle', symbolSize: 7,
      lineStyle: { width: 2.5 }, areaStyle: { opacity: 0.16 },
    }])
  })

  it('maps a pie spec with a donut radius, rounded slices, and labels', () => {
    const option = optionOf({ kind: 'pie', xAxis: ['a', 'b'], series: [{ data: [3, 4] }] })
    expect(option.series).toHaveLength(1)
    expect(option.series[0]).toMatchObject({
      type: 'pie',
      radius: ['42%', '68%'],
      data: [{ name: 'a', value: 3 }, { name: 'b', value: 4 }],
    })
    expect(option.xAxis).toBeUndefined()
  })

  it('maps a scatter spec to labeled points', () => {
    const option = optionOf({ kind: 'scatter', xAxis: ['x1', 'x2'], series: [{ data: [3, 4] }] })
    expect(option.series).toEqual([{
      type: 'scatter',
      symbolSize: 11,
      itemStyle: { opacity: 0.85 },
      data: [{ value: ['x1', 3] }, { value: ['x2', 4] }],
    }])
  })

  it('emits a centered styled title when present', () => {
    const option = optionOf({ kind: 'bar', title: 'T', series: [{ data: [1] }] })
    expect(option.title).toMatchObject({ text: 'T', left: 'center' })
  })

  it('always disables animation and sets a themed tooltip (deterministic render)', () => {
    const option = optionOf({ kind: 'bar', series: [{ data: [1] }] })
    expect(option.animation).toBe(false)
    expect(option.tooltip).toMatchObject({ trigger: 'axis' })
    expect(option.grid).toBeDefined()
    expect(option.color).toBeDefined()
  })

  it('applies the theme: palette, axis chrome, tooltip surface, split lines', () => {
    const theme: ChartTheme = {
      palette: ['#111111', '#222222'],
      textPrimary: '#101010',
      textSecondary: '#555555',
      axisLine: '#aaaaaa',
      splitLine: '#dddddd',
      tooltipBg: '#ffffff',
      tooltipBorder: '#cccccc',
      fontFamily: 'test-mono',
    }
    const option = optionOf({ kind: 'bar', xAxis: ['A'], series: [{ data: [1] }] }, theme)
    expect(option.color).toEqual(['#111111', '#222222'])
    const xAxis = option.xAxis as Record<string, unknown>
    expect(xAxis.axisLabel).toMatchObject({ color: '#555555' })
    const yAxis = option.yAxis as Record<string, unknown>
    expect(yAxis.splitLine).toMatchObject({ lineStyle: { color: '#dddddd', width: 1 } })
    expect(option.tooltip).toMatchObject({ backgroundColor: '#ffffff', borderColor: '#cccccc' })
  })

  it('uses item tooltips for pie and axis tooltips for cartesian kinds', () => {
    const pie = optionOf({ kind: 'pie', series: [{ data: [1, 2] }] })
    expect(pie.tooltip).toMatchObject({ trigger: 'item' })
    const bar = optionOf({ kind: 'bar', series: [{ data: [1, 2] }] })
    expect(bar.tooltip).toMatchObject({ trigger: 'axis' })
  })

  it('matches the documented default theme', () => {
    expect(DEFAULT_THEME.palette).toHaveLength(8)
    expect(DEFAULT_THEME.fontFamily).toContain('sans-serif')
  })
})
