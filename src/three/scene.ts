import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import {
  RENDER,
  TIME_PRESETS,
  TRACK,
  TRAIN,
  CAMERA_PRESETS,
  type TimePreset,
  type CameraPresetKey,
  type TimeSettings,
} from './config'
import { createSky, type SkyHandle } from './sky'
import {
  buildCauseway,
  buildRails,
  buildSleepers,
  buildTrackCurve,
  PolyDist,
  RAIL_TOP_Y,
} from './track'
import { buildWater, type WaterHandle } from './water'
import { buildVegetation, buildIslands, buildWaterScatter } from './vegetation'
import { buildTelegraphPoles, buildBoat, buildSignposts } from './props'
import { buildConsist, applyInteriorLighting, type Car } from './train'
import { buildSmoke, type SmokeHandle } from './smoke'
import { toon } from './toon'

export interface Stats {
  fps: number
  frameMs: number
  calls: number
  triangles: number
  resolution: string
}

export interface SceneHandle {
  setPlaying: (v: boolean) => void
  isPlaying: () => boolean
  setSpeed: (v: number) => void
  setTime: (k: TimePreset) => void
  setCameraPreset: (k: CameraPresetKey) => void
  setFollow: (v: boolean) => void
  setAutoFrame: (v: boolean) => void
  isAutoFrame: () => boolean
  setResolutionScale: (s: number) => void
  resetTrain: () => void
  dispose: () => void
  controls: OrbitControls
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
}

export interface SceneOptions {
  onStats?: (s: Stats) => void
  onAutoFrame?: (on: boolean) => void
}



