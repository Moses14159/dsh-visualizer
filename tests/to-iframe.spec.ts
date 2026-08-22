/**
 * srcdoc builder tests: the sandbox document for one widget is deterministic
 * and carries both security layers (sandbox is an iframe attribute in the
 * renderer; the srcdoc carries the CSP). Code is inserted verbatim — the
 * tests pin that no sanitizer/escape mutates content, because the security
 * boundary is the inert frame, not string munging.
 */
import { describe, expect, it } from 'vitest'
import { widgetSrcdoc } from '../src/to-iframe.ts'

describe('widgetSrcdoc', () => {
  it('builds a complete html document with the CSP meta and verbatim code', () => {
    const doc = widgetSrcdoc({ kind: 'html', code: '<p class="a">hi</p>' })
    expect(doc.startsWith('<!DOCTYPE html><html><head><meta charset="utf-8">')).toBe(true)
    expect(doc).toContain(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:">`,
    )
    expect(doc).toContain('<body><p class="a">hi</p></body></html>')
  })

  it('wraps svg documents with body scaling styles', () => {
    const doc = widgetSrcdoc({ kind: 'svg', code: '<svg viewBox="0 0 10 10"></svg>' })
    expect(doc).toContain('svg{display:block;max-width:100%;height:auto;margin:0 auto}')
    expect(doc).toContain('<body><svg viewBox="0 0 10 10"></svg></body></html>')
  })

  it('injects the title verbatim into the child document head', () => {
    const doc = widgetSrcdoc({ kind: 'html', code: 'x', title: '指标卡' })
    expect(doc).toContain('<title>指标卡</title>')
  })

  it('omits the title element when absent', () => {
    const doc = widgetSrcdoc({ kind: 'html', code: 'x' })
    expect(doc).not.toContain('<title>')
  })

  it('keeps hostile markup verbatim — sandbox + CSP are the boundary, not string cleanup', () => {
    const code = '</body></html><script>parent.postMessage("pwn", "*")</script><img src=x onerror=alert(1)>'
    const doc = widgetSrcdoc({ kind: 'html', code })
    expect(doc).toContain(code)
    // The CSP meta appears before the code and denies scripts by default.
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf(code))
  })

  it('is deterministic', () => {
    const widget = { kind: 'html' as const, code: '<b>x</b>', title: 't' }
    expect(widgetSrcdoc(widget)).toBe(widgetSrcdoc(widget))
  })
})
