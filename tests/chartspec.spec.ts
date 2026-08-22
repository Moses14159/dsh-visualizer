/**
 * ChartSpec parser tests: the validator is the security boundary between
 * untrusted model output and echarts rendering, so every branch matters.
 */
import { describe, expect, it } from 'vitest'
import { parseChartSpec } from '../src/chartspec.ts'

describe('parseChartSpec', () => {
  it('accepts a minimal bar spec', () => {
    const result = parseChartSpec({ kind: 'bar', series: [{ data: [1, 2, 3] }] })
    expect(result).toEqual({
      ok: true,
      spec: { kind: 'bar', series: [{ data: [1, 2, 3] }] },
    })
  })

  it('accepts a full spec with title/xAxis/yName/name', () => {
    const result = parseChartSpec({
      kind: 'line',
      title: 'Sales',
      xAxis: ['Q1', 'Q2'],
      yName: 'USD',
      series: [{ name: 'revenue', data: [10.5, 20] }],
    })
    expect(result).toEqual({
      ok: true,
      spec: {
        kind: 'line',
        title: 'Sales',
        xAxis: ['Q1', 'Q2'],
        yName: 'USD',
        series: [{ name: 'revenue', data: [10.5, 20] }],
      },
    })
  })

  it('rejects non-object input', () => {
    for (const value of [null, undefined, 'bar', 42, [1, 2], true]) {
      const result = parseChartSpec(value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.message).toContain('object')
    }
  })

  it('rejects unknown kinds', () => {
    const result = parseChartSpec({ kind: 'gauge', series: [{ data: [1] }] })
    expect(result).toEqual({ ok: false, message: 'kind must be one of: bar, line, area, pie, scatter' })
  })

  it('rejects empty or oversized series', () => {
    const empty = parseChartSpec({ kind: 'bar', series: [] })
    expect(empty).toEqual({ ok: false, message: 'series must be a non-empty array' })
    const big = parseChartSpec({ kind: 'bar', series: Array.from({ length: 9 }, () => ({ data: [1] })) })
    expect(big).toEqual({ ok: false, message: 'series exceeds 8 entries' })
  })

  it('rejects non-finite data', () => {
    const nan = parseChartSpec({ kind: 'bar', series: [{ data: [1, NaN] }] })
    expect(nan).toEqual({ ok: false, message: 'series[0].data must contain finite numbers' })
    const inf = parseChartSpec({ kind: 'bar', series: [{ data: [1, Infinity] }] })
    expect(inf.ok).toBe(false)
    const strings = parseChartSpec({ kind: 'bar', series: [{ data: ['1'] }] })
    expect(strings.ok).toBe(false)
  })

  it('rejects oversize point count', () => {
    const result = parseChartSpec({ kind: 'bar', series: [{ data: Array.from({ length: 501 }, (_, i) => i) }] })
    expect(result).toEqual({ ok: false, message: 'series[0].data exceeds 500 points' })
  })

  it('rejects wrong field types', () => {
    for (const bad of [
      { kind: 'bar', series: [{ data: [1] }], title: 7 },
      { kind: 'bar', series: [{ data: [1] }], xAxis: [1] },
      { kind: 'bar', series: [{ data: [1] }], xAxis: ['ok', 2] },
      { kind: 'bar', series: [null] },
      { kind: 'bar', series: undefined },
    ]) {
      expect(parseChartSpec(bad).ok).toBe(false)
    }
  })

  it('bounds label length', () => {
    const result = parseChartSpec({ kind: 'bar', series: [{ data: [1] }], title: 'x'.repeat(121) })
    expect(result).toEqual({ ok: false, message: 'title exceeds 120 characters' })
  })
})
