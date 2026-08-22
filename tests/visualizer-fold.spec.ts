/**
 * Fold-logic tests for the visualizer Definition. Pure: the module imports
 * only type mirrors (erased) — no cordis, no DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  VISUALIZER_KIND,
  VISUALIZE_TOOL,
  buildVisualizerViewNode,
  callIdOf,
  fallbackState,
  specFromResult,
} from '../src/client/visualizer-fold.ts'

/** Build a minimal tool/result event with the given JSON text content. */
function resultEvent(callId: string, text: string): { type: string; data: Record<string, unknown> & { callId?: unknown } } {
  return {
    type: 'tool/result',
    data: {
      turn: 0,
      step: 0,
      callId,
      message: {
        source: { callId },
        content: [{ type: 'text', text }],
      },
    },
  }
}

function callEvent(callId: string): { type: string; data: Record<string, unknown> & { callId?: unknown } } {
  return {
    type: 'tool/call',
    data: { turn: 0, step: 0, callId, name: VISUALIZE_TOOL, arguments: '{}' },
  }
}

/** Minimal context the fold reads. */
interface TestContext {
  key: string
  id: string
  matches: unknown[]
  start: unknown
  state: { callId: string; spec: unknown } | undefined
  current: Map<string, unknown>
}

function contextOf(state: TestContext['state'], start?: unknown, matches: unknown[] = []): TestContext {
  return { key: 'ctx-1', id: 'call-1', matches, start, state, current: new Map() }
}

describe('callIdOf', () => {
  it('returns the id only for visualize tool/call', () => {
    expect(callIdOf(callEvent('c1'))).toBe('c1')
    expect(callIdOf({ type: 'tool/call', data: { callId: 'c2', name: 'bash', arguments: '' } })).toBeUndefined()
    expect(callIdOf({ type: 'tool/result', data: { callId: '' } })).toBeUndefined()
  })

  it('reads the id from a tool/result message source', () => {
    expect(callIdOf(resultEvent('c3', '{}'))).toBe('c3')
  })
})

describe('specFromResult', () => {
  it('parses a valid ChartSpec JSON text', () => {
    const match = { event: resultEvent('c1', JSON.stringify({ kind: 'bar', series: [{ data: [1] }] })) } as never
    expect(specFromResult(match)).toEqual({ kind: 'bar', series: [{ data: [1] }] })
  })

  it('parses the REAL durable shape: tool-result block wrapping the text block', () => {
    // Reproduces the live session-log shape (verified against the running
    // DSH): message.content[0] is { type: 'tool-result', content: [...] }.
    const match = {
      event: {
        type: 'tool/result',
        data: {
          callId: 'c1',
          message: {
            source: { callId: 'c1' },
            content: [{
              type: 'tool-result',
              toolCallId: 'c1',
              content: [{ type: 'text', text: JSON.stringify({ kind: 'bar', xAxis: ['A', 'B'], series: [{ data: [10, 20] }] }) }],
            }],
          },
        },
      },
    } as never
    expect(specFromResult(match)).toEqual({
      kind: 'bar',
      xAxis: ['A', 'B'],
      series: [{ data: [10, 20] }],
    })
  })

  it('unwraps the host canonical envelope { spec: ChartSpec }', () => {
    // The host tool's render emits the whole canonical value as text, so the
    // parsed root wraps the spec in a `spec` key — the live bug this test
    // locks down.
    const match = {
      event: {
        type: 'tool/result',
        data: {
          callId: 'c1',
          message: {
            source: { callId: 'c1' },
            content: [{
              type: 'tool-result',
              toolCallId: 'c1',
              content: [{ type: 'text', text: JSON.stringify({ spec: { kind: 'pie', xAxis: ['a', 'b'], series: [{ data: [3, 4] }] } }) }],
            }],
          },
        },
      },
    } as never
    expect(specFromResult(match)).toEqual({
      kind: 'pie',
      xAxis: ['a', 'b'],
      series: [{ data: [3, 4] }],
    })
  })

  it('rejects malformed JSON and invalid specs (returns undefined)', () => {
    const bad = [
      '{not json',
      JSON.stringify({ kind: 'gauge', series: [{ data: [1] }] }),
      JSON.stringify({ kind: 'bar', series: [] }),
      JSON.stringify({ kind: 'bar', series: [{ data: [NaN] }] }),
    ]
    for (const text of bad) {
      const match = { event: resultEvent('c1', text) } as never
      expect(specFromResult(match)).toBeUndefined()
    }
  })

  it('ignores non-text blocks', () => {
    const match = {
      event: {
        type: 'tool/result',
        data: {
          callId: 'c1',
          message: { source: { callId: 'c1' }, content: [{ type: 'image' }] },
        },
      },
    } as never
    expect(specFromResult(match)).toBeUndefined()
  })
})

describe('buildVisualizerViewNode', () => {
  it('returns null while no spec is folded', () => {
    const node = buildVisualizerViewNode(contextOf({ callId: 'c1', spec: undefined }) as never)
    expect(node).toBeNull()
  })

  it('builds a visible chart node from folded state', () => {
    const spec = { kind: 'line', series: [{ data: [1, 2] }] }
    const node = buildVisualizerViewNode(contextOf({ callId: 'c1', spec }) as never)
    expect(node).toMatchObject({
      kind: VISUALIZER_KIND,
      target: 'chat',
      visibility: 'visible',
      data: { spec, callId: 'c1' },
    })
  })

  it('recovers a spec from result-only matches (cold replay)', () => {
    const spec = { kind: 'pie', xAxis: ['a'], series: [{ data: [1] }] }
    const match = { event: resultEvent('c1', JSON.stringify(spec)) } as never
    const state = fallbackState({ key: 'k', id: 'c1', kind: 'x', matches: [match], start: undefined, state: undefined } as never)
    expect(state).toEqual({ callId: 'c1', spec })
    const node = buildVisualizerViewNode({
      key: 'k', id: 'c1', matches: [match], start: undefined, state: undefined,
    } as never)
    expect(node).not.toBeNull()
  })
})
