import * as THREE from 'three'
import { skyTexture } from './toon'
import type { TimeSettings } from './config'

export interface SkyHandle {
  mesh: THREE.Mesh
  apply: (s: TimeSettings) => void
  dispose: () => void
}

/**
 * 天空球：画好的垂直渐变 + 积云贴在一个巨大的反面球上。
 * 半径给得足够大（相机高度 100 量级），地平线就稳定落在 v=0.5 附近，
 * 不用每帧跟着相机跑。
 */
export function createSky(settings: TimeSettings): SkyHandle {
  const geo = new THREE.SphereGeometry(2600, 48, 32)

  const make = (s: TimeSettings) =>
    skyTexture({
      top: s.skyTop,
      mid: s.skyMid,
      horizon: s.skyHorizon,
      cloud: '#ffffff',
      cloudShade: '#c3d8e6',
    })

  let tex = make(settings)
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.name = 'sky'
  mesh.renderOrder = -100
  mesh.frustumCulled = false

  return {
    mesh,
    apply: (s: TimeSettings) => {
      const next = make(s)
      tex.dispose()
      tex = next
      mat.map = next
      mat.needsUpdate = true
    },
    dispose: () => {
      tex.dispose()
      geo.dispose()
      mat.dispose()
    },
  }
}
