import * as THREE from 'three'
import { TRACK, PALETTE } from './config'
import { mulberry32, toon, withWhiteColors } from './toon'

const UP = new THREE.Vector3(0, 1, 0)

/* ------------------------------------------------------------------ *
 * 线路中心线
 * 做成**闭合回路**：列车可以永远开下去，不会在画面里凭空出现/消失。
 * 回路足够大（~250m × 176m），镜头只框住其中一段，读起来就是参考图
 * 里那条在湖面上绕行的 S 形长堤。
 * ------------------------------------------------------------------ */

export function buildTrackCurve(): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = []
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
  return curve
}

/** 长堤剖面：陆上最高点是道砟顶面，也是"标高基准"（§14.6 的教训） */
export const CAUSEWAY_TOP_Y = TRACK.causewayHeight

/** 水面与长堤斜坡的交线半宽（由剖面插值而来），水面着色器要用它 */
export const WATERLINE_HALF = 9.42

interface ProfilePoint {
  x: number
  y: number
  color: string
}

/**
 * 横剖面（从左到右）。
 * 从参考图读出来的层次：水下泥土 → 石块护岸 → 草坡 → 道砟 → 草坡 → 石块 → 水下。
 * 道砟与草坡之间用两点紧贴，把渐变带压到 5cm，色阶才够"硬"（赛璐璐要的就是硬边）。
 */
const PROFILE: ProfilePoint[] = [
  { x: -11.10, y: -1.80, color: PALETTE.earthDark },
  { x: -10.05, y: -0.48, color: '#6d6a4e' },
  { x: -9.45, y: 0.06, color: '#8d8a63' },
  { x: -8.30, y: 0.52, color: PALETTE.grassDark },
  { x: -6.30, y: 1.02, color: PALETTE.grassMid },
  { x: -4.60, y: 1.42, color: PALETTE.grassMid },
  { x: -3.10, y: 1.78, color: PALETTE.grassLit },
  { x: -3.02, y: 1.90, color: PALETTE.ballast },
  { x: 3.02, y: 1.90, color: PALETTE.ballast },
  { x: 3.10, y: 1.78, color: PALETTE.grassLit },
  { x: 4.60, y: 1.42, color: PALETTE.grassMid },
  { x: 6.30, y: 1.02, color: PALETTE.grassMid },
  { x: 8.30, y: 0.52, color: PALETTE.grassDark },
  { x: 9.45, y: 0.06, color: '#8d8a63' },
  { x: 10.05, y: -0.48, color: '#6d6a4e' },
  { x: 11.10, y: -1.80, color: PALETTE.earthDark },
]

/**
 * 沿曲线扫掠一个横剖面。
 * 用 cross(up, tangent) 求横向，比 Frenet 帧稳定得多（平面曲线的 Frenet 会翻转）。
 */
interface SweepOpts {
  segments: number
  /** 沿横向整体偏移 */
  lateralOffset?: number
  /** 剖面的 y 整体抬升 */
  yOffset?: number
  /** 逐点抖动强度（0 = 光滑挤出） */
  jitter?: number
  seed?: number
}

