import * as THREE from 'three'
import { FLOWER_COLORS, PALETTE } from './config'
import {
  flatten,
  grassBladeTexture,
  flowerTexture,
  leafClusterTexture,
  mergeGeometries,
  mulberry32,
  toon,
  withWhiteColors,
} from './toon'
import { causewayPoint, frameAt } from './track'

/* ------------------------------------------------------------------ *
 * 散布工具
 * ------------------------------------------------------------------ */

interface Placement {
  pos: THREE.Vector3
  yaw: number
  scale: number
  tint: THREE.Color
}

/** 沿长堤两侧草坡撒点；latMin/latMax 是到中心线的横向距离 */
function scatter(
  curve: THREE.CatmullRomCurve3,
  count: number,
  opts: {
    latMin: number
    latMax: number
    seed: number
    yOffset?: number
    minScale?: number
    maxScale?: number
    colors?: readonly string[]
    /** 是否只撒在某一侧（0=两侧，1=左侧，-1=右侧） */
    side?: 0 | 1 | -1
    /** 落在水面上的（不做剖面插值，直接给 y） */
    waterY?: number
  },
): Placement[] {
  const rnd = mulberry32(opts.seed)
  const out: Placement[] = []
  const tmp = new THREE.Vector3()
  const minS = opts.minScale ?? 0.7
  const maxS = opts.maxScale ?? 1.3

  for (let i = 0; i < count; i++) {
    const t = rnd()
    // side 缺省是 undefined —— 不能直接拿它参与乘法，否则整批实例坐标全是 NaN
    const sideOpt = opts.side ?? 0
    const side = sideOpt === 0 ? (rnd() < 0.5 ? 1 : -1) : sideOpt
    // 靠近堤心密、外侧疏
    const k = Math.pow(rnd(), 0.75)
    const lat = side * (opts.latMin + (opts.latMax - opts.latMin) * k)

    if (opts.waterY !== undefined) {
      const f = frameAt(curve, t)
      tmp.set(f.point.x + f.lateral.x * lat, opts.waterY, f.point.z + f.lateral.z * lat)
    } else {
      causewayPoint(curve, t, lat, opts.yOffset ?? 0, tmp)
    }

    const tint = new THREE.Color(opts.colors ? opts.colors[Math.floor(rnd() * opts.colors.length)] : '#ffffff')
    out.push({
      pos: tmp.clone(),
      yaw: rnd() * Math.PI * 2,
      scale: minS + rnd() * (maxS - minS),
      tint,
    })
  }
  return out
}

/** 两片十字交叉的面片 */
function crossQuads(w: number, h: number) {
  const a = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0)
  const b = new THREE.PlaneGeometry(w, h).rotateY(Math.PI / 2).translate(0, h / 2, 0)
  const merged = mergeGeometries([a, b], false)
  return merged ?? a
}

interface InstanceOpts {
  castShadow?: boolean
  /** 额外的随机倾斜，让植株不是笔直的 */
  tilt?: number
  /** 是否让实例贴地（沿法线对齐），这里用简化的随机倾斜代替 */
  seedOffset?: number
}

function makeInstanced(
  name: string,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  placements: Placement[],
  opts: InstanceOpts = {},
) {
  const inst = new THREE.InstancedMesh(withWhiteColors(geo), mat, placements.length)
  inst.name = name
  inst.castShadow = opts.castShadow ?? false
  inst.receiveShadow = false
  const m = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const e = new THREE.Euler()
  const s = new THREE.Vector3()
  const rnd = mulberry32((opts.seedOffset ?? 3) * 977 + 5)
  const tilt = opts.tilt ?? 0

  for (let i = 0; i < placements.length; i++) {
    const p = placements[i]
    e.set(tilt ? (rnd() - 0.5) * tilt : 0, p.yaw, tilt ? (rnd() - 0.5) * tilt : 0)
    q.setFromEuler(e)
    s.set(p.scale, p.scale, p.scale)
    m.compose(p.pos, q, s)
    inst.setMatrixAt(i, m)
    inst.setColorAt(i, p.tint)
  }
  inst.instanceMatrix.needsUpdate = true
  if (inst.instanceColor) inst.instanceColor.needsUpdate = true
  return inst
}

