import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { TOON_RAMP, OUTLINE, setMergeFn } from './config'

// 把 mergeGeometries 注入 config 的 GeoBag（避免循环依赖）
setMergeFn((geos) => mergeGeometries(geos, false) as THREE.BufferGeometry | null)

export { mergeGeometries }

/* ------------------------------------------------------------------ *
 * 赛璐璐（cel）光照阶梯
 * ------------------------------------------------------------------ */

let _gradientMap: THREE.DataTexture | null = null

/**
 * 把连续光照量化成 N 级硬边色阶。
 * 这是"动漫感"最大的一笔 —— 没有它，所有材质都只是普通的平滑着色。
 * 注意采样坐标是 dotNL*0.5+0.5 ∈ [0,1]，所以数组按暗→亮排列。
 */
export function gradientMap(): THREE.DataTexture {
  if (_gradientMap) return _gradientMap
  const steps = TOON_RAMP.length
  const data = new Uint8Array(steps)
  for (let i = 0; i < steps; i++) data[i] = Math.round(TOON_RAMP[i] * 255)
  const tex = new THREE.DataTexture(data, steps, 1, THREE.RedFormat)
  tex.minFilter = THREE.NearestFilter
  tex.magFilter = THREE.NearestFilter
  tex.generateMipmaps = false
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  _gradientMap = tex
  return tex
}

export interface ToonOpts {
  emissive?: THREE.ColorRepresentation
  emissiveIntensity?: number
  transparent?: boolean
  opacity?: number
  side?: THREE.Side
  vertexColors?: boolean
  map?: THREE.Texture | null
  alphaTest?: number
  depthWrite?: boolean
  fog?: boolean
}

/** 统一的卡通材质工厂 */
export function toon(color: THREE.ColorRepresentation, opts: ToonOpts = {}) {
  return new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: gradientMap(),
    emissive: new THREE.Color(opts.emissive ?? 0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    transparent: opts.transparent ?? false,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    vertexColors: opts.vertexColors ?? false,
    map: opts.map ?? null,
    alphaTest: opts.alphaTest ?? 0,
    depthWrite: opts.depthWrite ?? true,
    fog: opts.fog ?? true,
  })
}

/* ------------------------------------------------------------------ *
 * 描边（硬表面线稿）
 * 机械类物体用 EdgesGeometry 抽折边，比反壳描边更接近动画原画的"线"
 * ------------------------------------------------------------------ */

const outlineMaterial = new THREE.LineBasicMaterial({
  color: new THREE.Color(OUTLINE.color),
  transparent: true,
  opacity: OUTLINE.opacity,
  depthWrite: false,
})

/**
 * 把 group 里所有 mesh 的折边合成**一个** LineSegments。
 * 前提：子 mesh 的本地变换为单位阵（GeoBag 已经把变换烘进几何体了）。
 * 一个车 = 一个线稿 draw call。
 */
export function buildOutline(root: THREE.Object3D, threshold = OUTLINE.threshold) {
  const geos: THREE.BufferGeometry[] = []
  root.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !mesh.geometry) return
    try {
      const eg = new THREE.EdgesGeometry(mesh.geometry, threshold)
      if (eg.getAttribute('position')?.count) geos.push(eg)
    } catch {
      /* 某些几何（如 Line/LOD）不支持，跳过 */
    }
  })
  if (!geos.length) return null
  const merged = geos.length === 1 ? geos[0] : mergeGeometries(geos, false)
  if (!merged) return null
  const lines = new THREE.LineSegments(merged, outlineMaterial)
  lines.name = `${root.name}__outline`
  lines.castShadow = false
  lines.receiveShadow = false
  lines.frustumCulled = false
  return lines
}

/* ------------------------------------------------------------------ *
 * 程序化贴图
 * ------------------------------------------------------------------ */

function canvas2d(w: number, h: number) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  return { c, ctx }
}