function sweepProfile(
  curve: THREE.CatmullRomCurve3,
  profile: ProfilePoint[],
  opts: SweepOpts,
): { positions: Float32Array; colors: Float32Array; indices: Uint32Array; normals: Float32Array } {
  // 环路恒为闭合，不提供 closed 开关
  const { segments, lateralOffset = 0, yOffset = 0, jitter = 0, seed = 1 } = opts
  const rings = segments + 1
  const cols = profile.length
  const positions = new Float32Array(rings * cols * 3)
  const colors = new Float32Array(rings * cols * 3)
  const normals = new Float32Array(rings * cols * 3)
  const rnd = mulberry32(seed)
  const tmpColor = new THREE.Color()

  // 让抖动沿曲线连续变化，而不是每环独立随机（否则边缘会变成锯齿）
  const phase = new Float32Array(6)
  for (let i = 0; i < 6; i++) phase[i] = rnd() * Math.PI * 2

  const p = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const lat = new THREE.Vector3()

  for (let i = 0; i < rings; i++) {
    const t = (i % segments) / segments
    curve.getPointAt(t, p)
    curve.getTangentAt(t, tan)
    lat.crossVectors(UP, tan).normalize()

    // 长堤左右不对称、宽窄起伏 —— 参考图里堤岸是歪歪扭扭的
    const wobble =
      1 +
      0.055 * Math.sin(t * Math.PI * 2 * 3 + phase[0]) +
      0.032 * Math.sin(t * Math.PI * 2 * 7 + phase[1])
    const asym = 0.045 * Math.sin(t * Math.PI * 2 * 2 + phase[2])
    const bump =
      0.06 * Math.sin(t * Math.PI * 2 * 11 + phase[3]) +
      0.035 * Math.sin(t * Math.PI * 2 * 23 + phase[4])

    for (let j = 0; j < cols; j++) {
      const pt = profile[j]
      const o = (i * cols + j) * 3
      // 只抖动"地面以上"的部分，水下部分保持规整
      const above = pt.y > -0.5 ? 1 : 0.15
      const jx = jitter * above * (0.5 + 0.5 * Math.sin(t * 41 + j * 2.7 + phase[5]))
      const jy = jitter * 0.55 * above * Math.sin(t * 57 + j * 1.9)

      const px = pt.x * wobble * (pt.x > 0 ? 1 + asym : 1 - asym) + lateralOffset + jx
      const py = pt.y + yOffset + jy + bump * above

      positions[o] = p.x + lat.x * px
      positions[o + 1] = p.y + py
      positions[o + 2] = p.z + lat.z * px

      tmpColor.set(pt.color)
      // 顶点色带一点噪声，草地才不会是一整块死绿
      const v = 0.88 + 0.24 * (0.5 + 0.5 * Math.sin(t * 89 + j * 3.1 + phase[0]))
      colors[o] = tmpColor.r * v
      colors[o + 1] = tmpColor.g * v
      colors[o + 2] = tmpColor.b * v
    }
  }

  // 索引：单位阵变换下保证 +Y 朝外的绕序
  const quadCount = segments * (cols - 1)
  const indices = new Uint32Array(quadCount * 6)
  let k = 0
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j
      const b = i * cols + j + 1
      const c = (i + 1) * cols + j
      const d = (i + 1) * cols + j + 1
      indices[k++] = a
      indices[k++] = d
      indices[k++] = b
      indices[k++] = a
      indices[k++] = c
      indices[k++] = d
    }
  }

  return { positions, colors, indices, normals }
}

/** 长堤（含草坡、护岸石、道砟）—— 一个 mesh，一个 draw call */
export function buildCauseway(curve: THREE.CatmullRomCurve3, segments = TRACK.segments) {
  const { positions, colors, indices } = sweepProfile(curve, PROFILE, {
    segments,
    jitter: 0.16,
    seed: 4242,
  })

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  // 必须给 color 属性，否则 vertexColors 材质会渲染成纯黑（§13.1）
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  // 必须给 uv，否则和别的几何合并时会冲突
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((positions.length / 3) * 2), 2))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()

  const mat = toon('#ffffff', { vertexColors: true })
  return { geo, mat }
}

/* ------------------------------------------------------------------ *
 * 钢轨 + 枕木
 * ------------------------------------------------------------------ */

/** 钢轨剖面（简化 I 形），单位米，原点在轨底中心 */
const RAIL_PROFILE: ProfilePoint[] = [
  { x: -0.075, y: 0.0, color: PALETTE.railDark },
  { x: 0.075, y: 0.0, color: PALETTE.railDark },
  { x: 0.075, y: 0.055, color: PALETTE.rail },
  { x: 0.036, y: 0.095, color: PALETTE.rail },
  { x: 0.036, y: 0.195, color: PALETTE.rail },
  { x: 0.072, y: 0.225, color: '#c9c3ba' },
  { x: 0.072, y: 0.265, color: '#c9c3ba' },
  { x: -0.072, y: 0.265, color: '#c9c3ba' },
  { x: -0.072, y: 0.225, color: '#c9c3ba' },
  { x: -0.036, y: 0.195, color: PALETTE.rail },
  { x: -0.036, y: 0.095, color: PALETTE.rail },
  { x: -0.075, y: 0.055, color: PALETTE.railDark },
]

/** 轨顶标高 = 道砟顶 + 轨高 */
export const RAIL_TOP_Y = CAUSEWAY_TOP_Y + TRACK.railLift

