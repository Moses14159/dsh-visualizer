/**
 * Fold-logic tests for the widget Definition. Pure: the module imports only
 * type mirrors (erased) plus the shared widget contract — no cordis, no DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_SCANNER,
  MAX_NODE_WIDGET_BYTES,
  MAX_WIDGETS_PER_NODE,
  pushScannerText,
  type WidgetAcc,
} from '../src/widget.ts'
import {
  WIDGET_KIND,
  buildWidgetViewNode,
  fallbackWidgetState,
  widgetFromResult,
  widgetMatchOf,
  widgetStartState,
  widgetUpdateState,
  type WidgetContextState,
} from '../src/client/widget-fold.ts'

/** Scripted session events (minimal durable shapes). */
function stepStart(turn = 1, step = 1) {
  return { type: 'step/start', data: { turn, step } }
}

function chunk(turn = 1, step = 1, text = '', chunkType = 'text-delta') {
  return { type: 'assistant/chunk', data: { turn, step, chunk: { type: chunkType, index: 0, text } } }
}

function message(turn = 1, step = 1, text = '') {
  return { type: 'assistant/message', data: { turn, step, message: { content: [{ type: 'text', text }] } } }
}

function retry(turn = 1, step = 1) {
  return { type: 'llm/retry', data: { turn, step } }
}

function toolCall(callId: string) {
  return { type: 'tool/call', data: { turn: 1, step: 1, callId, name: 'visualize', arguments: '{}' } }
}

function toolResult(callId: string, value: unknown) {
  return {
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: {
        source: { callId },
        content: [{
          type: 'tool-result',
          toolCallId: callId,
          content: [{ type: 'text', text: JSON.stringify(value) }],
        }],
      },
    },
  }
}

/** Minimal context the fold reads. */
interface TestContext {
  key: string
  id: string
  matches: unknown[]
  start: unknown
  state: WidgetContextState | undefined
  current: Map<string, unknown>
}

function contextOf(state?: WidgetContextState, start?: unknown, matches: unknown[] = []): TestContext {
  return { key: 'k', id: 'step:1:1', matches, start, state, current: new Map() }
}

function matchOf(event: unknown, role: 'start' | 'update' = 'update') {
  return { event, role, location: { kind: 'unresolved' } }
}

/** Drive the engine's match/start/update semantics over one context's events. */
function fold(events: unknown[]): WidgetContextState | undefined {
  let state: WidgetContextState | undefined
  let start: unknown
  const matches: unknown[] = []
  for (const event of events) {
    const ided = widgetMatchOf(event as { type: string; data: Record<string, unknown> })
    if (ided === null) continue
    const match = matchOf(event, ided.role)
    matches.push(match)
    if (state === undefined) {
      start = match
      state = widgetStartState(contextOf(undefined, start, [match]) as never, match as never)
    } else {
      state = widgetUpdateState({ ...contextOf(state), matches } as never, match as never)
    }
  }
  return state
}

const SVG = '```svg\n<svg viewBox="0 0 1 1"/>\n```\n'

describe('widgetMatchOf', () => {
  it('identifies step-scoped stream events by turn:step', () => {
    expect(widgetMatchOf(stepStart(2, 3))).toEqual({ id: 'step:2:3', role: 'start' })
    expect(widgetMatchOf(chunk(2, 3, 'x'))).toEqual({ id: 'step:2:3', role: 'update' })
    expect(widgetMatchOf(message(2, 3, 'x'))).toEqual({ id: 'step:2:3', role: 'update' })
    expect(widgetMatchOf(retry(2, 3))).toEqual({ id: 'step:2:3', role: 'update' })
  })

  it('rejects stream events without valid turn/step', () => {
    expect(widgetMatchOf({ type: 'assistant/chunk', data: { turn: 'x', step: 1, chunk: {} } })).toBeNull()
  })

  it('identifies visualize tool calls and results by widget:callId', () => {
    expect(widgetMatchOf(toolCall('c1'))).toEqual({ id: 'widget:c1', role: 'start' })
    expect(widgetMatchOf(toolResult('c1', { widget: {} }))).toEqual({ id: 'widget:c1', role: 'update' })
    expect(widgetMatchOf({ type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: '' } })).toBeNull()
  })

  it('ignores unrelated events', () => {
    expect(widgetMatchOf({ type: 'user/message', data: {} })).toBeNull()
  })
})