/* ------------------------------------------------------------------ *
 * 长堤植被
 * ------------------------------------------------------------------ */

export interface VegetationHandle {
  group: THREE.Group
  /** 给"风摆"用的着色器钩子（目前只登记，便于后续扩展） */
  materials: THREE.Material[]
}

export function buildVegetation(curve: THREE.CatmullRomCurve3): VegetationHandle {
  const group = new THREE.Group()
  group.name = 'vegetation'
  const materials: THREE.Material[] = []

  /* ---- 野花：参考图里堤坡上那一片彩色小花 ---- */
  const flowerMat = toon('#ffffff', {
    map: flowerTexture(),
    alphaTest: 0.45,
    side: THREE.DoubleSide,
    vertexColors: true,
  })
  materials.push(flowerMat)
  const flowers = scatter(curve, 4200, {
    latMin: 3.7,
    latMax: 9.2,
    seed: 1337,
    minScale: 0.9,
    maxScale: 2.0,
    colors: FLOWER_COLORS,
  })
  group.add(
    makeInstanced('flowers', crossQuads(0.42, 0.42), flowerMat, flowers, {
      seedOffset: 11,
      tilt: 0.5,
    }),
  )

  /* ---- 草丛：把堤面从"纯色斜坡"变成有绒毛的草地 ---- */
  const grassMat = toon('#ffffff', {
    map: grassBladeTexture(),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    vertexColors: true,
  })
  materials.push(grassMat)
  const grass = scatter(curve, 5200, {
    latMin: 3.6,
    latMax: 9.6,
    seed: 909,
    minScale: 0.75,
    maxScale: 1.95,
    colors: [PALETTE.grassLit, PALETTE.grassMid, PALETTE.grassDark],
  })
  group.add(
    makeInstanced('grass', crossQuads(0.5, 0.78), grassMat, grass, {
      seedOffset: 13,
      tilt: 0.45,
    }),
  )

  /* ---- 灌木：低多边形球，压在草坡外侧 ---- */
  const bushMat = toon('#ffffff', {
    map: leafClusterTexture(),
    vertexColors: true,
    
  })
  materials.push(bushMat)
  const bushes = scatter(curve, 620, {
    latMin: 4.8,
    latMax: 9.8,
    seed: 555,
    minScale: 0.42,
    maxScale: 1.05,
    colors: [PALETTE.bushMid, PALETTE.treeMid, PALETTE.treeLit, '#7cc44a'],
    yOffset: -0.22,
  })
  group.add(
    makeInstanced('bushes', flatten(new THREE.IcosahedronGeometry(1, 1)), bushMat, bushes, {
      castShadow: true,
      seedOffset: 17,
    }),
  )

  /* ---- 岸边石块：参考图里水线上一圈石头 ---- */
  const rockMat = toon('#ffffff', { vertexColors: true })
  materials.push(rockMat)
  const rocks = scatter(curve, 520, {
    latMin: 8.6,
    latMax: 11.4,
    seed: 77,
    minScale: 0.34,
    maxScale: 1.15,
    colors: [PALETTE.rock, PALETTE.rockDark, '#b0a48d'],
    yOffset: -0.2,
  })
  group.add(
    makeInstanced('rocks', flatten(new THREE.DodecahedronGeometry(1, 0)), rockMat, rocks, {
      castShadow: true,
      seedOffset: 19,
    }),
  )

  /* ---- 芦苇 / 香蒲：贴着水线长 ---- */
  const reedMat = toon('#ffffff', { vertexColors: true })
  materials.push(reedMat)
  const reeds = scatter(curve, 1300, {
    latMin: 9.0,
    latMax: 12.0,
    seed: 2024,
    minScale: 0.5,
    maxScale: 1.5,
    colors: [PALETTE.grassMid, PALETTE.grassLit, '#7fae3a'],
    yOffset: -0.35,
  })
  const reedGeo = flatten(new THREE.ConeGeometry(0.075, 1.5, 5).translate(0, 0.75, 0))
  group.add(
    makeInstanced('reeds', reedGeo, reedMat, reeds, { seedOffset: 23, tilt: 0.4 }),
  )

  /* ---- 荷叶：漂在靠近堤岸的浅水里 ---- */
  const padMat = toon('#ffffff', { side: THREE.DoubleSide, vertexColors: true })
  materials.push(padMat)
  const pads = scatter(curve, 340, {
    latMin: 11.5,
    latMax: 19,
    seed: 313,
    minScale: 0.42,
    maxScale: 1.15,
    colors: [PALETTE.lilyPad, PALETTE.lilyPadDark, '#4fa34b'],
    waterY: 0.045,
  })
  const padGeo = new THREE.CircleGeometry(0.62, 9).rotateX(-Math.PI / 2)
  group.add(makeInstanced('lilyPads', padGeo, padMat, pads, { seedOffset: 29 }))

  /* ---- 荷花：粉白小花苞 ---- */
  const lotusMat = toon('#ffffff', { vertexColors: true })
  materials.push(lotusMat)
  const lotus = scatter(curve, 260, {
    latMin: 12.0,
    latMax: 28,
    seed: 818,
    minScale: 0.6,
    maxScale: 1.3,
    colors: [PALETTE.lotusPink, '#ffffff', '#f27fa8'],
    waterY: 0.12,
  })
  const lotusGeo = flatten(new THREE.ConeGeometry(0.17, 0.34, 6).translate(0, 0.17, 0))
  group.add(makeInstanced('lotus', lotusGeo, lotusMat, lotus, { seedOffset: 31 }))

  return { group, materials }
}

