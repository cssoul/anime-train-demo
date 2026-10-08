import * as THREE from 'three'
import { PALETTE, TRAIN, GeoBag, type TimeSettings } from './config'
import { toon, buildOutline, mat4, mulberry32 } from './toon'

/**
 * 车辆模型构建。
 *
 * ⚠️ 朝向契约（对应场景里 §15.6 那个"整队车倒着开"的坑）：
 *   所有车的 **车头朝局部 +X**。
 *   驾驶室 / 风挡 / 前照灯 / 车头 V 形饰带 → +X 侧
 *   尾灯 / 车尾扶手                        → -X 侧
 *   运行时用 `rotation.y = atan2(dx, dz) - PI/2` 把 +X 转到行进方向。
 *   验收不看公式，看位移：车头朝向与 0.9s 后位移的 cos 应 ≈ 1。
 */

const RAIL_GAP = 0.52 // 轮半径
const FLOOR_Y = 1.12 // 车体底架面（相对轨顶）

/* ------------------------------------------------------------------ *
 * 材质盒：每辆车共用一套，合批后一种颜色 = 1 个 draw call
 * ------------------------------------------------------------------ */

interface Paint {
  body: THREE.MeshToonMaterial
  bodyDark: THREE.MeshToonMaterial
  cream: THREE.MeshToonMaterial
  stripe: THREE.MeshToonMaterial
  roof: THREE.MeshToonMaterial
  roofDark: THREE.MeshToonMaterial
  dark: THREE.MeshToonMaterial
  glass: THREE.MeshToonMaterial
  metal: THREE.MeshToonMaterial
  lamp: THREE.MeshToonMaterial
}

/** 需要被"一天四时"驱动的材质（窗光、车灯）集中登记 */
export const litMaterials: THREE.MeshToonMaterial[] = []
export const lampMaterials: THREE.MeshToonMaterial[] = []

function mkPaint(c: {
  body: string
  bodyDark?: string
  cream: string
  stripe?: string
  roof: string
  roofDark: string
}): Paint {
  const glass = toon(PALETTE.locoGlass, {
    emissive: '#ffd9a0',
    emissiveIntensity: 0,
  })
  litMaterials.push(glass)

  const lamp = toon('#fff6d8', { emissive: '#fff2c8', emissiveIntensity: 0.45 })
  lampMaterials.push(lamp)

  return {
    body: toon(c.body),
    bodyDark: toon(c.bodyDark ?? c.body),
    cream: toon(c.cream),
    stripe: toon(c.stripe ?? c.cream),
    roof: toon(c.roof),
    roofDark: toon(c.roofDark),
    dark: toon(PALETTE.locoDark),
    glass,
    metal: toon('#6f6a63'),
    lamp,
  }
}

/* ------------------------------------------------------------------ *
 * 零件小工具（都通过 GeoBag 收集，最后按材质合并）
 * ------------------------------------------------------------------ */

type M = THREE.Matrix4

function plate(bag: GeoBag, key: string, mat: THREE.Material, w: number, h: number, d: number, m: M) {
  bag.add(key, mat, new THREE.BoxGeometry(w, h, d), m)
}

function tube(
  bag: GeoBag,
  key: string,
  mat: THREE.Material,
  rTop: number,
  rBot: number,
  h: number,
  m: M,
  seg = 14,
) {
  bag.add(key, mat, new THREE.CylinderGeometry(rTop, rBot, h, seg), m)
}

/** 轮对：轴线沿 Z（横向） */
function wheelPair(bag: GeoBag, mat: THREE.Material, x: number, z: number, r = RAIL_GAP, w = 0.16) {
  // tube(bag, key, mat, rTop, rBot, h, m, seg) —— 参数顺序别搞反
  tube(bag, 'wheel', mat, r, r, w, mat4([x, r, z], [Math.PI / 2, 0, 0]), 9)
  // 轮缘
  tube(bag, 'wheel', mat, r + 0.045, r + 0.045, w * 0.4, mat4([x, r, z + 0.0], [Math.PI / 2, 0, 0]), 9)
}

/** 转向架 / 车端只用到这两种材质，单独收口，方便客车复用 */
interface RigMats {
  dark: THREE.Material
  metal: THREE.Material
}

