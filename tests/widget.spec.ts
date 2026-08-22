/**
 * Widget contract tests: parseWidgetSpec validation + the streaming fence
 * scanner (pushScannerText / finishScanner). Pure node environment.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCANNER,
  MAX_WIDGET_BYTES,
  MAX_WIDGET_TITLE,
  finishScanner,
  parseWidgetSpec,
  pushScannerText,
  utf8ByteLength,
} from '../src/widget.ts'

function scan(deltas: readonly string[]) {
  let state = EMPTY_SCANNER
  for (const delta of deltas) state = pushScannerText(state, delta)
  return { state, done: finishScanner(state) }
}

describe('parseWidgetSpec', () => {
  it('accepts a minimal svg widget', () => {
    expect(parseWidgetSpec({ kind: 'svg', code: '<svg></svg>' })).toEqual({
      ok: true,
      widget: { kind: 'svg', code: '<svg></svg>' },
    })
  })

  it('accepts an html widget with title', () => {
    expect(parseWidgetSpec({ kind: 'html', code: '<p>hi</p>', title: '卡' })).toEqual({
      ok: true,
      widget: { kind: 'html', code: '<p>hi</p>', title: '卡' },
    })
  })

  it('rejects non-objects, unknown kinds, and invalid code', () => {
    const bad = [
      null,
      [],
      { kind: 'mermaid', code: 'x' },
      { kind: 'svg', code: 42 },
      { kind: 'svg', code: '   ' },
      { kind: 'svg', code: 'x', title: 7 },
      { kind: 'svg', code: 'x', title: '' },
      { kind: 'svg', code: 'x', title: 'a'.repeat(MAX_WIDGET_TITLE + 1) },
    ]
    for (const input of bad) expect(parseWidgetSpec(input).ok).toBe(false)
  })

  it('rejects code over the byte cap (multibyte counted as UTF-8)', () => {
    const code = '好'.repeat(MAX_WIDGET_BYTES) // 3 bytes per char
    const result = parseWidgetSpec({ kind: 'html', code })
    expect(result.ok).toBe(false)
  })

  it('reports the rejection reason', () => {
    const result = parseWidgetSpec({ kind: 'gif', code: 'x' })
    expect(result).toEqual({ ok: false, message: 'kind must be one of: svg, html' })
  })
})

describe('utf8ByteLength', () => {
  it('counts multibyte characters as multiple bytes', () => {
    expect(utf8ByteLength('a')).toBe(1)
    expect(utf8ByteLength('好')).toBe(3)
    expect(utf8ByteLength('🎉')).toBe(4)
  })
})

describe('WidgetScanner', () => {
  it('folds one closed svg fence into a closed accumulator', () => {
    const { state, done } = scan(['```svg\n<svg viewBox="0 0 1 1"/>\n```\n'])
    expect(state.kind).toBeUndefined()
    expect(state.closed).toEqual([
      { kind: 'svg', code: '<svg viewBox="0 0 1 1"/>', closed: true, overflow: false },
    ])
    expect(done).toEqual(state.closed)
  })

  it('captures the info text as the title (bounded)', () => {
    const { state } = scan([`\`\`\`html 指标卡 ${'x'.repeat(300)}\n<b>hi</b>\n\`\`\`\n`])
    expect(state.closed[0]?.title).toBe(`指标卡 ${'x'.repeat(300)}`.slice(0, MAX_WIDGET_TITLE))
  })

  it('recognizes fences split across arbitrary deltas', () => {
    const { state } = scan(['``', '`sv', 'g\n<svg', '></svg>', '\n``', '`\n'])
    expect(state.closed).toHaveLength(1)
    expect(state.closed[0]?.code).toBe('<svg></svg>')
  })

  it('treats a non-closing kind line inside a fence as content', () => {
    const { state } = scan(['```svg\nline1\n```html nope\n```\n'])
    expect(state.closed).toEqual([
      { kind: 'svg', code: 'line1\n```html nope', closed: true, overflow: false },
    ])
  })

  it('ignores lookalike fences: wrong kind, 4-space indent, no whitespace after kind', () => {
    const { state } = scan(['```htmx\nx\n```\n', '    ```svg\ny\n```\n', '```svgx\na\n```\n'])
    expect(state.closed).toEqual([])
    // Every delta ended with a newline, so nothing stays pending.
    expect(state.pending).toBe('')
  })

  it('accepts up to three leading spaces on fence lines', () => {
    const { state } = scan(['  ```html\n<b>ok</b>\n   ```\n'])
    expect(state.closed).toHaveLength(1)
    expect(state.closed[0]?.code).toBe('<b>ok</b>')
  })

  it('closes on a longer backtick run (CommonMark closing fence)', () => {
    const { state } = scan(['```svg\n<svg/>\n````\n'])
    expect(state.closed).toEqual([
      { kind: 'svg', code: '<svg/>', closed: true, overflow: false },
    ])
  })

  it('finalizes an unclosed fence as an incomplete accumulator', () => {
    const { done } = scan(['```svg\n<svg><rect', ' width="10"/>\n'])
    expect(done).toEqual([
      { kind: 'svg', code: '<svg><rect width="10"/>', closed: false, overflow: false },
    ])
  })

  it('emits no accumulator for an empty fence', () => {
    const { state, done } = scan(['```html\n```\n'])
    expect(state.closed).toEqual([])
    expect(done).toEqual([])
  })

  it('accumulates multiple sequential fences in opening order', () => {
    const { state, done } = scan(['```svg\nA\n```\n```html\nB\n```\n```svg\nC\n'])
    // Closed accs land in state.closed; the still-open fence joins at finish.
    expect(state.closed.map(acc => [acc.kind, acc.code, acc.closed])).toEqual([
      ['svg', 'A', true],
      ['html', 'B', true],
    ])
    expect(done.map(acc => [acc.kind, acc.code, acc.closed])).toEqual([
      ['svg', 'A', true],
      ['html', 'B', true],
      ['svg', 'C', false],
    ])
  })

  it('marks overflow when accumulation crosses the byte cap', () => {
    const line = 'x'.repeat(1024) + '\n'
    const { state } = scan([`\`\`\`html\n${line.repeat(2 * MAX_WIDGET_BYTES / 1024)}\`\`\`\n`])
    expect(state.closed).toHaveLength(1)
    expect(state.closed[0]?.overflow).toBe(true)
    expect(state.closed[0]?.closed).toBe(true)
    expect(utf8ByteLength(state.closed[0]?.code ?? '')).toBeLessThanOrEqual(MAX_WIDGET_BYTES)
  })

  it('keeps scanning after an overflowed fence (dropped) and folds the next one', () => {
    // The first fence's opening content line already exceeds the cap, so
    // nothing renderable accumulated — it is dropped at close; the following
    // fence folds normally.
    const big = 'y'.repeat(MAX_WIDGET_BYTES)
    const { state } = scan([`\`\`\`html\n${big}\n<p>tail</p>\n\`\`\`\n\`\`\`svg\nz\n\`\`\`\n`])
    expect(state.closed).toEqual([
      { kind: 'svg', code: 'z', closed: true, overflow: false },
    ])
  })

  it('is an immutable update: the empty state stays frozen', () => {
    expect(Object.isFrozen(EMPTY_SCANNER)).toBe(true)
    const next = pushScannerText(EMPTY_SCANNER, '```svg\nx\n```\n')
    expect(EMPTY_SCANNER.closed).toEqual([])
    expect(next.closed).toHaveLength(1)
  })
})