/* ------------------------------------------------------------------ *
 * 远处湖心岛：沙滩 → 草地 → 针叶林
 * ------------------------------------------------------------------ */

export function buildIslands(seed = 606): THREE.Group {
  const group = new THREE.Group()
  group.name = 'islands'
  const rnd = mulberry32(seed)

  // ⚠️ 取景是固定的：相机在 (130,55,116) 看向 (103,2,34)，画面顶边对应的地面点
  // 大约在 (66,-88) —— 也就是南岸长堤一线。所以"远处的岸"必须是**贴着南岸**的
  // 地貌才进得了画；摆 z < -150 的岛永远在画面外（之前就踩了这个坑）。
  const ISLANDS = [
    // 贴在环路内侧的林地岬角 —— 对应参考图右上角那片"绿山 + 针叶林"
    { x: 24, z: -122, r: 30, h: 9.5, trees: 52 },
    { x: -58, z: -118, r: 22, h: 6.6, trees: 34 },
    // 湖心小岛，给水面制造纵深
    { x: -34, z: -46, r: 15, h: 4.2, trees: 16 },
    { x: 62, z: -52, r: 12, h: 3.4, trees: 12 },
  ]

  const islandMat = toon('#ffffff', { vertexColors: true })
  const treeMat = toon('#ffffff', { vertexColors: true })

  const treePlacements: Placement[] = []

  for (const spec of ISLANDS) {
    // 压扁的球 = 自然的小岛轮廓；顶点色按高度分沙滩 / 草地
    const geo = new THREE.SphereGeometry(spec.r, 26, 14)
    const pos = geo.getAttribute('position') as THREE.BufferAttribute
    const colors = new Float32Array(pos.count * 3)
    const c = new THREE.Color()
    const sand = new THREE.Color('#e8ddb4')
    const grass = new THREE.Color(PALETTE.grassMid)
    const deep = new THREE.Color(PALETTE.treeMid)

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i)
      const y = pos.getY(i)
      const z = pos.getZ(i)
      // 有机起伏
      const n =
        0.82 +
        0.16 * Math.sin(x * 0.09 + spec.x) * Math.cos(z * 0.11 + spec.z) +
        0.08 * Math.sin(x * 0.23) * Math.sin(z * 0.19)
      const ny = Math.max(y, 0) * (spec.h / spec.r) * n
      pos.setY(i, ny)

      const t = ny / (spec.h * 0.82)
      if (t < 0.12) c.copy(sand)
      else if (t < 0.45) c.copy(sand).lerp(grass, (t - 0.12) / 0.33)
      else c.copy(grass).lerp(deep, Math.min(1, (t - 0.45) / 0.5))
      const v = 0.9 + 0.2 * Math.sin(x * 0.4 + z * 0.3)
      colors[i * 3] = c.r * v
      colors[i * 3 + 1] = c.g * v
      colors[i * 3 + 2] = c.b * v
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geo.deleteAttribute('uv')
    geo.computeVertexNormals()

    const mesh = new THREE.Mesh(geo, islandMat)
    mesh.position.set(spec.x, -1.2, spec.z)
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)

    // 岛上的针叶林
    for (let i = 0; i < spec.trees; i++) {
      const a = rnd() * Math.PI * 2
      const rr = Math.pow(rnd(), 0.6) * spec.r * 0.74
      const lx = Math.cos(a) * rr
      const lz = Math.sin(a) * rr
      const n =
        0.82 +
        0.16 * Math.sin(lx * 0.09 + spec.x) * Math.cos(lz * 0.11 + spec.z) +
        0.08 * Math.sin(lx * 0.23) * Math.sin(lz * 0.19)
      const ny = Math.sqrt(Math.max(0, 1 - (rr / spec.r) ** 2)) * spec.h * n
      if (ny < spec.h * 0.14) continue
      treePlacements.push({
        pos: new THREE.Vector3(spec.x + lx, -1.2 + ny - 0.4, spec.z + lz),
        yaw: rnd() * Math.PI * 2,
        scale: 0.7 + rnd() * 0.95,
        tint: new THREE.Color(
          [PALETTE.treeDark, PALETTE.treeMid, PALETTE.treeLit][Math.floor(rnd() * 3)],
        ),
      })
    }
  }

  // 针叶树 = 圆锥（低多边形，远看是深绿色剪影，正合参考图）
  const treeGeo = flatten(mergeGeometries(
    [
      new THREE.ConeGeometry(0.95, 2.4, 7).translate(0, 1.2, 0),
      new THREE.ConeGeometry(0.72, 1.9, 7).translate(0, 2.15, 0),
      new THREE.ConeGeometry(0.48, 1.5, 7).translate(0, 3.0, 0),
    ],
    false,
  )!)
  group.add(makeInstanced('conifers', treeGeo, treeMat, treePlacements, { seedOffset: 37 }))

  return group
}

/** 长堤外侧水面上零星的浮萍 / 睡莲带（远景点缀） */
export function buildWaterScatter(curve: THREE.CatmullRomCurve3): THREE.Group {
  const group = new THREE.Group()
  group.name = 'waterScatter'
  const mat = toon('#ffffff', { side: THREE.DoubleSide, vertexColors: true })
  const spots = scatter(curve, 55, {
    latMin: 46,
    latMax: 88,
    seed: 4321,
    minScale: 0.5,
    maxScale: 1.6,
    colors: [PALETTE.lilyPad, PALETTE.lilyPadDark],
    waterY: 0.04,
  })
  group.add(
    makeInstanced('farPads', new THREE.CircleGeometry(0.7, 8).rotateX(-Math.PI / 2), mat, spots, {
      seedOffset: 41,
    }),
  )
  return group
}

