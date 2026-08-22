/**
 * Widget code -> sandboxed iframe `srcdoc` document.
 *
 * The widget's raw code is inserted VERBATIM (no sanitizer, no markup
 * parsing): inside the iframe it is child-document content only, and the
 * frame is made inert by two independent layers —
 *
 * - the iframe carries `sandbox=""` (every capability disabled: no scripts,
 *   no same-origin, no forms/popups/navigation, opaque origin);
 * - the srcdoc injects a Content-Security-Policy meta that further denies
 *   scripts and all network/image origins except inline style and data:
 *   images.
 *
 * So a hostile `</body><script>…` inside the code cannot execute and cannot
 * reach the host page; the only residual risk is visual spoofing, bounded by
 * the widget card's chrome. This module is PURE (no DOM), so the srcdoc
 * string is unit-testable byte-for-byte.
 *
 * @module dsh-visualizer/to-iframe
 */

import type { WidgetKind } from './widget.ts'

/** CSP for every widget document: static rendering only. */
const WIDGET_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:"

/** Shared document head pieces (single assembly point, tested verbatim). */
const DOCUMENT_PREFIX = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${WIDGET_CSP}">`

/** Body styles: SVG scales to the frame width and grows the document with
 *  its aspect (min-height keeps the scroll box working when the frame is
 *  clamped); HTML is laid out top-left. */
const BODY_STYLE_SVG = '<style>html,body{margin:0;padding:0;min-height:100%;background:transparent}svg{display:block;max-width:100%;height:auto;margin:0 auto}</style>'
const BODY_STYLE_HTML = '<style>html,body{margin:0;padding:0;background:transparent}</style>'

/**
 * Build the complete srcdoc document for one validated widget.
 * @param widget - validated widget ({@link WidgetSpec} or accumulator).
 * @returns deterministic srcdoc string (pure function of the widget).
 */
export function widgetSrcdoc(widget: {
  readonly kind: WidgetKind
  readonly code: string
  readonly title?: string
}): string {
  const title = widget.title === undefined
    ? ''
    : `<title>${widget.title}</title>`
  const bodyStyle = widget.kind === 'svg' ? BODY_STYLE_SVG : BODY_STYLE_HTML
  return `${DOCUMENT_PREFIX}${title}${bodyStyle}</head><body>${widget.code}</body></html>`
}
