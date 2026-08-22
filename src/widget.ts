/**
 * WidgetSpec: the model-facing widget contract of dsh-visualizer, plus the
 * streaming fence scanner that turns model text deltas into widgets.
 *
 * A widget is raw SVG or HTML produced by the model. It arrives through two
 * paths that share this module as the single source of truth:
 *
 * - `visualize` tool argument (`widget` parameter, host half) — complete,
 *   validated on the host with {@link parseWidgetSpec};
 * - fenced code blocks in the model's streamed text response — the client
 *   half feeds `assistant/chunk` text deltas through {@link WidgetScanner}
 *   and renders each completed fence as a live-updating widget node.
 *
 * Widget code is UNTRUSTED content: it is never validated for markup
 * correctness (any byte sequence can be valid SVG/HTML-in-progress while
 * streaming). The security boundary is therefore rendering-side — a
 * sandboxed iframe plus CSP (see `to-iframe.ts`) — while this module only
 * enforces bounds (bytes, counts, closed vocabularies) so rendering stays
 * finite no matter what the model emits.
 *
 * This module is PURE — no DSH imports, no DOM — so host validation, client
 * folding, and unit tests share one contract.
 *
 * @module dsh-visualizer/widget
 */

/** Widget kinds the renderer knows (closed vocabulary). */
export type WidgetKind = 'svg' | 'html'

/** Upper bound on one widget's code, in UTF-8 bytes. */
export const MAX_WIDGET_BYTES = 128 * 1024
/** Upper bound on an optional title, in characters. */
export const MAX_WIDGET_TITLE = 120
/** Upper bound on widgets materialized into one chat node. */
export const MAX_WIDGETS_PER_NODE = 12
/** Upper bound on the total UTF-8 bytes of one chat node's widgets. */
export const MAX_NODE_WIDGET_BYTES = 512 * 1024

/** Validated widget payload. */
export interface WidgetSpec {
  readonly kind: WidgetKind
  /** Raw SVG document (starts with `<svg`) or HTML body content. */
  readonly code: string
  readonly title?: string
}

/** One widget folded for rendering: a spec plus its lifecycle facts. */
export interface WidgetAcc extends WidgetSpec {
  /** True when the producing fence/tool call completed; false while live. */
  readonly closed: boolean
  /** True when accumulation hit {@link MAX_WIDGET_BYTES} and dropped the rest. */
  readonly overflow: boolean
}

/** Rejection reason; `parseWidgetSpec(null)`-style callers report the message. */
export interface WidgetParseError {
  readonly ok: false
  readonly message: string
}

/** Accepted parse result. */
export interface WidgetParseOk {
  readonly ok: true
  readonly widget: WidgetSpec
}

export type WidgetParseResult = WidgetParseOk | WidgetParseError

/** UTF-8 byte length of a string (TextEncoder is global in Node and browsers). */
const encoder = new TextEncoder()

export function utf8ByteLength(text: string): number {
  return encoder.encode(text).length
}

/** Bound one optional title string. */
function boundTitle(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('title must be a string')
  if (value.length === 0) throw new Error('title must not be empty')
  if (value.length > MAX_WIDGET_TITLE) throw new Error(`title exceeds ${MAX_WIDGET_TITLE} characters`)
  return value
}

/**
 * Validate untrusted JSON into a WidgetSpec.
 * @param input - unknown payload (tool argument).
 * @returns the validated widget, or a rejection reason.
 */