describe('stream fold', () => {
  it('accumulates a closed fence from chunk deltas', () => {
    const state = fold([stepStart(), chunk(1, 1, '```sv'), chunk(1, 1, 'g\n<svg/>\n```'), chunk(1, 1, '\n')])
    expect(state?.source).toBe('stream')
    expect(state?.scan.closed).toEqual([
      { kind: 'svg', code: '<svg/>', closed: true, overflow: false },
    ])
  })

  it('publishes a live node with the open fence while streaming', () => {
    const state = fold([stepStart(), chunk(1, 1, '```html\n<div>进度')])
    const node = buildWidgetViewNode(contextOf(state) as never)
    expect(node).toMatchObject({
      kind: WIDGET_KIND,
      target: 'chat',
      visibility: 'visible',
      data: {
        source: 'stream',
        dropped: 0,
        widgets: [{ kind: 'html', code: '<div>进度', closed: false }],
      },
    })
  })

  it('finalizes the step on assistant/message (unclosed fence stays incomplete)', () => {
    const state = fold([stepStart(), chunk(1, 1, '```svg\n<svg>'), message(1, 1, '```svg\n<svg>')])
    expect(state?.settled).toBe(true)
    const node = buildWidgetViewNode(contextOf(state) as never)
    expect(node).not.toBeNull()
    expect((node as { data: { widgets: WidgetAcc[] } }).data.widgets).toEqual([
      { kind: 'svg', code: '<svg>', closed: false, overflow: false },
    ])
  })

  it('ignores later chunks after settlement', () => {
    const settled = fold([stepStart(), chunk(1, 1, SVG), message(1, 1, SVG)])
    const state = widgetUpdateState({ ...contextOf(settled) } as never, matchOf(chunk(1, 1, '```html\nx\n```\n')) as never)
    expect(state.scan.closed).toEqual([])
  })

  it('resets everything on llm/retry', () => {
    const before = fold([stepStart(), chunk(1, 1, SVG), retry()])
    expect(before?.settled).toBe(false)
    expect(before?.scan).toEqual(EMPTY_SCANNER)
    expect(before?.widgets).toEqual([])
  })

  it('ignores non-text chunks (usage/finish/tool-call deltas)', () => {
    const state = fold([stepStart(), chunk(1, 1, 'x', 'usage'), chunk(1, 1, 'y', 'finish'), chunk(1, 1, 'z', 'tool-call-delta')])
    expect(state?.scan.closed).toEqual([])
    expect(state?.scan.pending).toBe('')
  })
})

describe('tool fold', () => {
  it('folds a widget-carrying tool result into one closed widget', () => {
    const state = fold([toolCall('c1'), toolResult('c1', { widget: { kind: 'html', code: '<b>x</b>', title: '卡' } })])
    expect(state?.source).toBe('tool')
    expect(state?.callId).toBe('c1')
    expect(state?.widgets).toEqual([
      { kind: 'html', code: '<b>x</b>', title: '卡', closed: true, overflow: false },
    ])
  })

  it('accepts a bare WidgetSpec result without the envelope', () => {
    const match = matchOf(toolResult('c2', { kind: 'svg', code: '<svg/>' }))
    expect(widgetFromResult(match as never)).toEqual({ kind: 'svg', code: '<svg/>' })
  })

  it('leaves chart results to the chart definition (no node)', () => {
    const state = fold([toolCall('c3'), toolResult('c3', { spec: { kind: 'bar', series: [{ data: [1] }] } })])
    expect(state?.widgets).toEqual([])
    expect(buildWidgetViewNode(contextOf(state) as never)).toBeNull()
  })

  it('rejects malformed widget payloads', () => {
    const match = matchOf(toolResult('c4', { widget: { kind: 'mermaid', code: 'x' } }))
    expect(widgetFromResult(match as never)).toBeUndefined()
  })
})

