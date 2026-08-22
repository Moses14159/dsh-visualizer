/**
 * Replay a scripted session stream through the plugin's widget fold logic in
 * Node, simulating the engine's match/start/update/buildViewNode semantics
 * for the `visualizer-widget` context. If this produces a node here, the
 * client fold is correct for the same events the running DSH would log; if
 * not, the fold logic is the bug.
 *
 * Usage: pnpm build && node scripts/replay-widget.mjs
 */
import assert from 'node:assert/strict'
import {
  WIDGET_KIND,
  buildWidgetViewNode,
  fallbackWidgetState,
  widgetMatchOf,
  widgetStartState,
  widgetUpdateState,
  widgetSrcdoc,
} from '../lib/replay.js'

/** The assembled text (the final message replays the same fences). */
const FULL_TEXT = '这是说明\n'
  + '```svg 徽章\n<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#4f8"/></svg>\n```\n'
  + '再看一个\n```html\n<div>hello</div>\n```\n'
  + '未闭合的\n```html\n<b>live'

/** Scripted durable events (shapes mirror the real session log). */
const EVENTS = [
  { type: 'step/start', data: { turn: 1, step: 1 } },
  { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: '这是说明\n```sv' } } },
  { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'g 徽章\n<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18" fill="#4f8"/></svg>\n```\n再看一个\n```ht' } } },
  { type: 'assistant/chunk', data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'ml\n<div>hello</div>\n```\n未闭合的\n```html\n<b>live' } } },
  { type: 'assistant/message', data: { turn: 1, step: 1, message: { content: [{ type: 'text', text: FULL_TEXT }] } } },
]

/** Drive match/start/update in event order for one context. */
function fold(events) {
  let state
  let start
  const matches = []
  for (const event of events) {
    const ided = widgetMatchOf(event)
    if (ided === null) continue
    const match = { event, role: ided.role, location: { kind: 'unresolved' } }
    matches.push(match)
    if (state === undefined) {
      start = match
      state = widgetStartState({ key: 'k', kind: WIDGET_KIND, id: ided.id, matches, start, state: undefined, current: new Map() }, match)
    } else {
      state = widgetUpdateState({ key: 'k', kind: WIDGET_KIND, id: ided.id, matches, start, state, current: new Map() }, match)
    }
  }
  return { state, matches, start }
}

const { state, matches, start } = fold(EVENTS)
assert.ok(state !== undefined, 'fold produced no state')

const node = buildWidgetViewNode({
  key: 'k', kind: WIDGET_KIND, id: 'step:1:1', matches, start, state, current: new Map(),
})
assert.ok(node !== null, 'buildWidgetViewNode produced no node')
assert.equal(node.kind, WIDGET_KIND)
assert.equal(node.visibility, 'visible')

const { widgets, source, dropped } = node.data
assert.equal(source, 'stream')
assert.equal(dropped, 0)
assert.equal(widgets.length, 3)
assert.deepEqual(widgets.map(acc => [acc.kind, acc.closed]), [
  ['svg', true],
  ['html', true],
  ['html', false],
], 'two closed widgets + one live (unclosed) widget')
assert.equal(widgets[0].title, '徽章', 'open-line info text becomes the title')

console.log(`fold ok: ${widgets.length} widgets (${widgets.filter(acc => acc.closed).length} closed, ${widgets.filter(acc => !acc.closed).length} live)`)
console.log('--- first widget srcdoc ---')
console.log(widgetSrcdoc(widgets[0]).slice(0, 220) + ' …')

// Cold replay path: chunk-less window must recover the same widgets from the
// final assistant message text.
const cold = fallbackWidgetState({ key: 'k', kind: WIDGET_KIND, id: 'step:1:1', matches, start, state: undefined, current: new Map() })
assert.ok(cold !== undefined, 'cold replay recovered no state')
assert.equal(cold.widgets.length, 3, 'cold replay keeps closed + unclosed widgets')
assert.deepEqual(cold.widgets.map(acc => [acc.kind, acc.closed]), [
  ['svg', true],
  ['html', true],
  ['html', false],
])
console.log('cold replay ok:', cold.widgets.map(acc => acc.kind).join(', '))
console.log('replay-widget: PASS')
