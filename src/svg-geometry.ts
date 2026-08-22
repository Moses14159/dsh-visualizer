/**
 * SVG intrinsic geometry helpers for widget frame sizing.
 *
 * A model-produced `<svg>` usually declares its natural size through
 * `width`/`height` attributes or a `viewBox`. The renderer needs that aspect
 * ratio to size the sandboxed iframe so a tall diagram renders at full width
 * (and thus at a readable text size) instead of being clipped to a fixed
 * height. Parsing is deliberately narrow and regex-only: the frame is the
 * security boundary, so this module only needs the first `<svg ...>` tag's
 * numeric hints — never a DOM parse.
 *
 * Pure module: no DSH imports, no DOM. Unit-tested in isolation.
 *
 * @module dsh-visualizer/svg-geometry
 */

/** Default frame height when a widget has no known intrinsic aspect. */
export const DEFAULT_WIDGET_HEIGHT = 340
/** Clamp bounds for a computed frame height (CSS px). */
export const MIN_WIDGET_HEIGHT = 180
export const MAX_WIDGET_HEIGHT = 700

/** One SVG's intrinsic width/height (in declared user units, treated as px). */
export interface SvgIntrinsicSize {
  readonly width: number
  readonly height: number
}

/** Match a numeric length with an optional `px` suffix (the common case). */
const LENGTH = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i

/** Parse one numeric length, tolerating a `px` suffix; rejects units that
 *  would break the px assumption (em/rem/%/pt) and non-finite values. */
function parseLength(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined
  const match = LENGTH.exec(raw)
  if (match === null) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

/** Extract one attribute's value from an opening tag (double or single quotes). */
function attrValue(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)
  return match?.[1]
}

/** Number of digits to keep when computing the aspect ratio (avoids float
 *  dust like 0.6999999999 from long decimal widths). */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

/**
 * Read an SVG's intrinsic size from its opening tag.
 *
 * Precedence: explicit `width`+`height` attributes, then the `viewBox`
 * (whose width/height are the 3rd and 4th values). Both fall back to
 * `undefined` when absent or malformed — the caller keeps its default.
 * @param code - raw SVG source (or any string; non-SVG yields undefined).
 * @returns `{ width, height }`, or undefined when no aspect is known.
 */
export function svgIntrinsicSize(code: string): SvgIntrinsicSize | undefined {
  const open = /<svg\b[^>]*>/i.exec(code)?.[0]
  if (open === undefined) return undefined
  const width = parseLength(attrValue(open, 'width'))
  const height = parseLength(attrValue(open, 'height'))
  if (width !== undefined && height !== undefined) return { width, height }
  const viewBox = attrValue(open, 'viewBox')?.trim().split(/[\s,]+/).map(Number)
  if (viewBox !== undefined && viewBox.length === 4
    && viewBox[2] > 0 && viewBox[3] > 0
    && Number.isFinite(viewBox[2]) && Number.isFinite(viewBox[3])) {
    return { width: viewBox[2], height: viewBox[3] }
  }
  return undefined
}

/** Aspect ratio (height / width) of an SVG, rounded to 6 decimals. */
export function svgAspectRatio(code: string): number | undefined {
  const size = svgIntrinsicSize(code)
  if (size === undefined) return undefined
  return round6(size.height / size.width)
}

/** One widget to size a frame for (kind + code; matches the widget contract). */
export interface SizableWidget {
  readonly kind: 'svg' | 'html'
  readonly code: string
}

/**
 * Compute the iframe height for a widget rendered at `containerWidth` CSS px.
 *
 * SVG widgets: `containerWidth * aspect`, clamped to
 * [{@link MIN_WIDGET_HEIGHT}, {@link MAX_WIDGET_HEIGHT}] — the full diagram
 * is visible at full width (no wasted clipping). HTML widgets have no
 * intrinsic aspect, so they keep {@link DEFAULT_WIDGET_HEIGHT}.
 * @param containerWidth - measured frame width (px); non-positive values fall
 *   back to the default height.
 * @param widget - widget payload.
 * @returns a bounded CSS-px height.
 */
export function fittedWidgetHeight(
  containerWidth: number,
  widget: SizableWidget,
): number {
  if (widget.kind === 'svg' && containerWidth > 0) {
    const ratio = svgAspectRatio(widget.code)
    if (ratio !== undefined) {
      const height = Math.round(containerWidth * ratio)
      return Math.min(MAX_WIDGET_HEIGHT, Math.max(MIN_WIDGET_HEIGHT, height))
    }
  }
  return DEFAULT_WIDGET_HEIGHT
}
