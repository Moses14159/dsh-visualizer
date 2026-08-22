/**
 * svg-geometry tests: intrinsic size/aspect parsing and fitted frame heights.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WIDGET_HEIGHT,
  MAX_WIDGET_HEIGHT,
  MIN_WIDGET_HEIGHT,
  fittedWidgetHeight,
  svgAspectRatio,
  svgIntrinsicSize,
} from '../src/svg-geometry.ts'

describe('svgIntrinsicSize', () => {
  it('reads explicit width/height attributes', () => {
    expect(svgIntrinsicSize('<svg width="1500" height="1552">')).toEqual({ width: 1500, height: 1552 })
  })

  it('tolerates a px suffix and single quotes', () => {
    expect(svgIntrinsicSize(`<svg width='640px' height='480px'>`)).toEqual({ width: 640, height: 480 })
  })

  it('falls back to the viewBox when width/height are absent', () => {
    expect(svgIntrinsicSize('<svg viewBox="0 0 800 400"></svg>')).toEqual({ width: 800, height: 400 })
    expect(svgIntrinsicSize('<svg viewBox="10 20 300 150">')).toEqual({ width: 300, height: 150 })
  })

  it('prefers width/height over the viewBox', () => {
    expect(svgIntrinsicSize('<svg width="200" height="100" viewBox="0 0 800 800">')).toEqual({ width: 200, height: 100 })
  })

  it('rejects relative units, zeros, and malformed values', () => {
    expect(svgIntrinsicSize('<svg width="100%" height="100%">')).toBeUndefined()
    expect(svgIntrinsicSize('<svg width="0" height="480">')).toBeUndefined()
    expect(svgIntrinsicSize('<svg width="abc" height="480">')).toBeUndefined()
    expect(svgIntrinsicSize('<svg viewBox="0 0 0 0">')).toBeUndefined()
    expect(svgIntrinsicSize('<svg viewBox="0 0 800">')).toBeUndefined()
  })

  it('returns undefined for non-SVG content', () => {
    expect(svgIntrinsicSize('<div width="100" height="100"></div>')).toBeUndefined()
    expect(svgIntrinsicSize('')).toBeUndefined()
  })

  it('survives hostile-looking attribute payloads', () => {
    expect(svgIntrinsicSize('<svg width="300" height="200" onload="alert(1)">')).toEqual({ width: 300, height: 200 })
    expect(svgIntrinsicSize('<svg width="999999999999999999999" height="200">')).toEqual({ width: 999999999999999999999, height: 200 })
  })
})

describe('svgAspectRatio', () => {
  it('returns height / width', () => {
    expect(svgAspectRatio('<svg width="1000" height="500">')).toBe(0.5)
  })

  it('rounds long ratios to 6 decimals', () => {
    expect(svgAspectRatio('<svg width="3" height="1">')).toBe(0.333333)
  })

  it('returns undefined without any intrinsic size', () => {
    expect(svgAspectRatio('<svg></svg>')).toBeUndefined()
  })
})

describe('fittedWidgetHeight', () => {
  const svgWidget = { kind: 'svg' as const, code: '<svg width="1000" height="500">' }
  const htmlWidget = { kind: 'html' as const, code: '<div>hi</div>' }

  it('sizes an svg frame to container width times aspect', () => {
    expect(fittedWidgetHeight(800, svgWidget)).toBe(400)
  })

  it('clamps svg frames into the min/max bounds', () => {
    expect(fittedWidgetHeight(8000, svgWidget)).toBe(MAX_WIDGET_HEIGHT)
    expect(fittedWidgetHeight(10, svgWidget)).toBe(MIN_WIDGET_HEIGHT)
  })

  it('keeps the default height for html widgets', () => {
    expect(fittedWidgetHeight(800, htmlWidget)).toBe(DEFAULT_WIDGET_HEIGHT)
  })

  it('falls back to the default for svg without aspect or with bad width', () => {
    expect(fittedWidgetHeight(800, { kind: 'svg', code: '<svg></svg>' })).toBe(DEFAULT_WIDGET_HEIGHT)
    expect(fittedWidgetHeight(0, svgWidget)).toBe(DEFAULT_WIDGET_HEIGHT)
    expect(fittedWidgetHeight(-5, svgWidget)).toBe(DEFAULT_WIDGET_HEIGHT)
  })
})
