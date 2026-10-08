/**
 * 截图 / 取证脚本。
 * 用法：
 *   node scripts/shot.mjs [url] [outfile] [waitMs]
 * 依赖 playwright（装在 managed workspace 里）。
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const pwRoot =
  process.env.PW_ROOT || '/Users/tianzun/.workbuddy/binaries/node/workspace/node_modules'
const { chromium } = require(`${pwRoot}/playwright-core`)

const url = process.argv[2] || 'http://localhost:5273/?capture=1'
const out = process.argv[3] || '/tmp/train-shots/shot.png'
const wait = Number(process.argv[4] || 6000)

const CANDIDATES = [
  '/Users/tianzun/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  '/Users/tianzun/Library/Caches/ms-playwright/chromium-1148/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
]
const exe = CANDIDATES.find((p) => existsSync(p))

const browser = await chromium.launch({
  executablePath: exe,
  args: [
    '--use-gl=angle',
    '--use-angle=metal',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-gpu-rasterization',
  ],
})

const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })

const logs = []
page.on('console', (m) => {
  const t = m.type()
  if (t === 'warning' && /flatShading|not a property/.test(m.text())) return
  logs.push(`[${t}] ${m.text()}`)
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack || ''}`))

await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 })
await page.waitForTimeout(wait)

// 读一份运行时探针
const probe = await page.evaluate(() => {
  const s = window.__scene
  if (!s) return { ok: false, reason: 'window.__scene 不存在' }
  const info = s.renderer.info
  const lead = s.cars?.[0]?.group
  return {
    ok: true,
    fps: null,
    calls: info.render.calls,
    triangles: info.render.triangles,
    programs: info.programs?.length ?? 0,
    geometries: info.memory.geometries,
    textures: info.memory.textures,
    camera: s.camera.position.toArray().map((v) => +v.toFixed(2)),
    target: s.controls.target.toArray().map((v) => +v.toFixed(2)),
    leadPos: lead ? lead.position.toArray().map((v) => +v.toFixed(2)) : null,
    leadRotY: lead ? +lead.rotation.y.toFixed(3) : null,
    time: s.time,
    children: s.scene.children.length,
  }
})

await page.screenshot({ path: out })
await browser.close()

console.log('=== PROBE ===')
console.log(JSON.stringify(probe, null, 2))
console.log('=== CONSOLE (' + logs.length + ') ===')
for (const l of logs.slice(0, 60)) console.log(l)
console.log('=== SHOT ===', out)