/** 转向架：构架 + 2 轴 4 轮 */
function bogie(bag: GeoBag, p: RigMats, x: number) {
  plate(bag, 'dark', p.dark, 4.5, 0.46, 2.36, mat4([x, 0.86, 0]))
  plate(bag, 'dark', p.dark, 4.9, 0.22, 1.1, mat4([x, 0.62, 0]))
  // 轴箱
  for (const dx of [-1.5, 1.5]) {
    plate(bag, 'dark', p.dark, 0.9, 0.5, 0.5, mat4([x + dx, 0.66, 1.22]))
    plate(bag, 'dark', p.dark, 0.9, 0.5, 0.5, mat4([x + dx, 0.66, -1.22]))
  }
  for (const dx of [-1.5, 1.5]) {
    wheelPair(bag, p.metal, x + dx, 1.14)
    wheelPair(bag, p.metal, x + dx, -1.14)
  }
  // 弹簧
  for (const dx of [-1.5, 1.5]) {
    tube(bag, 'metal', p.metal, 0.16, 0.16, 0.4, mat4([x + dx, 1.12, 1.16]), 8)
    tube(bag, 'metal', p.metal, 0.16, 0.16, 0.4, mat4([x + dx, 1.12, -1.16]), 8)
  }
}

/** 车端：缓冲梁、车钩、扶手 */
function endRig(bag: GeoBag, p: RigMats, x: number, sign: 1 | -1) {
  plate(bag, 'dark', p.dark, 0.34, 0.62, 2.5, mat4([x, FLOOR_Y - 0.2, 0]))
  // 车钩
  plate(bag, 'metal', p.metal, 0.62, 0.3, 0.34, mat4([x + sign * 0.42, FLOOR_Y - 0.34, 0]))
  tube(bag, 'metal', p.metal, 0.16, 0.16, 0.34, mat4([x + sign * 0.72, FLOOR_Y - 0.34, 0], [0, 0, Math.PI / 2]), 8)
  // 扶手
  tube(bag, 'metal', p.metal, 0.045, 0.045, 0.9, mat4([x + sign * 0.22, FLOOR_Y + 0.55, 1.18]), 6)
  tube(bag, 'metal', p.metal, 0.045, 0.045, 0.9, mat4([x + sign * 0.22, FLOOR_Y + 0.55, -1.18]), 6)
}

/* ------------------------------------------------------------------ *
 * DD51 型内燃机车（参考图里最前面那台橙色车头）
 * ------------------------------------------------------------------ */

