import { chromium } from 'playwright-core'
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
const page = await browser.newPage()
const logs = []
page.on('console', (msg) => { if (/dsh-visualizer/.test(msg.text())) logs.push(`[${msg.type()}] ${msg.text().slice(0, 900)}`) })
await page.goto('http://127.0.0.1:3080/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(15000)
await page.evaluate(() => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node) {
    if ((node.textContent ?? '').trim().includes('可视化技能推荐')) {
      let el = node.parentElement
      while (el && el !== document.body) {
        if (el.tagName === 'BUTTON' || getComputedStyle(el).cursor === 'pointer') { el.click(); return }
        el = el.parentElement
      }
    }
    node = walker.nextNode()
  }
})
await page.waitForTimeout(20000)
const info = await page.evaluate(() => ({
  viz: document.querySelectorAll('[data-chat-flow-kind="visualizer-chart"]').length,
  widgets: document.querySelectorAll('[data-chat-flow-kind="visualizer-widget"]').length,
  widgetFrames: document.querySelectorAll('[data-chat-flow-kind="visualizer-widget"] iframe[data-widget-kind]').length,
  toolCalls: document.querySelectorAll('[data-chat-flow-kind="tool-call"]').length,
}))
console.log('=== fold probes (start/update/buildViewNode) ===')
for (const l of logs) {
  if (/start\(\)|update\(\)|buildViewNode|register/.test(l)) console.log(l)
}
console.log('=== DOM ===')
console.log(JSON.stringify(info))
await browser.close()
