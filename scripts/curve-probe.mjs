/**
 * 打印线路几何信息，用来标定机位。
 * 用法：node scripts/curve-probe.mjs
 */
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const THREE = require('/Users/tianzun/222/codex/anime-train-demo/node_modules/three')
  .default ?? require('three')

const TRACK = { rx: 126, rz: 88, wobbleA: 0.09, wobbleB: 0.045 }

const pts = []
const N = 20
for (let i = 0; i < N; i++) {
  const a = (i / N) * Math.PI * 2
  const wob =
    1 +
    TRACK.wobbleA * Math.sin(a * 3 + 0.7) +
    TRACK.wobbleB * Math.sin(a * 5 + 2.1) +
    TRACK.wobbleB * 0.6 * Math.sin(a * 7 + 4.3)
  pts.push(new THREE.Vector3(Math.cos(a) * TRACK.rx * wob, 0, Math.sin(a) * TRACK.rz * wob))
}
const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5)
const len = curve.getLength()
console.log('loop length =', len.toFixed(1))

const UP = new THREE.Vector3(0, 1, 0)
console.log('\n t     point(x,z)            lateral(x,z)         yaw(deg)')
for (let i = 0; i <= 20; i++) {
  const t = i / 20
  const p = curve.getPointAt(t)
  const tan = curve.getTangentAt(t)
  const lat = new THREE.Vector3().crossVectors(UP, tan).normalize()
  const yaw = (Math.atan2(tan.x, tan.z) * 180) / Math.PI
  console.log(
    `${t.toFixed(2)}  (${p.x.toFixed(1).padStart(7)},${p.z.toFixed(1).padStart(7)})   (${lat
      .x.toFixed(2)
      .padStart(5)},${lat.z.toFixed(2).padStart(5)})   ${yaw.toFixed(0).padStart(5)}`,
  )
}

// 列车车头位置（对齐 scene.ts 里的 trainHead）
const trainHead = len * 0.12
console.log('\ntrain head arc-dist =', trainHead.toFixed(1))
const cars = ['dd51', 'coachA', 'coachB', 'locoMaroon', 'coachOlive', 'coachCream']
let off = 0
for (const c of cars) {
  const d = trainHead - (off + 19.6 / 2)
  const t = (((d % len) + len) % len) / len
  const p = curve.getPointAt(t)
  console.log(`  ${c.padEnd(12)} t=${t.toFixed(3)}  (${p.x.toFixed(1)}, ${p.z.toFixed(1)})`)
  off += 19.6 + 1.15
}