function buildDd51(p: Paint, hasStack: boolean) {
  const bag = new GeoBag()
  const L = TRAIN.carLength
  const halfL = L / 2

  // 底架
  plate(bag, 'dark', p.dark, L - 0.4, 0.5, 2.86, mat4([0, FLOOR_Y + 0.25, 0]))

  // 长机罩（车尾方向）
  const hoodFrontX = 2.1
  const hoodBackX = -halfL + 0.5
  const hoodLen = hoodFrontX - hoodBackX
  const hoodCx = (hoodFrontX + hoodBackX) / 2
  plate(bag, 'body', p.body, hoodLen, 2.42, 2.8, mat4([hoodCx, FLOOR_Y + 1.71, 0]))
  // 机罩顶（深色）
  plate(bag, 'roof', p.roof, hoodLen - 0.3, 0.26, 2.62, mat4([hoodCx, FLOOR_Y + 3.05, 0]))
  // 全长奶油腰带（参考图里那两道横贯车身的浅色带）
  plate(bag, 'cream', p.cream, hoodLen - 0.1, 0.30, 2.88, mat4([hoodCx, FLOOR_Y + 1.58, 0]))
  // 腰带上沿的橙黄细条
  plate(bag, 'stripe', p.stripe, hoodLen - 0.1, 0.13, 2.9, mat4([hoodCx, FLOOR_Y + 1.80, 0]))
  // 机罩散热格栅
  for (let i = 0; i < 4; i++) {
    const gx = hoodBackX + 1.6 + i * 2.5
    plate(bag, 'roofDark', p.roofDark, 1.5, 0.52, 0.06, mat4([gx, FLOOR_Y + 2.45, 1.42]))
    plate(bag, 'roofDark', p.roofDark, 1.5, 0.52, 0.06, mat4([gx, FLOOR_Y + 2.45, -1.42]))
  }
  // 机罩顶通风扇
  for (let i = 0; i < 3; i++) {
    tube(bag, 'roofDark', p.roofDark, 0.46, 0.46, 0.24, mat4([hoodBackX + 2.6 + i * 3.4, FLOOR_Y + 3.28, 0]), 12)
  }

  // 驾驶室（车头方向，+X）
  const cabFrontX = halfL - 0.35
  const cabLen = cabFrontX - hoodFrontX
  const cabCx = (cabFrontX + hoodFrontX) / 2
  plate(bag, 'body', p.body, cabLen, 2.62, 2.84, mat4([cabCx, FLOOR_Y + 1.81, 0]))
  // 驾驶室顶（略矮，做出高低差）
  plate(bag, 'roof', p.roof, cabLen + 0.12, 0.24, 2.7, mat4([cabCx, FLOOR_Y + 3.24, 0]))

  // 前风挡（两片，中间立柱）
  plate(bag, 'glass', p.glass, 0.1, 0.92, 1.06, mat4([cabFrontX + 0.03, FLOOR_Y + 2.42, 0.66]))
  plate(bag, 'glass', p.glass, 0.1, 0.92, 1.06, mat4([cabFrontX + 0.03, FLOOR_Y + 2.42, -0.66]))
  plate(bag, 'roofDark', p.roofDark, 0.12, 0.96, 0.2, mat4([cabFrontX + 0.04, FLOOR_Y + 2.42, 0]))
  // 侧窗
  for (const z of [1.44, -1.44]) {
    for (const dx of [-0.95, 0.15]) {
      plate(bag, 'glass', p.glass, 0.78, 0.72, 0.1, mat4([cabCx + dx, FLOOR_Y + 2.46, z]))
    }
  }

  // 车头 V 形奶油饰带：正面两片斜板 + 沿机身向后的两条斜带，合起来是一个 V
  const vY = FLOOR_Y + 1.58
  for (const zs of [1, -1]) {
    // 正面：从中间向两侧上方拉开
    plate(
      bag,
      'cream',
      p.cream,
      0.14,
      0.5,
      1.16,
      mat4([cabFrontX + 0.06, vY + 0.34, zs * 0.42], [zs * 0.66, 0, 0]),
    )
    // 侧面：沿车身向后收，形成 V 的两臂
    plate(
      bag,
      'cream',
      p.cream,
      2.9,
      0.34,
      0.07,
      mat4([cabFrontX - 1.55, vY + 0.72, zs * 1.42], [0, 0, zs * 0.0]),
    )
  }

  // 前照灯（一对圆灯 + 顶部一盏）
  for (const z of [0.72, -0.72]) {
    tube(bag, 'lamp', p.lamp, 0.27, 0.27, 0.24, mat4([cabFrontX + 0.14, FLOOR_Y + 1.06, z], [0, 0, Math.PI / 2]), 12)
    plate(bag, 'metal', p.metal, 0.1, 0.62, 0.62, mat4([cabFrontX + 0.02, FLOOR_Y + 1.06, z]))
  }
  // 顶部前照灯
  tube(bag, 'lamp', p.lamp, 0.22, 0.22, 0.22, mat4([hoodFrontX - 0.9, FLOOR_Y + 3.28, 0], [0, 0, Math.PI / 2]), 12)

  // 车尾尾灯
  for (const z of [0.78, -0.78]) {
    tube(bag, 'cream', p.cream, 0.19, 0.19, 0.2, mat4([-halfL + 0.16, FLOOR_Y + 1.18, z], [0, 0, Math.PI / 2]), 10)
  }

  // 转向架
  bogie(bag, p, TRAIN.bogieOffset)
  bogie(bag, p, -TRAIN.bogieOffset)
  endRig(bag, p, halfL - 0.22, 1)
  endRig(bag, p, -halfL + 0.22, -1)

  // 蒸汽烟囱（车头机罩顶部前段）
  if (hasStack) {
    tube(bag, 'roofDark', p.roofDark, 0.3, 0.36, 0.5, mat4([hoodFrontX - 0.6, FLOOR_Y + 3.4, 0]), 12)
  }

  const group = bag.build('dd51')
  const outline = buildOutline(group)
  if (outline) group.add(outline)
  return group
}

/* ------------------------------------------------------------------ *
 * 客车（圆顶 + 腰带涂装）
 * ------------------------------------------------------------------ */

interface CoachLivery {
  upper: string // 腰线以上
  lower: string // 腰线以下
  roof: string
  roofDark: string
  waist: string
}

