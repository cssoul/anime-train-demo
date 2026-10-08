import * as THREE from 'three'

/**
 * 全局美术参数。所有颜色 / 尺寸集中在这里，方便对着参考图快速标定。
 * 参考：日本动漫（吉卜力风）湖上铁道 —— 高饱和、硬边光影、清透湖蓝。
 */

/** 固定渲染分辨率：题目要求 1920×1080 */
export const RENDER = {
  width: 1920,
  height: 1080,
} as const

/** 色板（取自参考视频逐帧取色） */
export const PALETTE = {
  // 天空
  skyTop: '#2f9de0',
  skyMid: '#7fcbf0',
  skyHorizon: '#dff4ff',
  cloud: '#ffffff',
  cloudShade: '#c9dfec',

  // 水
  waterShallow: '#6fd9dd',
  waterMid: '#37b4cd',
  waterDeep: '#1c86b8',
  waterAbyss: '#1268a2',
  foam: '#f0fdff',

  // 草地
  grassLit: '#a6dc52',
  grassMid: '#78c03a',
  grassDark: '#4a9429',
  grassShade: '#2f6b20',

  // 路基
  ballast: '#b9ab97',
  ballastDark: '#8d7f6c',
  sleeper: '#8a6a48',
  sleeperDark: '#523c29',
  rail: '#8a837a',
  railDark: '#5c564f',

  // 泥土 / 岩石
  rock: '#9d8e78',
  rockDark: '#6d6051',
  earth: '#8a7255',
  earthDark: '#5f4c38',

  // 列车
  locoOrange: '#e0712c',
  locoCream: '#f2e4c4',
  locoStripe: '#f0b429',
  locoRoof: '#4a4239',
  locoRoofDark: '#332c26',
  locoDark: '#2b2824',
  locoGlass: '#22323e',

  coachTeal: '#4fa89b',
  coachTealDark: '#3d8b80',
  coachCream: '#eae0c8',
  coachRoof: '#bcb9b1',
  coachRoofDark: '#94918a',

  maroonBody: '#93372a',
  maroonRoof: '#414c39',

  oliveBody: '#b5a45c',
  oliveCream: '#ded1b0',

  // 道具
  poleWood: '#6b4a33',
  poleDark: '#382e26',
  poleLamp: '#2e2a25',
  boatWood: '#8b6a45',

  // 植被
  treeDark: '#2c6b30',
  treeMid: '#3f8a3d',
  treeLit: '#63aa48',
  bushDark: '#3f8a30',
  bushMid: '#5fb03e',

  // 花
  flowerRed: '#e8402f',
  flowerYellow: '#f6c62e',
  flowerPurple: '#b45fd4',
  flowerWhite: '#fdfdf8',
  flowerPink: '#f489b0',
  flowerOrange: '#f58b28',

  // 荷叶
  lilyPad: '#3f9440',
  lilyPadDark: '#2c6d2e',
  lotusPink: '#f7a8c8',
} as const

export const FLOWER_COLORS = [
  PALETTE.flowerRed,
  PALETTE.flowerYellow,
  PALETTE.flowerPurple,
  PALETTE.flowerWhite,
  PALETTE.flowerPink,
  PALETTE.flowerOrange,
]

/**
 * 轨道：一条**闭合回路**。闭合是为了让列车永远开下去、不会在画面里凭空消失；
 * 回路做得足够大，镜头只框住其中一段，看上去就是参考图里那条 S 形湖上长堤。
 */
export const TRACK = {
  /** 椭圆半轴 */
  rx: 126,
  rz: 88,
  /** 有机起伏，避免看出是标准椭圆 */
  wobbleA: 0.09,
  wobbleB: 0.045,
  /** 曲线采样点数（闭合） */
  segments: 900,

  /** 轨距 */
  gauge: 1.62,
  /** 道砟带宽度 */
  ballastWidth: 6.0,
  /** 长堤总宽（含两侧草坡）；参考图里草坡很宽，是画面的一半戏份 */
  causewayWidth: 22.8,
  /** 长堤露出水面的高度 */
  causewayHeight: 1.9,
  /** 枕木间距 */
  sleeperPitch: 0.72,
  /** 钢轨高度（轨面相对长堤顶面） */
  railLift: 0.26,
} as const