describe('fallbackWidgetState (cold replay)', () => {
  it('recovers stream widgets from the final assistant message text', () => {
    const matches = [matchOf(message(1, 1, SVG), 'update')]
    const state = fallbackWidgetState(contextOf(undefined, undefined, matches) as never)
    expect(state?.source).toBe('stream')
    expect(state?.widgets).toEqual([
      { kind: 'svg', code: '<svg viewBox="0 0 1 1"/>', closed: true, overflow: false },
    ])
    const node = buildWidgetViewNode(contextOf(undefined, undefined, matches) as never)
    expect(node).not.toBeNull()
  })

  it('recovers tool widgets from a result-only window', () => {
    const matches = [matchOf(toolResult('c9', { widget: { kind: 'svg', code: '<svg/>' } }), 'update')]
    const state = fallbackWidgetState(contextOf(undefined, undefined, matches) as never)
    expect(state?.source).toBe('tool')
    expect(state?.callId).toBe('c9')
  })

  it('recovers nothing from unrelated windows', () => {
    const matches = [matchOf(message(1, 1, 'no fences here'), 'update')]
    expect(fallbackWidgetState(contextOf(undefined, undefined, matches) as never)).toBeUndefined()
  })
})

describe('buildWidgetViewNode', () => {
  it('returns null while no widget is folded', () => {
    expect(buildWidgetViewNode(contextOf(fold([stepStart()])) as never)).toBeNull()
    expect(buildWidgetViewNode(contextOf(undefined) as never)).toBeNull()
  })

  it('caps the widget count and reports the dropped ones', () => {
    const acc: WidgetAcc = { kind: 'html', code: 'x', closed: true, overflow: false }
    const state: WidgetContextState = {
      source: 'stream', turn: 1, step: 1, scan: EMPTY_SCANNER,
      widgets: Array.from({ length: MAX_WIDGETS_PER_NODE + 2 }, () => acc), settled: true,
    }
    const node = buildWidgetViewNode(contextOf(state) as never) as { data: { widgets: unknown[]; dropped: number } }
    expect(node.data.widgets).toHaveLength(MAX_WIDGETS_PER_NODE)
    expect(node.data.dropped).toBe(2)
  })

  it('caps total widget bytes', () => {
    const big: WidgetAcc = {
      kind: 'html',
      code: 'x'.repeat(Math.floor(MAX_NODE_WIDGET_BYTES / 2) + 1),
      closed: true,
      overflow: false,
    }
    const state: WidgetContextState = {
      source: 'stream', turn: 1, step: 1, scan: EMPTY_SCANNER, widgets: [big, big], settled: true,
    }
    const node = buildWidgetViewNode(contextOf(state) as never) as { data: { widgets: unknown[]; dropped: number } }
    expect(node.data.widgets).toHaveLength(1)
    expect(node.data.dropped).toBe(1)
  })

  it('materializes live + closed accs in opening order', () => {
    let scan = EMPTY_SCANNER
    scan = pushScannerText(scan, '```svg\nA\n```\n```html\nB\n')
    const state: WidgetContextState = { source: 'stream', turn: 1, step: 1, scan, widgets: [], settled: false }
    const node = buildWidgetViewNode(contextOf(state) as never) as { data: { widgets: WidgetAcc[] } }
    expect(node.data.widgets.map(acc => [acc.kind, acc.code, acc.closed])).toEqual([
      ['svg', 'A', true],
      ['html', 'B', false],
    ])
  })
})