export function parseWidgetSpec(input: unknown): WidgetParseResult {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'widget spec must be an object' }
  }
  const record = input as Record<string, unknown>
  try {
    const kind = record['kind']
    if (kind !== 'svg' && kind !== 'html') {
      throw new Error('kind must be one of: svg, html')
    }
    const code = record['code']
    if (typeof code !== 'string') throw new Error('code must be a string')
    if (code.trim() === '') throw new Error('code must not be empty')
    if (utf8ByteLength(code) > MAX_WIDGET_BYTES) {
      throw new Error(`code exceeds ${MAX_WIDGET_BYTES} bytes`)
    }
    const title = boundTitle(record['title'])
    return {
      ok: true,
      widget: {
        kind,
        code,
        ...title === undefined ? {} : { title },
      },
    }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Open-fence lines: up to three leading spaces (CommonMark), exactly three
 * backticks, then one of the known kinds, then optional info text.
 */
const FENCE_OPEN = /^\s{0,3}```(svg|html)(?:\s+(.*?))?\s*$/
/** Close-fence lines: only backticks, at least three (CommonMark: a closing
 *  fence may be longer than the opening one; any letters keep it content). */
const FENCE_CLOSE = /^\s{0,3}```+\s*$/

/** Immutable incremental state of the streaming fence scanner. */
export interface WidgetScannerState {
  /** Kind of the currently open fence; undefined while outside a fence. */
  readonly kind: WidgetKind | undefined
  /** Title captured from the open line's info text. */
  readonly title: string | undefined
  /** Accumulated content lines (each complete line carries its '\n'). */
  readonly content: string
  /** UTF-8 bytes of {@link content}. */
  readonly bytes: number
  /** True once accumulation stopped at {@link MAX_WIDGET_BYTES}. */
  readonly overflow: boolean
  /** Partial current line (no '\n' seen yet). */
  readonly pending: string
  /** Completed widgets emitted by fences that closed. */
  readonly closed: readonly WidgetAcc[]
}

/** Fresh scanner state (shared; immutable updates never mutate it). */
export const EMPTY_SCANNER: WidgetScannerState = Object.freeze({
  kind: undefined,
  title: undefined,
  content: '',
  bytes: 0,
  overflow: false,
  pending: '',
  closed: [],
})

/** Strip one trailing newline (content stores one per complete line). */
function stripTrailingNewline(content: string): string {
  return content.endsWith('\n') ? content.slice(0, -1) : content
}

/** Build the accumulator for a fence that opened and is live/closed now. */
function accOf(kind: WidgetKind, title: string | undefined, content: string, closed: boolean, overflow: boolean): WidgetAcc {
  return {
    kind,
    code: stripTrailingNewline(content),
    ...title === undefined ? {} : { title },
    closed,
    overflow,
  }
}

/** Process one complete line (no newline, no carriage return). */
function pushLine(state: WidgetScannerState, line: string): WidgetScannerState {
  if (state.kind === undefined) {
    const open = FENCE_OPEN.exec(line)
    if (open === null) return state
    const kind = open[1] as WidgetKind
    const info = (open[2] ?? '').trim()
    return {
      kind,
      title: info === '' ? undefined : info.slice(0, MAX_WIDGET_TITLE),
      content: '',
      bytes: 0,
      overflow: false,
      pending: '',
      closed: state.closed,
    }
  }
  if (FENCE_CLOSE.test(line)) {
    if (state.content === '') return { ...EMPTY_SCANNER, closed: state.closed }
    const acc = accOf(state.kind, state.title, state.content, true, state.overflow)
    return { ...EMPTY_SCANNER, closed: [...state.closed, acc] }
  }
  if (state.overflow) return state
  const piece = `${line}\n`
  const pieceBytes = utf8ByteLength(piece)
  if (state.bytes + pieceBytes > MAX_WIDGET_BYTES) return { ...state, overflow: true }
  return { ...state, content: state.content + piece, bytes: state.bytes + pieceBytes }
}

/**
 * Feed one raw text delta into the scanner. Deltas may split lines at any
 * byte; the scanner buffers the partial line and only complete lines drive
 * the fence state machine, so the same content folds identically however the
 * provider chunks it.
 * @param state - current scanner state.
 * @param text - one model text delta.
 * @returns next scanner state (immutable update).
 */
export function pushScannerText(state: WidgetScannerState, text: string): WidgetScannerState {
  if (text === '') return state
  const parts = `${state.pending}${text}`.split('\n')
  const pending = parts.pop() ?? ''
  let next: WidgetScannerState = { ...state, pending }
  for (const raw of parts) {
    next = pushLine(next, raw.endsWith('\r') ? raw.slice(0, -1) : raw)
  }
  return { ...next, pending }
}

/**
 * Close the scanner at stream/message end: a fence left open by an
 * interrupted or never-closed stream becomes an incomplete accumulator
 * (rendered with a live/incomplete badge), never dropped silently. The
 * partial pending line counts as content — the model may stop mid-line.
 * @param state - final scanner state.
 * @returns every completed widget plus the incomplete one, in opening order.
 */
export function finishScanner(state: WidgetScannerState): readonly WidgetAcc[] {
  const closed = [...state.closed]
  if (state.kind !== undefined) {
    const code = state.content + state.pending
    if (code !== '') closed.push(accOf(state.kind, state.title, code, false, state.overflow))
  }
  return closed
}
