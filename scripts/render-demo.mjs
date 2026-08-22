/**
 * Renders the README demo assets using the plugin's OWN pure modules:
 *
 *   docs/demo-chart.png       ->  chartSpecToOption() + echarts
 *   docs/demo-widget-svg.png  ->  widgetSrcdoc() SVG widget in a sandboxed iframe
 *   docs/demo-widget-html.png ->  widgetSrcdoc() HTML widget in a sandboxed iframe
 *   docs/demo-stream.gif      ->  an SVG widget streamed line-by-line (progressive render)
 *
 * Not shipped in lib/. Run with `pnpm render-demo` (needs a local Chrome and
 * `pnpm install`). The chart/styled surfaces use DSH `--dsw-alias-*` tokens so
 * the screenshots read like the product.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { chartSpecToOption, DEFAULT_THEME } from '../src/to-echarts.ts'
import { widgetSrcdoc } from '../src/to-iframe.ts'
import { fittedWidgetHeight } from '../src/svg-geometry.ts'
import { decodePng, encodeGif } from './gif.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const docs = join(root, 'docs')
mkdirSync(docs, { recursive: true })

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const echarts = readFileSync(join(root, 'node_modules/echarts/dist/echarts.min.js'), 'utf8')

// DSH-like theme tokens so the demo reads like the product's light theme.
const TOKENS = `:root{
  --dsw-alias-bg-base:#f2f4f7;--dsw-alias-bg-layer-1:#ffffff;--dsw-alias-bg-layer-2:#fafbfc;
  --dsw-alias-border-l1:#e4e7ec;--dsw-alias-border-l2:#e9edf1;
  --dsw-alias-text-primary:#1f2937;--dsw-alias-text-secondary:#67707f;
  --dsw-alias-brand-primary:#4166e6;--dsw-alias-brand-primary-invert:#ffffff;
  --dsw-alias-bg-mask-1:rgba(31,41,55,.04)
}body{margin:0;background:var(--dsw-alias-bg-base);font-family:ui-sans-serif,system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}`

/** SVG widget used for both the static and the streamed demo. */
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

function buildChartPage(spec) {
  const option = JSON.stringify(chartSpecToOption(spec))
  return `<!doctype html><html><head><style>${TOKENS}.wrap{width:660px;background:var(--dsw-alias-bg-layer-1);padding:10px;border-radius:14px;border:1px solid var(--dsw-alias-border-l1)}#c{width:640px;height:360px}</style></head><body><div class="wrap"><div id="c"></div></div></body></html>`
}

async function renderChart(page, spec) {
  await page.setContent(buildChartPage(spec))
  await page.addScriptTag({ content: echarts })
  await page.evaluate((opt) => {
    const chart = echarts.init(document.getElementById('c'))
    chart.setOption(JSON.parse(opt))
  }, JSON.stringify(chartSpecToOption(spec)))
  await page.waitForTimeout(900)
  const el = await page.$('.wrap')
  await el.screenshot({ path: join(docs, 'demo-chart.png') })
}

function cardHtml({ kind, widget, frameWidth }) {
  const height = kind === 'svg' ? fittedWidgetHeight(frameWidth, widget) : 340
  const srcdoc = widgetSrcdoc(widget)
  const badge = widget.closed === false ? '生成中' : '完成'
  return `<!doctype html><html><head><style>${TOKENS}.card{width:${frameWidth + 24}px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden}.head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-text-secondary)}.kind{background:var(--dsw-alias-bg-mask-1);padding:2px 6px;border-radius:6px;font-weight:600}.title{color:var(--dsw-alias-text-primary)}.badge{margin-left:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:1px 6px}iframe{display:block;width:100%;height:${height}px;border:0;background:transparent}</style></head><body><div class="card"><div class="head"><span class="kind">${kind.toUpperCase()}</span><span class="title">${widget.title ?? ''}</span><span class="badge">${badge}</span></div><iframe sandbox=""></iframe></div></body></html>`
}

async function renderWidget(page, kind, widget) {
  const frameWidth = 380
  await page.setContent(cardHtml({ kind, widget, frameWidth }))
  await page.evaluate((srcdoc) => {
    document.querySelector('iframe').srcdoc = srcdoc
  }, widgetSrcdoc(widget))
  await page.waitForTimeout(500)
  const el = await page.$('.card')
  await el.screenshot({ path: join(docs, `demo-widget-${kind}.png`) })
}