export function buildRails(curve: THREE.CatmullRomCurve3, segments = TRACK.segments) {
  const half = TRACK.gauge / 2
  const side = segments * (RAIL_PROFILE.length - 1)
  const totalVerts = (segments + 1) * RAIL_PROFILE.length * 2
  const positions = new Float32Array(totalVerts * 3)
  const colors = new Float32Array(totalVerts * 3)
  const indices = new Uint32Array(side * 2 * 6)
  const tmp = new THREE.Color()

  const p = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const lat = new THREE.Vector3()
  const cols = RAIL_PROFILE.length
  let vi = 0
  let ii = 0

  for (const sign of [-1, 1] as const) {
    const base = vi
    for (let i = 0; i <= segments; i++) {
      const t = (i % segments) / segments
      curve.getPointAt(t, p)
      curve.getTangentAt(t, tan)
      lat.crossVectors(UP, tan).normalize()
      for (let j = 0; j < cols; j++) {
        const pt = RAIL_PROFILE[j]
        const o = vi * 3
        const px = sign * half + pt.x
        positions[o] = p.x + lat.x * px
        positions[o + 1] = CAUSEWAY_TOP_Y + pt.y
        positions[o + 2] = p.z + lat.z * px
        tmp.set(pt.color)
        colors[o] = tmp.r
        colors[o + 1] = tmp.g
        colors[o + 2] = tmp.b
        vi++
      }
    }
    for (let i = 0; i < segments; i++) {
      for (let j = 0; j < cols - 1; j++) {
        const a = base + i * cols + j
        const b = base + i * cols + j + 1
        const c = base + (i + 1) * cols + j
        const d = base + (i + 1) * cols + j + 1
        indices[ii++] = a
        indices[ii++] = d
        indices[ii++] = b
        indices[ii++] = a
        indices[ii++] = c
        indices[ii++] = d
      }
    }
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(totalVerts * 2), 2))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  return geo
}

/** 枕木：InstancedMesh，约 950 根但只有 1 个 draw call */
export function buildSleepers(curve: THREE.CatmullRomCurve3) {
  const length = curve.getLength()
  const count = Math.max(2, Math.floor(length / TRACK.sleeperPitch))
  const geo = withWhiteColors(new THREE.BoxGeometry(TRACK.ballastWidth * 0.78, 0.16, 0.26))
  const mat = new THREE.MeshToonMaterial({
    color: new THREE.Color(PALETTE.sleeper),
    vertexColors: true,
  })
  const inst = new THREE.InstancedMesh(geo, mat, count)
  inst.name = 'sleepers'
  inst.castShadow = false
  inst.receiveShadow = true

  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const p = new THREE.Vector3()
  const tan = new THREE.Vector3()
  const scale = new THREE.Vector3(1, 1, 1)
  const col = new THREE.Color()
  const rnd = mulberry32(7)

  for (let i = 0; i < count; i++) {
    const t = (i / count) % 1
    curve.getPointAt(t, p)
    curve.getTangentAt(t, tan)
    // 枕木长边横跨线路 → 绕 Y 转到切线垂直方向
    const yaw = Math.atan2(tan.x, tan.z)
    q.setFromAxisAngle(UP, yaw)
    p.y = CAUSEWAY_TOP_Y + 0.06
    m.compose(p, q, scale)
    inst.setMatrixAt(i, m)
    const v = 0.78 + rnd() * 0.44
    col.set(PALETTE.sleeper).multiplyScalar(v)
    inst.setColorAt(i, col)
  }
  inst.instanceMatrix.needsUpdate = true
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true
  return inst
}

/* ------------------------------------------------------------------ *
 * 到线路中心线的最近距离查询（给水面着色器烘焙 aShore）
 * 用网格加速，否则 5 万个顶点 × 900 个采样点会卡住主线程。
 * ------------------------------------------------------------------ */

export class PolyDist {
  private cell: number
  private grid = new Map<number, THREE.Vector2[]>()
  private pts: THREE.Vector2[]

