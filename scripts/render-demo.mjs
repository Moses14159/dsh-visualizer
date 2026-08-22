/**
 * Renders the README demo assets using the plugin's OWN pure modules, but in a
 * chat-node frame that looks like the real DSH conversation (a header chip with
 * kind/title/status, the chart or widget body, and a "Tool call · visualize(…)"
 * footer). These are the "product-look" images referenced by the README.
 *
 *   docs/demo-chart.png        ->  chartSpecToOption() + echarts (line)
 *   docs/demo-chart-bar.png    ->  chartSpecToOption() + echarts (bar)
 *   docs/demo-widget-svg.png   ->  widgetSrcdoc() SVG widget in a sandboxed iframe
 *   docs/demo-widget-html.png  ->  widgetSrcdoc() HTML widget in a sandboxed iframe
 *   docs/demo-stream.gif       ->  an SVG widget streamed line-by-line
 *
 * Not shipped in lib/. Run with `pnpm render-demo` (needs a local Chrome and
 * `pnpm install`). Styling uses DSH `--dsw-alias-*` tokens, no literal colors.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { chartSpecToOption } from '../src/to-echarts.ts'
import { widgetSrcdoc } from '../src/to-iframe.ts'
import { fittedWidgetHeight } from '../src/svg-geometry.ts'
import { decodePng, encodeGif } from './gif.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const docs = join(root, 'docs')
mkdirSync(docs, { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const echarts = readFileSync(join(root, 'node_modules/echarts/dist/echarts.min.js'), 'utf8')

// DSH-like light theme tokens (product-compatible).
const TOKENS = `:root{
  --dsw-alias-bg-base:#f2f4f7;--dsw-alias-bg-layer-1:#ffffff;--dsw-alias-bg-layer-2:#fafbfc;
  --dsw-alias-border-l1:#e4e7ec;--dsw-alias-border-l2:#e9edf1;
  --dsw-alias-text-primary:#1f2937;--dsw-alias-text-secondary:#67707f;
  --dsw-alias-brand-primary:#4166e6;--dsw-alias-brand-primary-invert:#ffffff;
  --dsw-alias-bg-mask-1:rgba(31,41,55,.05);--dsw-alias-bg-mask-2:rgba(31,41,55,.08)
}body{margin:0;background:var(--dsw-alias-bg-base);font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}`

// Chat-node chrome shared by every demo: header chip + body + tool-call footer.
const CHROME_CSS = {
  '@': `.node{width:100%;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:16px;overflow:hidden}
.node-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-text-secondary)}
.chip{background:var(--dsw-alias-bg-mask-2);border-radius:6px;padding:2px 7px;font-weight:600;color:var(--dsw-alias-text-primary)}
.chip.kind{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary-invert)}
.node-title{color:var(--dsw-alias-text-primary)}
.badge{margin-left:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:1px 7px}
.node-foot{padding:8px 12px;border-top:1px solid var(--dsw-alias-border-l2);font-family:ui-monospace,Menlo,monospace;font-size:10.5px;color:var(--dsw-alias-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`,
}

function chatNode({ kind, title, badge, body, foot, width }) {
  return `<!doctype html><html><head><style>${TOKENS}${CHROME_CSS['@']}.wrap{width:${width}px;padding:26px;background:var(--dsw-alias-bg-base)}</style></head><body><div class="wrap"><div class="node"><div class="node-head"><span class="chip kind">${kind}</span><span class="chip">组件</span><span class="node-title">${title}</span><span class="badge">${badge}</span></div>${body}<div class="node-foot">${foot}</div></div></div></body></html>`
}

const WIDGET_LABEL = { svg: 'svg', html: 'html' }
const TOOL_FOOTER = (label) => `⚡ Tool call · visualize({${label}})`

/** An SVG widget used for both the static and the streamed demo. */
const SVG_CODE = `<svg width="360" height="200" viewBox="0 0 360 200" xmlns="http://www.w3.org/2000/svg">
<rect x="0" y="0" width="360" height="200" rx="18" fill="#22304f"/>
<text x="22" y="38" font-family="inherit" font-size="15" fill="#cfe0f5">深圳 · 实时天气</text>
<text x="22" y="104" font-family="inherit" font-size="48" font-weight="600" fill="#ffffff">29°C</text>
<text x="22" y="132" font-family="inherit" font-size="13" fill="#9fb6d8">小雨 · 体感 34°C</text>
<rect x="232" y="24" width="106" height="152" rx="12" fill="#2c3d63"/>
<text x="248" y="58" font-family="inherit" font-size="12" fill="#9fb6d8">湿度</text>
<text x="248" y="86" font-family="inherit" font-size="22" font-weight="600" fill="#ffffff">84%</text>
<text x="248" y="120" font-family="inherit" font-size="12" fill="#9fb6d8">西南风</text>
<text x="248" y="148" font-family="inherit" font-size="22" font-weight="600" fill="#ffffff">22</text>
</svg>`

const HTML_CODE = `<div style="padding:18px 20px;font-family:inherit;color:#1f2937"><strong style="font-size:16px">本周湿湿哒</strong><div style="margin-top:8px;font-size:13px;color:#67707f">连续 7 天有雷阵雨，周期累计降水约 <b>88 mm</b>，请随身带伞。</div><div style="margin-top:14px;display:flex;gap:10px;font-size:12px"><span style="background:#eef2fb;border-radius:8px;padding:6px 10px">💧 降水 88mm</span><span style="background:#eef2fb;border-radius:8px;padding:6px 10px">🌬️ 风 17.5km/h</span></div></div>`