/** Streamed scene: left code panel grows, right card re-renders live. */
async function renderStreamGif(page, svgCode) {
  const frameWidth = 420
  const lines = svgCode.split('\n').filter((l) => l.trim() !== '')
  await page.setContent(`<!doctype html><html><head><style>${TOKENS}
    .scene{display:grid;grid-template-columns:380px 1fr;gap:16px;padding:16px;background:var(--dsw-alias-bg-base);width:900px}
    pre{background:#0f1527;color:#cfe0f5;border-radius:12px;padding:14px;margin:0;font:12px/1.55 ui-monospace,Menlo,monospace;white-space:pre;overflow:hidden;height:300px}
    .card{width:${frameWidth + 24}px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;overflow:hidden}
    .head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--dsw-alias-border-l2);font-size:12px;color:var(--dsw-alias-text-secondary)}
    .badge{margin-left:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;padding:1px 6px}
    iframe{display:block;width:100%;height:${fittedWidgetHeight(frameWidth, { kind: 'svg', code: svgCode })}px;border:0;background:transparent}
  </style></head><body><div class="scene">
    <pre id="code"></pre>
    <div class="card"><div class="head"><span>SVG</span><span>实时天气</span><span class="badge">生成中</span></div><iframe sandbox=""></iframe></div>
  </div></body></html>`)

  const frames = []
  const first = lines[0].trimStart().replace(/^<svg/, '') // keep <svg open
  const reveal = (k) => {
    const open = ['<svg width="360" height="200" viewBox="0 0 360 200" xmlns="http://www.w3.org/2000/svg">']
    const body = lines.slice(1, k + 1)
    const code = [...open, ...body].join('\n').trim()
    return code
  }
  const total = lines.length - 1 // minus the <svg> line already opened
  for (let k = 0; k <= total; k++) {
    const codeNow = reveal(k)
    const done = k === total
    await page.evaluate(([code, done]) => {
      const pre = document.getElementById('code')
      const fence = '```svg\n' + code + '\n```'
      pre.textContent = fence
      document.querySelector('iframe').srcdoc = code
      const badge = document.querySelector('.badge')
      badge.textContent = done ? '完成' : '生成中'
    }, [codeNow, done])
    await page.waitForTimeout(220)
    const scene = await page.$('.scene')
    const png = await scene.screenshot()
    frames.push(decodePng(png))
  }
  const gif = encodeGif(frames, { width: frames[0].width, height: frames[0].height, delayMs: 200 })
  writeFileSync(join(docs, 'demo-stream.gif'), gif)
  console.log('wrote docs/demo-stream.gif', gif.length, 'bytes,', frames.length, 'frames')
}

// ---- main ----
const browser = await chromium.launch({ executablePath: CHROME, headless: true })
const page = await browser.newPage({ deviceScaleFactor: 2 })

await renderChart(page, {
  kind: 'bar',
  title: '深圳 · 未来 7 天最高 / 最低气温',
  xAxis: ['周六', '周日', '周一', '周二', '周三', '周四', '周五'],
  yName: '°C',
  series: [
    { name: '最高温', data: [32, 32, 30, 31, 29, 31, 32] },
    { name: '最低温', data: [26, 27, 25, 25, 25, 25, 24] },
  ],
})

await renderWidget(page, 'svg', { kind: 'svg', code: SVG_CODE, title: '实时天气' })
await renderWidget(page, 'html', {
  kind: 'html',
  title: '本周降水概览',
  code: `<div style="padding:18px 20px;font-family:inherit;color:#1f2937"><strong style="font-size:16px">本周湿湿哒</strong><div style="margin-top:8px;font-size:13px;color:#67707f">连续 7 天有雷阵雨，周期累计降水约 <b>88 mm</b>，请随身带伞。</div><div style="margin-top:14px;display:flex;gap:10px;font-size:12px"><span style="background:#eef2fb;border-radius:8px;padding:6px 10px">💧 降水 88mm</span><span style="background:#eef2fb;border-radius:8px;padding:6px 10px">🌬️ 风 17.5km/h</span></div></div>`,
})

await renderStreamGif(page, SVG_CODE)

await browser.close()
console.log('demo assets written to', docs)
