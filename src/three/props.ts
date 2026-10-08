import * as THREE from 'three'
import { PALETTE } from './config'
import { mergeGeometries, mulberry32, toon, tintGeo } from './toon'
import { causewayPoint, frameAt } from './track'

/* ------------------------------------------------------------------ *
 * 电线杆：参考图里沿堤排开的那排老式木杆
 * 木杆 + 深色横担 + 灯罩三种颜色合成一个几何体 → 整排 1 个 draw call
 * ------------------------------------------------------------------ */

function telegraphPoleGeo() {
  const parts: THREE.BufferGeometry[] = [
    // 主杆（略微收细）
    tintGeo(new THREE.CylinderGeometry(0.09, 0.15, 7.2, 7).translate(0, 3.6, 0), PALETTE.poleWood),
    // 根部加固
    tintGeo(new THREE.CylinderGeometry(0.19, 0.22, 0.5, 7).translate(0, 0.25, 0), PALETTE.poleDark),
    // 横担
    tintGeo(new THREE.BoxGeometry(1.9, 0.09, 0.11).translate(0, 6.28, 0), PALETTE.poleDark),
    tintGeo(new THREE.BoxGeometry(1.6, 0.09, 0.11).translate(0, 6.86, 0), PALETTE.poleDark),
    // 灯罩 / 绝缘子盒
    tintGeo(new THREE.CylinderGeometry(0.2, 0.26, 0.44, 7).translate(0, 5.5, 0), PALETTE.poleLamp),
    // 杆顶
    tintGeo(new THREE.ConeGeometry(0.14, 0.34, 6).translate(0, 7.38, 0), PALETTE.poleWood),
  ]
  // 绝缘子
  for (const dx of [-0.78, -0.3, 0.3, 0.78]) {
    parts.push(
      tintGeo(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 5).translate(dx, 6.42, 0), '#c8d4d8'),
    )
  }
  for (const dx of [-0.62, 0.62]) {
    parts.push(
      tintGeo(new THREE.CylinderGeometry(0.055, 0.055, 0.2, 5).translate(dx, 7.0, 0), '#c8d4d8'),
    )
  }
  return mergeGeometries(parts, false)!
}

export function buildTelegraphPoles(curve: THREE.CatmullRomCurve3) {
  const geo = telegraphPoleGeo()
  const mat = toon('#ffffff', { vertexColors: true })
  const rnd = mulberry32(2026)
  const spacing = 34 // 米
  const count = Math.floor(curve.getLength() / spacing)

  const inst = new THREE.InstancedMesh(geo, mat, count)
  inst.name = 'telegraphPoles'
  inst.castShadow = false
  inst.receiveShadow = false

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3()
  const p = new THREE.Vector3()

  for (let i = 0; i < count; i++) {
    const t = i / count
    // 放在堤的同一侧（参考图里电线杆都排在铁道右边）
    const lat = -(9.1 + rnd() * 1.1)
    causewayPoint(curve, t, lat, -0.35, p)
    const f = frameAt(curve, t)
    const yaw = Math.atan2(f.tangent.x, f.tangent.z) + (rnd() - 0.5) * 0.4
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
    const k = 0.88 + rnd() * 0.3
    s.set(k, 0.9 + rnd() * 0.28, k)
    m.compose(p, q, s)
    inst.setMatrixAt(i, m)
  }
  inst.instanceMatrix.needsUpdate = true
  return inst
}

/* ------------------------------------------------------------------ *
 * 岸边小木船（参考图左上角那条拴着的小船）
 * ------------------------------------------------------------------ */

export function buildBoat() {
  const parts: THREE.BufferGeometry[] = []
  const wood = PALETTE.boatWood
  const dark = '#6a4f33'

  // 船底：一个压扁拉长的多面体
  const hull = new THREE.SphereGeometry(1, 12, 7)
  hull.scale(2.6, 0.55, 0.95)
  hull.translate(0, 0.16, 0)
  // 只留船体形状：把上半削平
  const pos = hull.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < pos.count; i++) {
    if (pos.getY(i) > 0.42) pos.setY(i, 0.42)
  }
  hull.computeVertexNormals()
  parts.push(tintGeo(hull, wood))

  // 舷边
  for (const z of [0.92, -0.92]) {
    parts.push(tintGeo(new THREE.BoxGeometry(4.7, 0.16, 0.13).translate(0, 0.46, z), dark))
  }
  // 横座板
  for (const x of [-1.35, 0, 1.35]) {
    parts.push(tintGeo(new THREE.BoxGeometry(0.22, 0.08, 1.7).translate(x, 0.42, 0), dark))
  }
  // 系缆桩
  parts.push(tintGeo(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6).translate(2.5, 0.4, 0), dark))

  const geo = mergeGeometries(parts, false)!
  const mesh = new THREE.Mesh(geo, toon('#ffffff', { vertexColors: true }))
  mesh.name = 'boat'
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/* ------------------------------------------------------------------ *
 * 轨旁标志牌（参考图里那些竖在草里的小牌子）
 * ------------------------------------------------------------------ */

export function buildSignposts(curve: THREE.CatmullRomCurve3) {
  const parts: THREE.BufferGeometry[] = [
    tintGeo(new THREE.CylinderGeometry(0.055, 0.055, 2.1, 6).translate(0, 1.05, 0), PALETTE.poleDark),
    tintGeo(new THREE.BoxGeometry(0.66, 0.66, 0.07).translate(0, 2.15, 0), '#d8d2c4'),
    tintGeo(new THREE.BoxGeometry(0.46, 0.46, 0.09).translate(0, 2.15, 0), '#c05a3a'),
  ]
  const geo = mergeGeometries(parts, false)!
  const mat = toon('#ffffff', { vertexColors: true })
  const rnd = mulberry32(5150)
  const count = Math.floor(curve.getLength() / 96)
  const inst = new THREE.InstancedMesh(geo, mat, count)
  inst.name = 'signposts'
  inst.castShadow = true

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const s = new THREE.Vector3(1, 1, 1)
  const p = new THREE.Vector3()
  const up = new THREE.Vector3(0, 1, 0)

  for (let i = 0; i < count; i++) {
    const t = (i + 0.37) / count
    causewayPoint(curve, t, 8.3 + rnd() * 0.9, 0, p)
    const f = frameAt(curve, t)
    q.setFromAxisAngle(up, Math.atan2(f.tangent.x, f.tangent.z))
    m.compose(p, q, s)
    inst.setMatrixAt(i, m)
  }
  inst.instanceMatrix.needsUpdate = true
  return inst
}