function buildCoach(livery: CoachLivery, seed: number) {
  const bag = new GeoBag()
  const L = TRAIN.carLength
  const halfL = L / 2
  const W = TRAIN.width
  const bodyBottom = FLOOR_Y + 0.5
  const bodyHeight = 2.6
  const bodyTop = bodyBottom + bodyHeight
  const bodyLen = L - 1.0

  const p = {
    upper: toon(livery.upper),
    lower: toon(livery.lower),
    waist: toon(livery.waist),
    roof: toon(livery.roof),
    roofDark: toon(livery.roofDark),
    dark: toon(PALETTE.locoDark),
    metal: toon('#6f6a63'),
    glass: toon(PALETTE.locoGlass, { emissive: '#ffd9a0', emissiveIntensity: 0 }),
    cream: toon(PALETTE.coachCream),
    lamp: toon('#fff6d8', { emissive: '#fff2c8', emissiveIntensity: 0.45 }),
  }
  litMaterials.push(p.glass)
  lampMaterials.push(p.lamp)

  // 底架
  plate(bag, 'dark', p.dark, L - 0.5, 0.42, W, mat4([0, FLOOR_Y + 0.22, 0]))

  // 下半身（腰线以下）
  plate(bag, 'lower', p.lower, bodyLen, 1.18, W, mat4([0, bodyBottom + 0.59, 0]))
  // 上半身（腰线以上）
  plate(bag, 'upper', p.upper, bodyLen, 1.42, W, mat4([0, bodyBottom + 1.18 + 0.71, 0]))
  // 腰线
  plate(bag, 'waist', p.waist, bodyLen + 0.04, 0.17, W + 0.05, mat4([0, bodyBottom + 1.18, 0]))

  // 圆顶：半圆柱沿车长方向，顶面朝上
  // 旋转推导：CylinderGeometry 轴为 Y，theta 从 +Z 起算。
  // rotateZ(-90°) 后 Y 轴 → X（车长），且 theta=270° 对应世界 +Y（正上方）。
  // 故取 theta ∈ [PI, 2PI] 恰好是上半弧。
  const roofGeo = new THREE.CylinderGeometry(
    W / 2 + 0.02,
    W / 2 + 0.02,
    bodyLen,
    22,
    1,
    false,
    Math.PI,
    Math.PI,
  )
  roofGeo.rotateZ(-Math.PI / 2)
  // 压扁成椭圆拱：真实客车车顶只占车身的一小截，等比半圆会显得头重脚轻
  roofGeo.scale(1, 0.46, 1)
  bag.add('roof', p.roof, roofGeo, mat4([0, bodyTop, 0]))

  // 车顶通风帽（参考图里那一排圆点）
  const rnd = mulberry32(seed)
  for (let i = 0; i < 7; i++) {
    const x = -bodyLen / 2 + 2.0 + i * ((bodyLen - 4.0) / 6)
    tube(bag, 'roofDark', p.roofDark, 0.28, 0.3, 0.2, mat4([x, bodyTop + W / 2 - 0.04, rnd() * 0.1 - 0.05]), 10)
  }

  // 窗带：一条深色长条 + 分格窗
  const winY = bodyBottom + 1.72
  for (const z of [W / 2 + 0.01, -W / 2 - 0.01]) {
    plate(bag, 'glassDark', p.glass, bodyLen - 0.7, 0.94, 0.06, mat4([0, winY, z]))
  }
  const winCount = 8
  for (let i = 0; i < winCount; i++) {
    const x = -bodyLen / 2 + 1.5 + i * ((bodyLen - 3.0) / (winCount - 1))
    for (const z of [W / 2 + 0.06, -W / 2 - 0.06]) {
      // 窗框
      plate(bag, 'roofDark', p.roofDark, 1.34, 1.08, 0.05, mat4([x, winY, z]))
      plate(bag, 'glass', p.glass, 1.18, 0.92, 0.05, mat4([x, winY, z + Math.sign(z) * 0.03]))
    }
  }

  // 车门
  for (const dx of [-halfL + 1.9, halfL - 1.9]) {
    for (const z of [W / 2 + 0.02, -W / 2 - 0.02]) {
      plate(bag, 'waist', p.waist, 0.9, 2.1, 0.05, mat4([dx, bodyBottom + 1.1, z]))
      plate(bag, 'glass', p.glass, 0.6, 0.7, 0.04, mat4([dx, bodyBottom + 1.72, z + Math.sign(z) * 0.03]))
    }
  }

  // 端部：风挡 + 端墙
  for (const [x, sign] of [
    [halfL - 0.5, 1],
    [-halfL + 0.5, -1],
  ] as const) {
    plate(bag, 'roofDark', p.roofDark, 0.22, 1.5, 1.3, mat4([x, bodyBottom + 1.9, 0]))
    plate(bag, 'upper', p.upper, 0.22, 2.4, W - 0.2, mat4([x, bodyBottom + 1.2, 0]))
    plate(bag, 'metal', p.metal, 0.1, 0.62, 0.62, mat4([x + sign * 0.2, bodyBottom + 0.5, 0]))
  }

  bogie(bag, p, TRAIN.bogieOffset)
  bogie(bag, p, -TRAIN.bogieOffset)
  endRig(bag, p, halfL - 0.22, 1)
  endRig(bag, p, -halfL + 0.22, -1)

  const group = bag.build('coach')
  const outline = buildOutline(group)
  if (outline) group.add(outline)
  return group
}