/** 蒸汽/云朵：一簇带明暗的棉团，模拟参考图里那团巨大的白色水汽 */
export function smokeTexture(size = 256): THREE.Texture {
  const { c, ctx } = canvas2d(size, size)
  const r = size / 2

  // 底：偏冷的阴影色（云团下沿）
  const lobes: [number, number, number][] = [
    [0.0, 0.06, 0.40],
    [-0.26, 0.04, 0.30],
    [0.27, 0.02, 0.31],
    [-0.13, -0.24, 0.27],
    [0.15, -0.22, 0.26],
    [0.0, 0.34, 0.26],
    [-0.34, 0.24, 0.20],
    [0.35, 0.22, 0.21],
  ]

  // 阴影层
  ctx.globalCompositeOperation = 'source-over'
  for (const [dx, dy, rad] of lobes) {
    const x = r + dx * r
    const y = r + dy * r
    const rr = rad * r
    const g = ctx.createRadialGradient(x, y + rr * 0.28, rr * 0.15, x, y, rr)
    g.addColorStop(0, 'rgba(198,220,234,0.95)')
    g.addColorStop(0.72, 'rgba(210,228,240,0.72)')
    g.addColorStop(1, 'rgba(220,235,245,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, rr, 0, Math.PI * 2)
    ctx.fill()
  }

  // 高光层（整体上移，做出"上亮下暗"的体积感）
  for (const [dx, dy, rad] of lobes) {
    const x = r + dx * r
    const y = r + (dy - 0.11) * r
    const rr = rad * r * 0.9
    const g = ctx.createRadialGradient(x - rr * 0.2, y - rr * 0.3, rr * 0.1, x, y, rr)
    g.addColorStop(0, 'rgba(255,255,255,1)')
    g.addColorStop(0.6, 'rgba(255,255,255,0.94)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, rr, 0, Math.PI * 2)
    ctx.fill()
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 天空：垂直渐变 + 手绘积云，直接铺在天空球上 */
export function skyTexture(settings: {
  top: string
  mid: string
  horizon: string
  cloud: string
  cloudShade: string
}) {
  const W = 2048
  const H = 1024
  const { c, ctx } = canvas2d(W, H)

  // v=0 是天顶，v=1 是天底；地平线落在 v=0.5
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0.0, settings.top)
  g.addColorStop(0.26, settings.top)
  g.addColorStop(0.42, settings.mid)
  g.addColorStop(0.5, settings.horizon)
  g.addColorStop(0.56, settings.horizon)
  g.addColorStop(0.75, settings.mid)
  g.addColorStop(1.0, settings.top)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)

  // 云：只画上半球（v < 0.5），靠近地平线处更扁更密
  const rnd = mulberry32(20260929)
  const puff = (cx: number, cy: number, scale: number, alpha: number) => {
    const n = 5 + Math.floor(rnd() * 4)
    // 阴影底
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const px = cx + Math.cos(a) * 46 * scale * (0.5 + rnd() * 0.7)
      const py = cy + Math.sin(a) * 20 * scale * (0.4 + rnd() * 0.6)
      const rr = (26 + rnd() * 24) * scale
      const rg = ctx.createRadialGradient(px, py + rr * 0.35, rr * 0.2, px, py, rr)
      rg.addColorStop(0, hexA(settings.cloudShade, 0.75 * alpha))
      rg.addColorStop(1, hexA(settings.cloudShade, 0))
      ctx.fillStyle = rg
      ctx.beginPath()
      ctx.arc(px, py, rr, 0, Math.PI * 2)
      ctx.fill()
    }
    // 高光顶
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2
      const px = cx + Math.cos(a) * 44 * scale * (0.5 + rnd() * 0.7)
      const py = cy - 6 * scale + Math.sin(a) * 17 * scale * (0.4 + rnd() * 0.6)
      const rr = (24 + rnd() * 22) * scale
      const rg = ctx.createRadialGradient(px - rr * 0.2, py - rr * 0.35, rr * 0.1, px, py, rr)
      rg.addColorStop(0, hexA(settings.cloud, 0.98 * alpha))
      rg.addColorStop(0.62, hexA(settings.cloud, 0.85 * alpha))
      rg.addColorStop(1, hexA(settings.cloud, 0))
      ctx.fillStyle = rg
      ctx.beginPath()
      ctx.arc(px, py, rr, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  for (let i = 0; i < 26; i++) {
    const cx = rnd() * W
    // 越靠近地平线（v→0.5）云越多越小
    const t = Math.pow(rnd(), 0.6)
    const cy = 40 + t * (H * 0.5 - 70)
    const scale = 0.55 + (1 - t) * 1.5
    puff(cx, cy, scale, 0.5 + (1 - t) * 0.45)
  }

  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  return tex
}

/** 草叶簇：3~4 片剑形叶，带 alpha */
export function grassBladeTexture(size = 128): THREE.Texture {
  const { c, ctx } = canvas2d(size, size)
  const blades = 7
  for (let i = 0; i < blades; i++) {
    const x0 = size * (0.14 + (i / (blades - 1)) * 0.72)
    const h = size * (0.5 + ((i * 37) % 11) / 22)
    const lean = (x0 - size / 2) * 0.42
    ctx.beginPath()
    ctx.moveTo(x0 - size * 0.035, size)
    ctx.quadraticCurveTo(x0 - size * 0.02 + lean * 0.4, size - h * 0.55, x0 + lean, size - h)
    ctx.quadraticCurveTo(x0 + size * 0.02 + lean * 0.4, size - h * 0.55, x0 + size * 0.035, size)
    ctx.closePath()
    const shade = 0.72 + ((i * 53) % 7) * 0.045
    ctx.fillStyle = `rgba(${Math.round(150 * shade)},${Math.round(214 * shade)},${Math.round(88 * shade)},1)`
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 花：五瓣小野花 */
export function flowerTexture(size = 64): THREE.Texture {
  const { c, ctx } = canvas2d(size, size)
  const cx = size / 2
  const cy = size / 2
  const petals = 5
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2 - Math.PI / 2
    ctx.beginPath()
    ctx.ellipse(
      cx + Math.cos(a) * size * 0.19,
      cy + Math.sin(a) * size * 0.19,
      size * 0.19,
      size * 0.14,
      a,
      0,
      Math.PI * 2,
    )
    ctx.fillStyle = '#ffffff'
    ctx.fill()
  }
  ctx.beginPath()
  ctx.arc(cx, cy, size * 0.13, 0, Math.PI * 2)
  ctx.fillStyle = '#ffe9a8'
  ctx.fill()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** 小叶簇 / 灌木叶片（给灌木加细节，避免纯色球） */
export function leafClusterTexture(size = 128): THREE.Texture {
  const { c, ctx } = canvas2d(size, size)
  // 必须铺一层不透明底色：canvas 透明区域的 RGB 是 (0,0,0)，
  // 而 MeshToonMaterial 没有 alphaTest 时不会丢弃它 —— 整个灌木会变成纯黑。
  ctx.fillStyle = '#6fae46'
  ctx.fillRect(0, 0, size, size)
  const rnd = mulberry32(991)
  for (let i = 0; i < 26; i++) {
    const x = size * (0.1 + rnd() * 0.8)
    const y = size * (0.12 + rnd() * 0.8)
    const rr = size * (0.06 + rnd() * 0.055)
    const shade = 0.55 + rnd() * 0.45
    ctx.beginPath()
    ctx.ellipse(x, y, rr, rr * 0.7, rnd() * Math.PI, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(${Math.round(122 * shade)},${Math.round(186 * shade)},${Math.round(72 * shade)},1)`
    ctx.fill()
  }
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/**
 * 把单一颜色烘成顶点色。
 * 用途：多个不同颜色的零件合并成一个几何体后，仍然一个 draw call 画完
 * （电线杆的木杆 + 深色横担 + 灯罩就是这么合的）。
 */
export function tintGeo(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation, gain = 1) {
  const n = geo.getAttribute('position').count
  const c = new THREE.Color(color).multiplyScalar(gain)
  const arr = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    arr[i * 3] = c.r
    arr[i * 3 + 1] = c.g
    arr[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  if (!geo.getAttribute('uv')) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
  }
  return geo
}

/**
 * 硬面化：MeshToonMaterial 不支持 flatShading（那是 Standard/Phong 系的属性），
 * 想做出低多边形的硬朗切面，只能把几何体拆成非索引 + 重算面法线。
 */
export function flatten(geo: THREE.BufferGeometry) {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.computeVertexNormals()
  g.deleteAttribute('uv')
  return g
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * 给几何补一条全白的 color 属性。
 * InstancedMesh 的 setColorAt（instanceColor）只有在材质开 vertexColors 时才会
 * 参与 fragment 混合，而开了 vertexColors 又没有 color 属性就会整块变黑（§13.1）。
 * 白底 + 逐实例色 = 想要的效果。
 */
export function withWhiteColors(geo: THREE.BufferGeometry) {
  const n = geo.getAttribute('position').count
  const arr = new Float32Array(n * 3).fill(1)
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3))
  if (!geo.getAttribute('uv')) {
    geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
  }
  return geo
}

function hexA(hex: string, alpha: number) {
  const c = new THREE.Color(hex)
  return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${alpha})`
}

/** 由尺寸直接生成矩阵，少写点 new THREE.Matrix4().compose */
export function mat4(
  pos: [number, number, number] = [0, 0, 0],
  rot: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
) {
  const m = new THREE.Matrix4()
  const e = new THREE.Euler(rot[0], rot[1], rot[2])
  m.compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(e),
    new THREE.Vector3(...scale),
  )
  return m
}
