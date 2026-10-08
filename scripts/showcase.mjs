/**
 * 成品展示图 + 性能实测。
 * 用法：
 *   node scripts/showcase.mjs http://localhost:4273/ /tmp/train-shots/final
 * 走的是生产包（vite preview），读数才有可比性（见 skill §15.8）。
 */
import { createRequire } from 'node:module'
import { existsSync, mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const pwRoot = process.env.PW_ROOT || '/Users/tianzun/.workbuddy/binaries/node/workspace/node_modules'
const { chromium } = require(`${pwRoot}/playwright-core`)

const EXE = [
  '/Users/tianzun/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  '/Users/tianzun/Library/Caches/ms-playwright/chromium-1148/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
].find((p) => existsSync(p))

const BASE = process.argv[2] || 'http://localhost:4273/'
const OUT = process.argv[3] || '/tmp/train-shots/final'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({
  executablePath: EXE,
  args: ['--use-gl=angle', '--use-angle=metal', '--enable-unsafe-swiftshader'],
})
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
const errs = []
page.on('pageerror', (e) => errs.push(e.message))
page.on('console', (m) => {
  if (m.type() === 'error' && !/404|favicon/.test(m.text())) errs.push(m.text())
})

// 主视角（关闭 HUD 便于审图）
await page.goto(`${BASE}?capture=1`, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(9000)

// 等蒸汽柱长起来，再拍
await page.screenshot({ path: `${OUT}/01-hero.png` })
console.log('01-hero.png')

// 关掉 HUD 拍一张"纯净画面"，方便和参考图并排比
await page.evaluate(() => {
  const ov = document.querySelector('.overlay')
  if (ov) ov.style.display = 'none'
})
await page.screenshot({ path: `${OUT}/02-hero-clean.png` })
console.log('02-hero-clean.png')
await page.evaluate(() => {
  const ov = document.querySelector('.overlay')
  if (ov) ov.style.display = ''
})

// 时段预设
for (const [label, file] of [
  ['黄昏', '03-golden'],
  ['薄暮', '04-dusk'],
  ['夜色', '05-night'],
]) {
  await page.click(`.card-controls >> text=${label}`)
  await page.waitForTimeout(4200)
  await page.screenshot({ path: `${OUT}/${file}.png` })
  console.log(`${file}.png`)
}

// 回到正午，切机位
await page.click('.card-controls >> text=正午')
await page.waitForTimeout(1500)
for (const [label, file] of [
  ['近景', '06-closeup'],
  ['贴水', '07-low'],
  ['俯瞰', '08-aerial'],
]) {
  await page.click(`.card-controls >> text=${label}`)
  await page.waitForTimeout(3500)
  await page.screenshot({ path: `${OUT}/${file}.png` })
  console.log(`${file}.png`)
}

// 回到主视角，实测帧率（连采 6 秒）
await page.click('.card-controls >> text=主视角')
await page.waitForTimeout(2500)
const perf = await page.evaluate(async () => {
  const s = window.__scene
  const frames = []
  let last = performance.now()
  const t0 = last
  await new Promise((resolve) => {
    function tick() {
      const now = performance.now()
      frames.push(now - last)
      last = now
      if (now - t0 > 6000) resolve()
      else requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  frames.sort((a, b) => a - b)
  const n = frames.length
  const avg = frames.reduce((a, b) => a + b, 0) / n
  // renderer.info 每帧开头会被 autoReset 清零，必须"先渲染再读"才是真实值
  s.renderer.render(s.scene, s.camera)
  return {
    frames: n,
    avgMs: +avg.toFixed(2),
    fps: +(1000 / avg).toFixed(1),
    p50: +frames[Math.floor(n * 0.5)].toFixed(2),
    p95: +frames[Math.floor(n * 0.95)].toFixed(2),
    worst: +frames[n - 1].toFixed(2),
    drawCalls: s.renderer.info.render.calls,
    triangles: s.renderer.info.render.triangles,
    programs: s.renderer.info.programs.length,
    geometries: s.renderer.info.memory.geometries,
    textures: s.renderer.info.memory.textures,
    dpr: window.devicePixelRatio,
  }
})
console.log('=== PERF ===')
console.log(JSON.stringify(perf, null, 2))

await browser.close()
if (errs.length) {
  console.log('=== ERRORS ===')
  console.log([...new Set(errs)].slice(0, 12).join('\n'))
}