/** 列车编组：照着参考图从车头往车尾排 */
export const TRAIN = {
  /** 每节车长度 */
  carLength: 19.6,
  /** 车间挂钩间隙 */
  gap: 1.15,
  /** 车体宽 */
  width: 2.86,
  /** 车体高（不含车顶弧） */
  bodyHeight: 3.0,
  /** 转向架中心相对车体中心的纵向偏移 */
  bogieOffset: 6.4,
  /** 沿线路运行速度（m/s） */
  speed: 11.5,
  /** 弯道超高（侧倾）系数 */
  bank: 0.55,
  /** 编组表：type 决定几何与涂装 */
  consist: [
    'dd51',
    'coachTeal',
    'coachTeal2',
    'locoMaroon',
    'coachOlive',
    'coachCream',
  ],
} as const

/** 一天四时：四套独立预设，不做滤镜后处理 */
export type TimePreset = 'noon' | 'golden' | 'dusk' | 'night'

export interface TimeSettings {
  label: string
  skyTop: string
  skyMid: string
  skyHorizon: string
  sunColor: string
  sunIntensity: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  ambientColor: string
  ambientIntensity: number
  fogColor: string
  fogDensity: number
  /** 水色微调（乘算） */
  waterTint: string
  waterGain: number
  /** 窗内灯光强度 */
  interiorEmit: number
  smokeColor: string
}

export const TIME_PRESETS: Record<TimePreset, TimeSettings> = {
  noon: {
    label: '正午',
    skyTop: '#2f9de0',
    skyMid: '#7fcbf0',
    skyHorizon: '#dff4ff',
    sunColor: '#fff6e2',
    sunIntensity: 1.20,
    hemiSky: '#c6ebff',
    hemiGround: '#4a7a2e',
    hemiIntensity: 0.62,
    ambientColor: '#9fc6dd',
    ambientIntensity: 0.22,
    fogColor: '#cfeeff',
    fogDensity: 0.0016,
    waterTint: '#ffffff',
    waterGain: 1.0,
    interiorEmit: 0.0,
    smokeColor: '#ffffff',
  },
  golden: {
    label: '黄昏',
    skyTop: '#4f8fd0',
    skyMid: '#ffc98a',
    skyHorizon: '#ffe6bd',
    sunColor: '#ffd09a',
    sunIntensity: 1.06,
    hemiSky: '#ffd8b0',
    hemiGround: '#5a6b2e',
    hemiIntensity: 0.56,
    ambientColor: '#c79a78',
    ambientIntensity: 0.20,
    fogColor: '#ffdcb0',
    fogDensity: 0.0026,
    waterTint: '#ffe8c8',
    waterGain: 0.96,
    interiorEmit: 0.35,
    smokeColor: '#fff2df',
  },
  dusk: {
    label: '薄暮',
    skyTop: '#2b4a86',
    skyMid: '#a06ba8',
    skyHorizon: '#ffb489',
    sunColor: '#ffb07a',
    sunIntensity: 0.86,
    hemiSky: '#9aa8d8',
    hemiGround: '#3a4028',
    hemiIntensity: 0.44,
    ambientColor: '#6a7aa8',
    ambientIntensity: 0.26,
    fogColor: '#c9a0a0',
    fogDensity: 0.0032,
    waterTint: '#d8c0e0',
    waterGain: 0.82,
    interiorEmit: 1.15,
    smokeColor: '#efe4ee',
  },
  night: {
    label: '夜色',
    skyTop: '#071228',
    skyMid: '#12294e',
    skyHorizon: '#2e5a78',
    sunColor: '#8fb8e0',
    sunIntensity: 0.42,
    hemiSky: '#22406c',
    hemiGround: '#101d14',
    hemiIntensity: 0.34,
    ambientColor: '#1c3455',
    ambientIntensity: 0.20,
    fogColor: '#122438',
    fogDensity: 0.0034,
    // 夜里水要深、要蓝，不能只是把白天调暗（一压就是灰的）
    waterTint: '#5f8cc8',
    waterGain: 0.34,
    interiorEmit: 2.4,
    smokeColor: '#b8c6da',
  },
}