/* ------------------------------------------------------------------ *
 * 编组
 * ------------------------------------------------------------------ */

export interface Car {
  group: THREE.Group
  /** 车体在曲线上的距离（米） */
  dist: number
  length: number
  /** 该车是否挂蒸汽烟囱 */
  emitter: THREE.Object3D | null
}

export function buildConsist(): Car[] {
  const dd51Paint = mkPaint({
    body: PALETTE.locoOrange,
    cream: PALETTE.locoCream,
    stripe: PALETTE.locoStripe,
    roof: PALETTE.locoRoof,
    roofDark: PALETTE.locoRoofDark,
  })
  const maroonPaint = mkPaint({
    body: PALETTE.maroonBody,
    cream: PALETTE.coachCream,
    stripe: PALETTE.locoStripe,
    roof: PALETTE.maroonRoof,
    roofDark: PALETTE.locoRoofDark,
  })

  const cars: Car[] = []
  let cursor = 0

  for (const kind of TRAIN.consist) {
    let group: THREE.Group
    let emitter: THREE.Object3D | null = null

    switch (kind) {
      case 'dd51':
        group = buildDd51(dd51Paint, true)
        emitter = new THREE.Object3D()
        emitter.position.set(1.5, FLOOR_Y + 3.72, 0)
        group.add(emitter)
        break
      case 'locoMaroon':
        group = buildDd51(maroonPaint, true)
        break
      case 'coachTeal':
        group = buildCoach(
          {
            // 参考图里第一节客车：奶油上身 + 青绿腰线以下
            upper: PALETTE.coachCream,
            lower: PALETTE.coachTeal,
            waist: PALETTE.coachTealDark,
            roof: PALETTE.coachRoof,
            roofDark: PALETTE.coachRoofDark,
          },
          11,
        )
        break
      case 'coachTeal2':
        group = buildCoach(
          {
            upper: PALETTE.coachTeal,
            lower: PALETTE.coachCream,
            waist: '#2f6f66',
            roof: PALETTE.coachRoofDark,
            roofDark: PALETTE.coachRoof,
          },
          23,
        )
        break
      case 'coachOlive':
        group = buildCoach(
          {
            upper: PALETTE.oliveCream,
            lower: PALETTE.oliveBody,
            waist: '#8a7c3e',
            roof: '#ded9cc',
            roofDark: PALETTE.coachRoofDark,
          },
          31,
        )
        break
      default:
        group = buildCoach(
          {
            upper: PALETTE.coachCream,
            lower: PALETTE.coachCream,
            waist: '#a8a49a',
            roof: PALETTE.coachRoof,
            roofDark: PALETTE.coachRoofDark,
          },
          47,
        )
        break
    }

    group.name = `car_${kind}_${cars.length}`
    cars.push({ group, dist: cursor, length: TRAIN.carLength, emitter })
    cursor += TRAIN.carLength + TRAIN.gap
  }

  return cars
}

/** 整列车占用的总长度 */
export function consistLength(cars: Car[]) {
  return cars.reduce((a, c) => a + c.length + TRAIN.gap, 0)
}

/** 由四时预设驱动车窗 / 车灯 */
export function applyInteriorLighting(settings: TimeSettings) {
  for (const m of litMaterials) {
    m.emissiveIntensity = settings.interiorEmit
    m.emissive.set(settings.interiorEmit > 0.9 ? '#ffcf8a' : '#ffd9a0')
  }
  for (const m of lampMaterials) {
    m.emissiveIntensity = 0.45 + settings.interiorEmit * 0.85
  }
}
