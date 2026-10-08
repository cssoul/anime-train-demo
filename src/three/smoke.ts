import * as THREE from 'three'
import { smokeTexture, mulberry32 } from './toon'

/**
 * 蒸汽拖尾。
 *
 * 参考图里那团又高又白的水汽是整张画面的"呼吸点"，所以单独做一套：
 * - 用 Sprite（永远面向相机），60 个左右的池子，1 个 draw call
 * - 每个烟团沿生命期上升 + 被风往侧后方吹 + 逐渐膨胀 + 淡出
 * - 关键是要"长"：存活 7 秒左右，才能拉出参考图那种贯穿半屏的柱状拖尾
 */

export interface SmokeHandle {
  object: THREE.Object3D
  update: (dt: number, emitterWorld: THREE.Vector3, forward: THREE.Vector3) => void
  setColor: (c: THREE.ColorRepresentation) => void
  reset: (emitterWorld: THREE.Vector3) => void
  /** 供性能面板/调试读取 */
  readonly count: number
}

interface Puff {
  sprite: THREE.Sprite
  age: number
  life: number
  vx: number
  vy: number
  vz: number
  grow: number
  size0: number
  swirl: number
  phase: number
}

const POOL = 78

export function buildSmoke(): SmokeHandle {
  const group = new THREE.Group()
  group.name = 'smoke'

  const tex = smokeTexture()
  const rnd = mulberry32(31337)
  const puffs: Puff[] = []
  const baseColor = new THREE.Color('#ffffff')

  for (let i = 0; i < POOL; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      color: baseColor.clone(),
      fog: true,
    })
    const sprite = new THREE.Sprite(mat)
    sprite.name = `puff_${i}`
    sprite.scale.setScalar(1)
    sprite.visible = false
    sprite.renderOrder = 5
    group.add(sprite)
    puffs.push({
      sprite,
      age: 0,
      life: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      grow: 1,
      size0: 1,
      swirl: 1,
      phase: rnd() * Math.PI * 2,
    })
  }

  let cursor = 0
  let emitAcc = 0
  const EMIT_INTERVAL = 0.14
  const tmp = new THREE.Vector3()

  const spawn = (origin: THREE.Vector3, forward: THREE.Vector3) => {
    const p = puffs[cursor]
    cursor = (cursor + 1) % POOL

    p.age = 0
    p.life = 7.6 + rnd() * 3.4
    // 出烟口带一点横向散布，不然会串成一根糖葫芦
    p.sprite.position.set(
      origin.x + (rnd() - 0.5) * 0.5,
      origin.y + rnd() * 0.25,
      origin.z + (rnd() - 0.5) * 0.5,
    )
    // 初速：向上为主，只带一点点行进方向的分量。
    // 不能给足列车速度 —— 那样烟团会跟着车跑；现在这样列车往前开、
    // 烟团留在原地，柱体自然被"拉"成参考图里那道向后倾的长拖尾。
    p.vx = forward.x * 1.1 + (rnd() - 0.5) * 0.9
    p.vz = forward.z * 1.1 + (rnd() - 0.5) * 0.9
    p.vy = 4.4 + rnd() * 1.7
    p.size0 = 1.5 + rnd() * 1.1
    p.grow = 4.4 + rnd() * 3.0
    p.swirl = 0.4 + rnd() * 0.9
    p.sprite.visible = true
    p.sprite.material.opacity = 0
    p.sprite.material.rotation = rnd() * Math.PI * 2
  }

  /** 起手先铺满一柱，避免镜头一转过来烟还是空的 */
  const prime = (origin: THREE.Vector3, forward: THREE.Vector3) => {
    for (let i = 0; i < POOL; i++) spawn(origin, forward)
    for (let step = 0; step < 46; step++) {
      update(0.16, origin, forward)
    }
  }

  function update(dt: number, origin: THREE.Vector3, forward: THREE.Vector3) {
    emitAcc += dt
    while (emitAcc >= EMIT_INTERVAL) {
      emitAcc -= EMIT_INTERVAL
      spawn(origin, forward)
    }

    for (const p of puffs) {
      if (!p.sprite.visible) continue
      p.age += dt
      const k = p.age / p.life
      if (k >= 1) {
        p.sprite.visible = false
        p.sprite.material.opacity = 0
        continue
      }

      // 上升减速（浮力衰减）+ 横向风切变
      const drag = 1 - dt * 0.42
      p.vx *= drag
      p.vz *= drag
      p.vy *= 1 - dt * 0.24
      tmp.set(p.vx, p.vy, p.vz)
      p.sprite.position.addScaledVector(tmp, dt)

      // 左右摇摆，让柱体有生命感
      const sway = Math.sin(p.age * 1.7 + p.phase) * p.swirl * 0.42
      p.sprite.position.x += sway * dt
      p.sprite.position.z += Math.cos(p.age * 1.4 + p.phase) * p.swirl * 0.42 * dt

      // 先快速涨开，后段缓慢
      const s = p.size0 + p.grow * Math.pow(k, 0.62)
      p.sprite.scale.set(s, s, s)
      p.sprite.material.rotation += dt * 0.12 * (p.phase > Math.PI ? 1 : -1)

      // 淡入 → 平台 → 淡出
      const fadeIn = Math.min(1, k / 0.08)
      const fadeOut = 1 - Math.pow(Math.max(0, (k - 0.42) / 0.58), 1.5)
      p.sprite.material.opacity = 0.92 * fadeIn * fadeOut
    }
  }

  return {
    object: group,
    update,
    count: POOL,
    setColor: (c) => {
      for (const p of puffs) p.sprite.material.color.set(c)
    },
    reset: (origin) => {
      for (const p of puffs) {
        p.age = 0
        p.life = 0
        p.sprite.visible = false
        p.sprite.material.opacity = 0
      }
      prime(origin, new THREE.Vector3(1, 0, 0))
    },
  }
}