  constructor(curve: THREE.CatmullRomCurve3, samples = 600, cell = 12) {
    this.cell = cell
    this.pts = []
    for (let i = 0; i < samples; i++) {
      const p = curve.getPointAt(i / samples)
      const v = new THREE.Vector2(p.x, p.z)
      this.pts.push(v)
      const key = this.key(v.x, v.y)
      let bucket = this.grid.get(key)
      if (!bucket) {
        bucket = []
        this.grid.set(key, bucket)
      }
      bucket.push(v)
    }
  }

  private key(x: number, z: number) {
    return (Math.floor(x / this.cell) + 4096) * 8192 + (Math.floor(z / this.cell) + 4096)
  }

  /** 到中心线的最近距离（无符号） */
  distance(x: number, z: number): number {
    const cx = Math.floor(x / this.cell)
    const cz = Math.floor(z / this.cell)
    let best = Infinity
    // 由近及远一圈圈扩，找到候选后多扩一圈即可确认
    for (let ring = 0; ring <= 4; ring++) {
      for (let ix = cx - ring; ix <= cx + ring; ix++) {
        for (let iz = cz - ring; iz <= cz + ring; iz++) {
          if (ring > 0 && ix > cx - ring && ix < cx + ring && iz > cz - ring && iz < cz + ring) continue
          const bucket = this.grid.get((ix + 4096) * 8192 + (iz + 4096))
          if (!bucket) continue
          for (const v of bucket) {
            const dx = v.x - x
            const dz = v.y - z
            const d = dx * dx + dz * dz
            if (d < best) best = d
          }
        }
      }
      if (best < Infinity && Math.sqrt(best) < ring * this.cell) break
    }
    if (best === Infinity) {
      // 兜底：全量扫（只在极远处触发，数量不多）
      for (const v of this.pts) {
        const dx = v.x - x
        const dz = v.y - z
        const d = dx * dx + dz * dz
        if (d < best) best = d
      }
    }
    return Math.sqrt(best)
  }
}

export { UP as WORLD_UP }

/* ------------------------------------------------------------------ *
 * 长堤表面的采样工具（植被、道具要靠它落位）
 * ------------------------------------------------------------------ */

/** 剖面右半边按 |x| 升序，用于插值出"某个横向偏移处的地面高度" */
const HALF_PROFILE: { x: number; y: number }[] = PROFILE.filter((p) => p.x >= 0)
  .map((p) => ({ x: p.x, y: p.y }))
  .sort((a, b) => a.x - b.x)

/** 给定横向偏移（米），返回长堤表面的世界高度 */
export function profileY(latOffset: number): number {
  const x = Math.abs(latOffset)
  if (x <= HALF_PROFILE[0].x) return HALF_PROFILE[0].y
  const last = HALF_PROFILE[HALF_PROFILE.length - 1]
  if (x >= last.x) return last.y
  for (let i = 0; i < HALF_PROFILE.length - 1; i++) {
    const a = HALF_PROFILE[i]
    const b = HALF_PROFILE[i + 1]
    if (x >= a.x && x <= b.x) {
      const k = (x - a.x) / (b.x - a.x)
      return a.y + (b.y - a.y) * k
    }
  }
  return last.y
}

export interface CurveFrame {
  point: THREE.Vector3
  tangent: THREE.Vector3
  /** 水平横向（= cross(up, tangent)，指向行进方向左侧） */
  lateral: THREE.Vector3
}

const _p = new THREE.Vector3()
const _t = new THREE.Vector3()
const _l = new THREE.Vector3()

/** 取曲线上某处的局部标架（复用临时向量，别长期持有） */
export function frameAt(curve: THREE.CatmullRomCurve3, t: number): CurveFrame {
  curve.getPointAt(((t % 1) + 1) % 1, _p)
  curve.getTangentAt(((t % 1) + 1) % 1, _t)
  _l.crossVectors(UP, _t).normalize()
  return { point: _p, tangent: _t, lateral: _l }
}

/** 长堤上一点的最终世界坐标（含横向偏移与剖面高度） */
export function causewayPoint(
  curve: THREE.CatmullRomCurve3,
  t: number,
  latOffset: number,
  yOffset = 0,
  out = new THREE.Vector3(),
) {
  const f = frameAt(curve, t)
  return out.set(
    f.point.x + f.lateral.x * latOffset,
    profileY(latOffset) + yOffset,
    f.point.z + f.lateral.z * latOffset,
  )
}

