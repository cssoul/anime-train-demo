/**
 * 数值探针：排查"撒了上千株植被却一株都看不见"这类问题。
 * 用法：node scripts/probe-veg.mjs
 */
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'

const require = createRequire(import.meta.url)
const pwRoot =
  process.env.PW_ROOT || '/Users/tianzun/.workbuddy/binaries/node/workspace/node_modules'
const { chromium } = require(`${pwRoot}/playwright-core`)

const EXE = [
  '/Users/tianzun/Library/Caches/ms-playwright/chromium-1148/chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  '/Users/tianzun/Library/Caches/ms-playwright/chromium-1148/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
].find((p) => existsSync(p))

const url = process.argv[2] || 'http://localhost:5273/?head=83.9&paused=1&capture=1'
const browser = await chromium.launch({ executablePath: EXE, args: ['--use-gl=angle', '--use-angle=metal'] })
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } })
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
await page.goto(url, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(4000)

const report = await page.evaluate(() => {
  const THREE = window.__scene?.renderer ? null : null
  const s = window.__scene
  if (!s) return { ok: false }
  const out = []
  s.scene.traverse((o) => {
    if (!o.isInstancedMesh) return
    const g = o.geometry
    g.computeBoundingBox()
    const bb = g.boundingBox
    // 取第 0 号实例的世界坐标
    const m = new Float32Array(16)
    o.getMatrixAt(0, { elements: m, fromArray() {} })
    const mat = o.instanceMatrix.array
    const p0 = [mat[12], mat[13], mat[14]]
    const p1 = [mat[28], mat[29], mat[30]]
    out.push({
      name: o.name,
      count: o.count,
      visible: o.visible,
      frustumCulled: o.frustumCulled,
      matVertexColors: o.material.vertexColors,
      matAlphaTest: o.material.alphaTest,
      hasMap: !!o.material.map,
      hasInstanceColor: !!o.instanceColor,
      geoAttrs: Object.keys(g.attributes),
      geoBox: bb ? [bb.min.toArray().map((v) => +v.toFixed(2)), bb.max.toArray().map((v) => +v.toFixed(2))] : null,
      inst0: p0.map((v) => +v.toFixed(1)),
      inst1: p1.map((v) => +v.toFixed(1)),
    })
  })
  return { ok: true, meshes: out }
})

console.log(JSON.stringify(report, null, 2))
await browser.close()
