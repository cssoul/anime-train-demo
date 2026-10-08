/**
 * 批量拍机位候选图，用来对着参考图挑选构图。
 * 用法：node scripts/cam-sweep.mjs
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const pwRoot =
  process.env.PW_ROOT || '/Users/tianzun/.workbuddy/binaries/node/workspace/node_modules'
const { chromium } = require(`${pwRoot}/playwright-core`)

const EXE = [
  '/Users/tianzun/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  '/Users/tianzun/Library/Caches/ms-playwright/chromium-1148/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
].find((p) => existsSync(p))

const BASE = process.argv[2] || 'http://localhost:5273/'
const OUT = process.argv[3] || '/tmp/train-shots/cam'
mkdirSync(OUT, { recursive: true })

const CANDIDATES = JSON.parse(
  process.env.CAMS ||
    JSON.stringify([
      { n: 'a', cam: '185,100,105', tgt: '105,2,38', fov: 30 },
      { n: 'b', cam: '170,78,128', tgt: '100,2,30', fov: 32 },
      { n: 'c', cam: '205,125,78', tgt: '110,2,40', fov: 28 },
      { n: 'd', cam: '152,60,152', tgt: '95,2,18', fov: 34 },
    ]),
)

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/404/.test(m.text())) errs.push(m.text())
})

for (const c of CANDIDATES) {
  // 基础 URL 里可能已经带了参数，分隔符要判断一下
  const sep = BASE.includes('?') ? '&' : '?'
  const url = `${BASE}${sep}capture=1&cam=${c.cam}&tgt=${c.tgt}&fov=${c.fov}`
  await page.goto(url, { waitUntil: 'load', timeout: 60000 })
  await page.waitForTimeout(4500)
  const file = `${OUT}/${c.n}.png`
  await page.screenshot({ path: file })
  const probe = await page.evaluate(() => {
    const s = window.__scene
    if (!s) return { ok: false }
    const lead = s.cars?.[0]?.group
    return {
      ok: true,
      calls: s.renderer.info.render.calls,
      tris: s.renderer.info.render.triangles,
      lead: lead ? lead.position.toArray().map((v) => +v.toFixed(1)) : null,
    }
  })
  console.log(`${c.n}: cam(${c.cam}) tgt(${c.tgt}) -> ${file}`, JSON.stringify(probe))
}

await browser.close()
if (errs.length) {
  console.log('--- ERRORS ---')
  console.log([...new Set(errs)].slice(0, 10).join('\n'))
}