async function renderChart(page, spec, file) {
  const option = JSON.stringify(chartSpecToOption(spec))
  const body = `<div style="padding:10px"><div id="c" style="width:640px;height:360px"></div></div>`
  await page.setContent(chatNode({ kind: spec.kind, title: spec.title ?? '', badge: '完成', body, foot: TOOL_FOOTER(`"spec":…`), width: 700 }))
  await page.addScriptTag({ content: echarts })
  await page.evaluate((opt) => { const c = echarts.init(document.getElementById('c')); c.setOption(JSON.parse(opt)) }, option)
  await page.waitForTimeout(900)
  const el = await page.$('.node')
  await el.screenshot({ path: join(docs, file) })
}

async function renderWidget(page, kind, widget, file) {
  const frameWidth = 380
  const src = widgetSrcdoc(widget)
  // HTML widgets have no intrinsic aspect; use a content-fitting height.
  const height = kind === 'svg' ? fittedWidgetHeight(frameWidth, widget) : 150
  const body = `<div style="padding:12px"><iframe sandbox="" id="fr" style="display:block;width:100%;height:${height}px;border:0;background:transparent"></iframe></div>`
  await page.setContent(chatNode({ kind: WIDGET_LABEL[kind], title: widget.title ?? '', badge: '完成', body, foot: TOOL_FOOTER(`"widget":{…}`), width: 700 }))
  // srcdoc is set programmatically so embedded quotes in the widget code are safe.
  await page.evaluate((s) => { document.getElementById('fr').srcdoc = s }, src)
  await page.waitForTimeout(500)
  const el = await page.$('.node')
  await el.screenshot({ path: join(docs, file) })
}

async function renderStreamGif(page, svgCode) {
  const frameWidth = 420
  const lines = svgCode.split('\n').filter((l) => l.trim() !== '')
  const body = `<div style="padding:12px"><iframe sandbox="" id="fr" style="display:block;width:100%;height:${fittedWidgetHeight(frameWidth, { kind: 'svg', code: svgCode })}px;border:0;background:transparent"></iframe></div>`
  await page.setContent(`<!doctype html><html><head><style>${TOKENS}${CHROME_CSS['@']}.wrap{display:grid;grid-template-columns:380px 1fr;gap:16px;padding:24px;background:var(--dsw-alias-bg-base);width:920px}.code{background:#0f1527;color:#cfe0f5;border-radius:12px;padding:14px;margin:0;font:11.5px/1.55 ui-monospace,Menlo,monospace;white-space:pre;overflow:hidden;height:280px}.node{width:100%}</style></head><body><div class="wrap"><pre class="code" id="code"></pre><div class="node"><div class="node-head"><span class="chip kind">svg</span><span class="chip">组件</span><span class="node-title">实时天气</span><span class="badge" id="badge">生成中</span></div>${body}<div class="node-foot">${TOOL_FOOTER('"widget":{…}')}</div></div></div></body></html>`)

  const frames = []
  const total = lines.length - 1
  for (let k = 0; k <= total; k++) {
    const bodyLines = lines.slice(1, k + 1)
    const code = ['<svg width="360" height="200" viewBox="0 0 360 200" xmlns="http://www.w3.org/2000/svg">', ...bodyLines].join('\n').trim()
    const done = k === total
    await page.evaluate(([code, done]) => {
      document.getElementById('code').textContent = '```svg\n' + code + '\n```'
      document.getElementById('fr').srcdoc = code
      const bad = document.getElementById('badge')
      bad.textContent = done ? '完成' : '生成中'
      bad.style.color = done ? '' : 'var(--dsw-alias-text-secondary)'
    }, [code, done])
    await page.waitForTimeout(220)
    frames.push(decodePng(await (await page.$('.wrap')).screenshot()))
  }
  const gif = encodeGif(frames, { width: frames[0].width, height: frames[0].height, delayMs: 200 })
  writeFileSync(join(docs, 'preview-stream.gif'), gif)
  console.log('wrote docs/preview-stream.gif', gif.length, 'bytes,', frames.length, 'frames')
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ deviceScaleFactor: 2 })

// Line chart (matches the "Beijing temperature" product screenshot).
await renderChart(page, {
  kind: 'line', title: '北京明天（周日）气温变化',
  xAxis: ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'],
  yName: '气温 (°C)',
  series: [{ name: '气温', data: [27, 26, 25, 25, 26, 29, 32, 34, 34, 33, 31, 29] }],
}, 'preview-chart-line.png')

// Bar chart (multi-series).
await renderChart(page, {
  kind: 'bar', title: '深圳 · 未来 7 天最高 / 最低气温',
  xAxis: ['周六', '周日', '周一', '周二', '周三', '周四', '周五'], yName: '°C',
  series: [{ name: '最高温', data: [32, 32, 30, 31, 29, 31, 32] }, { name: '最低温', data: [26, 27, 25, 25, 25, 25, 24] }],
}, 'preview-chart-bar.png')

await renderWidget(page, 'svg', { kind: 'svg', code: SVG_CODE, title: '实时天气' }, 'preview-widget-svg.png')
await renderWidget(page, 'html', { kind: 'html', code: HTML_CODE, title: '本周降水' }, 'preview-widget-html.png')

await renderStreamGif(page, SVG_CODE)

await browser.close()
console.log('demo assets written to', docs)