/** 镜头机位预设 */
/**
 * 机位预设 —— **全部相对列车**，不是固定的世界坐标。
 * 固定机位只能拍到列车经过的那十几秒；做成"绕环路跟着车走的偏移"，
 * 无论什么时候切过去都是一张有车的构图。
 * radius / height / azimuthOffset 都是相对取景锚点（车头往车尾退 lookBack 米）的极坐标。
 */
export const CAMERA_PRESETS = {
  hero: {
    label: '主视角',
    radius: 170,
    height: 60,
    azimuthOffset: 0.41,
    lookBack: 55,
    fov: 30,
  },
  closeup: {
    label: '近景',
    radius: 74,
    height: 26,
    azimuthOffset: 0.30,
    lookBack: 22,
    fov: 32,
  },
  low: {
    label: '贴水',
    radius: 92,
    height: 11,
    azimuthOffset: 0.14,
    lookBack: 34,
    fov: 34,
  },
  aerial: {
    label: '俯瞰',
    radius: 235,
    height: 235,
    azimuthOffset: 0.62,
    lookBack: 46,
    fov: 34,
  },
} as const

export type CameraPresetKey = keyof typeof CAMERA_PRESETS

/** toon 渐变阶梯：把连续光照量化成硬边色阶，这是"赛璐璐"观感的核心 */
export const TOON_RAMP = [0.30, 0.53, 0.72, 0.88, 1.0] as const

/** 描边 */
export const OUTLINE = {
  color: '#2a2330',
  opacity: 0.62,
  /** EdgesGeometry 折角阈值（度） */
  threshold: 28,
} as const

export const deg = (d: number) => (d * Math.PI) / 180

/** 一个可复用的"按材质合批"的几何收集器 —— 用 draw call 换性能 */
export class GeoBag {
  private buckets = new Map<string, { mat: THREE.Material; geos: THREE.BufferGeometry[] }>()

  add(key: string, mat: THREE.Material, geo: THREE.BufferGeometry, m: THREE.Matrix4) {
    let bucket = this.buckets.get(key)
    if (!bucket) {
      bucket = { mat, geos: [] }
      this.buckets.set(key, bucket)
    }
    geo.applyMatrix4(m)
    // 统一属性集，否则 mergeGeometries 会失败（也顺带堵住 §13.1 的纯黑坑）
    const count = geo.getAttribute('position').count
    if (!geo.getAttribute('normal')) {
      geo.computeVertexNormals()
    }
    if (!geo.getAttribute('uv')) {
      geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(count * 2), 2))
    }
    geo.deleteAttribute('color')
    bucket.geos.push(geo)
    return this
  }

  build(name: string, extras?: (geo: THREE.BufferGeometry[], mat: THREE.Material) => void) {
    const group = new THREE.Group()
    group.name = name
    for (const [key, bucket] of this.buckets) {
      if (!bucket.geos.length) continue
      extras?.(bucket.geos, bucket.mat)
      const merged = mergeAll(bucket.geos)
      if (!merged) continue
      const mesh = new THREE.Mesh(merged, bucket.mat)
      mesh.name = `${name}__${key}`
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
    }
    return group
  }
}

/** 合并工具（延迟 import 以避免循环依赖） */
let mergeFn: ((geos: THREE.BufferGeometry[]) => THREE.BufferGeometry | null) | null = null
export function setMergeFn(fn: (geos: THREE.BufferGeometry[]) => THREE.BufferGeometry | null) {
  mergeFn = fn
}
function mergeAll(geos: THREE.BufferGeometry[]) {
  if (geos.length === 1) return geos[0]
  return mergeFn ? mergeFn(geos) : geos[0]
}