export function createScene(host: HTMLElement, opts: SceneOptions = {}): SceneHandle {
  const params = new URLSearchParams(location.search)
  const captureMode = params.has('capture')

  /* ---------------- 渲染器 ---------------- */
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    // 只有显式带 ?capture=1 才开，验收脚本才能对着生产包跑（§15.8）
    preserveDrawingBuffer: captureMode,
    powerPreference: 'high-performance',
  })
  renderer.setSize(RENDER.width, RENDER.height, false)
  renderer.setPixelRatio(1) // 固定 1920×1080 内部缓冲，缩放交给 CSS
  renderer.outputColorSpace = THREE.SRGBColorSpace
  // 赛璐璐要的是"平"，所以不做 filmic 色调映射 —— 保留高饱和的动画色
  renderer.toneMapping = THREE.NoToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  renderer.domElement.style.display = 'block'
  host.appendChild(renderer.domElement)

  /* ---------------- 场景 / 相机 ---------------- */
  const scene = new THREE.Scene()
  let time: TimePreset = 'noon'
  let settings: TimeSettings = TIME_PRESETS[time]
  scene.fog = new THREE.FogExp2(settings.fogColor, settings.fogDensity)

  const camera = new THREE.PerspectiveCamera(
    CAMERA_PRESETS.hero.fov,
    RENDER.width / RENDER.height,
    0.5,
    4000,
  )
  // 起手先给个合理位姿；真正的机位由"跟随取景"每帧算出来
  camera.position.set(139, 60, 98)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(128, 2, 26)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.minDistance = 18
  controls.maxDistance = 460
  controls.maxPolarAngle = 1.44 // 别翻到水面以下
  controls.minPolarAngle = 0.12
  controls.enablePan = true
  controls.update()

  // 调试用：?cam=x,y,z&tgt=x,y,z&fov=28 可直接覆盖机位，方便对着参考图逐版标定。
  // 注意这是"钉死机位"，必须让跟随逻辑让位（否则下一帧就被拉回去）。
  let hasUrlCamera = false
  const applyUrlCamera = () => {
    const cam = params.get('cam')
    const tgt = params.get('tgt')
    const fov = params.get('fov')
    if (cam) {
      const v = cam.split(',').map(Number)
      if (v.length === 3 && v.every(Number.isFinite)) camera.position.set(v[0], v[1], v[2])
    }
    if (tgt) {
      const v = tgt.split(',').map(Number)
      if (v.length === 3 && v.every(Number.isFinite)) controls.target.set(v[0], v[1], v[2])
    }
    if (fov && Number.isFinite(Number(fov))) {
      camera.fov = Number(fov)
      camera.updateProjectionMatrix()
    }
    hasUrlCamera = !!(cam || tgt)
    controls.update()
  }
  applyUrlCamera()

  /* ---------------- 灯光 ---------------- */
  const hemi = new THREE.HemisphereLight(
    settings.hemiSky,
    settings.hemiGround,
    settings.hemiIntensity,
  )
  scene.add(hemi)

  const ambient = new THREE.AmbientLight(settings.ambientColor, settings.ambientIntensity)
  scene.add(ambient)

  const sun = new THREE.DirectionalLight(settings.sunColor, settings.sunIntensity)
  sun.position.set(150, 190, 120)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  // 阴影正交框按"够用就好"给（§15.5：框的半径是性能预算的一部分）
  sun.shadow.camera.left = -78
  sun.shadow.camera.right = 78
  sun.shadow.camera.top = 78
  sun.shadow.camera.bottom = -78
  sun.shadow.camera.near = 20
  sun.shadow.camera.far = 620
  sun.shadow.bias = -0.0009
  sun.shadow.normalBias = 0.035
  scene.add(sun)
  scene.add(sun.target)

  // 补光：从水面往回打的冷色，参考图里车体下沿是偏青的
  const bounce = new THREE.DirectionalLight('#a8e0ea', 0.32)
  bounce.position.set(-140, 40, -110)
  scene.add(bounce)

  /* ---------------- 世界 ---------------- */
  const curve = buildTrackCurve()
  const polyDist = new PolyDist(curve, 620, 12)

  const sky: SkyHandle = createSky(settings)
  scene.add(sky.mesh)

  // 水
  const water: WaterHandle = buildWater(polyDist, 940, 200)
  scene.add(water.mesh)

  // 长堤
  const causeway = buildCauseway(curve, TRACK.segments)
  const causewayMesh = new THREE.Mesh(causeway.geo, causeway.mat)
  causewayMesh.name = 'causeway'
  causewayMesh.receiveShadow = true
  causewayMesh.castShadow = false
  scene.add(causewayMesh)

  // 道砟面上的细碎石感：叠一层极薄的有色网格，避免大面积纯灰

  // 钢轨
  const railGeo = buildRails(curve, TRACK.segments)
  const railMesh = new THREE.Mesh(railGeo, toon('#ffffff', { vertexColors: true }))
  railMesh.name = 'rails'
  railMesh.castShadow = false
  railMesh.receiveShadow = true
  scene.add(railMesh)

  // 枕木
  scene.add(buildSleepers(curve))

  // 植被 / 岛 / 道具
  const veg = buildVegetation(curve)
  scene.add(veg.group)
  scene.add(buildIslands())
  scene.add(buildWaterScatter(curve))
  scene.add(buildTelegraphPoles(curve))
  scene.add(buildSignposts(curve))

  const boat = buildBoat()
  const boatT = 0.62
  {
    const p = curve.getPointAt(boatT)
    const tan = curve.getTangentAt(boatT)
    const lat = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), tan).normalize()
    boat.position.set(p.x + lat.x * 17.5, -0.16, p.z + lat.z * 17.5)
    boat.rotation.y = Math.atan2(tan.x, tan.z) + 1.15
    scene.add(boat)
  }

  // 列车
  const cars: Car[] = buildConsist()
  const trainRoot = new THREE.Group()
  trainRoot.name = 'train'
  for (const c of cars) trainRoot.add(c.group)
  scene.add(trainRoot)

  const loopLen = curve.getLength()
  let trainHead = loopLen * 0.12 // 车头在曲线上的弧长位置
  // 调试用：?head=83.9 固定车头弧长，?paused=1 暂停，让每次截图可复现
  {
    const h = params.get('head')
    if (h && Number.isFinite(Number(h))) trainHead = Number(h)
  }
  const bootPaused = params.has('paused')

  // 蒸汽
  const smoke: SmokeHandle = buildSmoke()
  scene.add(smoke.object)

  /* ---------------- 列车沿线路摆位 ---------------- */

  const smokeOrigin = new THREE.Vector3()
  const fwd = new THREE.Vector3()

  /**
   * 把每个车厢按自己的弧长摆到曲线上。
   * 朝向契约：所有车模型的车头朝局部 +X，故 yaw = atan2(dx, dz) - PI/2
   * （R_y(θ)·X̂ = (sinφ, 0, cosφ)，取 θ = φ - π/2）。§15.6
   */
  function layoutTrain() {
    let offset = 0
    for (const car of cars) {
      const d = trainHead - (offset + car.length / 2)
      // 归一化到 [0,1)：getPointAt/getTangentAt 走的是弧长重参数化，越界会算错
      const tn = (((d % loopLen) + loopLen) % loopLen) / loopLen
      const p = curve.getPointAt(tn)
      const tan = curve.getTangentAt(tn)

      car.dist = d
      car.group.position.set(p.x, RAIL_TOP_Y, p.z)
      car.group.rotation.order = 'YXZ'
      car.group.rotation.y = Math.atan2(tan.x, tan.z) - Math.PI / 2

      // 弯道倾斜：用切线转角速度估算曲率，再乘速度平方
      const tn2 = (tn + 0.004) % 1
      const tan2 = curve.getTangentAt(tn2)
      const crossY = tan.z * tan2.x - tan.x * tan2.z
      const segLen = 0.004 * loopLen
      const turnRate = crossY / segLen
      const roll = THREE.MathUtils.clamp(
        turnRate * TRAIN.speed * TRAIN.speed * TRAIN.bank * 0.0009,
        -0.13,
        0.13,
      )
      car.group.rotation.x = roll

      offset += car.length + TRAIN.gap
    }
  }

  /* ---------------- 四时预设 ---------------- */

  function applyTime(k: TimePreset) {
    time = k
    settings = TIME_PRESETS[k]
    sky.apply(settings)

    hemi.color.set(settings.hemiSky)
    hemi.groundColor.set(settings.hemiGround)
    hemi.intensity = settings.hemiIntensity
    ambient.color.set(settings.ambientColor)
    ambient.intensity = settings.ambientIntensity
    sun.color.set(settings.sunColor)
    sun.intensity = settings.sunIntensity

    const fog = scene.fog as THREE.FogExp2
    fog.color.set(settings.fogColor)
    fog.density = settings.fogDensity

    water.material.uniforms.uFogColor.value.set(settings.fogColor)
    water.material.uniforms.uFogDensity.value = settings.fogDensity
    water.material.uniforms.uTint.value.set(settings.waterTint)
    water.material.uniforms.uGain.value = settings.waterGain
    water.material.uniforms.uSunColor.value.set(settings.sunColor)
    water.material.uniforms.uSunDir.value
      .copy(sun.position)
      .normalize()

    applyInteriorLighting(settings)
    smoke.setColor(settings.smokeColor)
  }

  /* ---------------- 运行状态 ---------------- */

  let playing = !bootPaused
  let speed = 1
  let follow = false
  /** 取景是否跟随列车。用户自己拖过镜头后交还控制权，变成自由视角。 */
  let camMode: 'tracked' | 'free' = 'free'
  let camPreset: CameraPresetKey = 'hero'
  let resScale = 1

  controls.addEventListener('start', () => {
    if (camMode === 'tracked') {
      camMode = 'free'
      opts.onAutoFrame?.(false)
    }
  })

  const clock = new THREE.Clock()
  let elapsed = 0

  /* ---------------- 主循环 ---------------- */

  let fpsAcc = 0
  let fpsFrames = 0
  let lastStats = 0

  const followTargetPos = new THREE.Vector3()
  const camOffset = new THREE.Vector3(-0.55, 0.62, 0.56).normalize()
  const autoAnchor = new THREE.Vector3()
  const autoCam = new THREE.Vector3()
  const autoLook = new THREE.Vector3()

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05)
    elapsed += dt

    if (playing) {
      trainHead += TRAIN.speed * speed * dt
      if (trainHead > loopLen) trainHead -= loopLen
    }
    layoutTrain()

    // 蒸汽从车头烟囱冒出
    const lead = cars[0]
    if (lead.emitter) {
      lead.emitter.getWorldPosition(smokeOrigin)
      fwd.set(Math.sin(lead.group.rotation.y + Math.PI / 2), 0, Math.cos(lead.group.rotation.y + Math.PI / 2))
      smoke.update(dt, smokeOrigin, fwd)
    }

    water.update(elapsed)

    // 阴影框跟着列车走，才能用最小的框换最清晰的影子
    sun.target.position.copy(lead.group.position)
    sun.position.set(
      lead.group.position.x + 150,
      lead.group.position.y + 190,
      lead.group.position.z + 120,
    )
    sun.target.updateMatrixWorld()

    if (follow) {
      lead.group.getWorldPosition(followTargetPos)
      const want = followTargetPos
        .clone()
        .addScaledVector(camOffset, 62)
        .add(new THREE.Vector3(0, 26, 0))
      camera.position.lerp(want, 1 - Math.pow(0.001, dt))
      controls.target.lerp(followTargetPos.clone().add(new THREE.Vector3(0, 3, 0)), 1 - Math.pow(0.001, dt))
    } else if (camMode === 'tracked') {
      // 取景锚点：车头往车尾退 lookBack 米，大致是整列车的视觉中心
      const preset = CAMERA_PRESETS[camPreset]
      const dAnchor = trainHead - preset.lookBack
      const tn = (((dAnchor % loopLen) + loopLen) % loopLen) / loopLen
      curve.getPointAt(tn, autoAnchor)
      // 相机与锚点同绕环路中心，方位角差固定 → 构图恒定，背景缓缓推移
      const az = Math.atan2(autoAnchor.z, autoAnchor.x) + preset.azimuthOffset
      autoCam.set(Math.cos(az) * preset.radius, preset.height, Math.sin(az) * preset.radius)
      const k = 1 - Math.pow(0.02, dt)
      camera.position.lerp(autoCam, k)
      autoLook.set(autoAnchor.x, 2, autoAnchor.z)
      controls.target.lerp(autoLook, k)
    }

    controls.update()
    renderer.render(scene, camera)

    // 统计
    fpsAcc += dt
    fpsFrames++
    if (elapsed - lastStats > 0.5) {
      lastStats = elapsed
      const s: Stats = {
        fps: fpsFrames / Math.max(fpsAcc, 1e-4),
        frameMs: (fpsAcc / Math.max(fpsFrames, 1)) * 1000,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        resolution: `${Math.round(RENDER.width * resScale)}×${Math.round(RENDER.height * resScale)}`,
      }
      opts.onStats?.(s)
      fpsAcc = 0
      fpsFrames = 0
    }
  }

  renderer.setAnimationLoop(frame)

  // 起手先把列车的真实位置算出来，再据此去预热烟柱
  layoutTrain()
  {
    const lead = cars[0]
    if (lead.emitter) {
      lead.emitter.getWorldPosition(smokeOrigin)
      fwd.set(
        Math.sin(lead.group.rotation.y + Math.PI / 2),
        0,
        Math.cos(lead.group.rotation.y + Math.PI / 2),
      )
      smoke.reset(smokeOrigin)
    }
  }

  applyTime('noon')
  // 默认就进"跟随列车"的取景，任何时刻打开都有一张有车的构图
  camPreset = 'hero'
  camMode = hasUrlCamera ? 'free' : 'tracked'
  if (!hasUrlCamera) {
    camera.fov = CAMERA_PRESETS.hero.fov
    camera.updateProjectionMatrix()
  }

  /* ---------------- 对外接口 ---------------- */

  const api: SceneHandle = {
    controls,
    camera,
    renderer,
    scene,
    setPlaying: (v) => {
      playing = v
    },
    isPlaying: () => playing,
    setSpeed: (v) => {
      speed = v
    },
    setTime: (k) => applyTime(k),
    setCameraPreset: (k) => {
      const p = CAMERA_PRESETS[k]
      follow = false
      camPreset = k
      camMode = 'tracked'
      if (camera.fov !== p.fov) {
        camera.fov = p.fov
        camera.updateProjectionMatrix()
      }
    },
    setFollow: (v) => {
      follow = v
      if (v) camMode = 'free'
    },
    setAutoFrame: (v) => {
      camMode = v ? 'tracked' : 'free'
    },
    isAutoFrame: () => camMode === 'tracked',
    setResolutionScale: (s) => {
      resScale = s
      renderer.setSize(Math.round(RENDER.width * s), Math.round(RENDER.height * s), false)
      renderer.domElement.style.width = '100%'
      renderer.domElement.style.height = '100%'
    },
    resetTrain: () => {
      trainHead = loopLen * 0.12
      layoutTrain()
    },
    dispose: () => {
      renderer.setAnimationLoop(null)
      controls.dispose()
      sky.dispose()
      scene.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.geometry) m.geometry.dispose()
      })
      renderer.dispose()
      renderer.domElement.remove()
    },
  }

  // 取证开关：不绑 import.meta.env.DEV，脚本才能对着生产包量（§15.8）
  ;(window as unknown as Record<string, unknown>).__scene = {
    scene,
    camera,
    renderer,
    controls,
    api,
    curve,
    cars,
    get time() {
      return time
    },
  }

  return api
}
