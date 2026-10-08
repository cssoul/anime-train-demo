import * as THREE from 'three'
import { PALETTE } from './config'
import { PolyDist, WATERLINE_HALF } from './track'

export interface WaterHandle {
  mesh: THREE.Mesh
  material: THREE.ShaderMaterial
  update: (t: number) => void
}

const vertexShader = /* glsl */ `
attribute float aShore;
varying float vShore;
varying vec3 vWorld;
void main() {
  vShore = aShore;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

const fragmentShader = /* glsl */ `
precision highp float;

uniform float uTime;
uniform vec3  uShallow;
uniform vec3  uMid;
uniform vec3  uDeep;
uniform vec3  uAbyss;
uniform vec3  uFoam;
uniform vec3  uTint;
uniform float uGain;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uFogColor;
uniform float uFogDensity;

varying float vShore;
varying vec3  vWorld;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 p = vWorld.xz;
  float d = max(vShore, 0.0);

  /* ---- 水深：以"近岸浅 → 湖心深"的平滑大梯度为主 ----
     早期版本用噪声场分级，结果湖面变成一块块迷彩；参考图其实是很干净的
     浅绿松石 → 中青 → 深蓝 的三段过渡，只有很淡的大尺度色差。 */
  float f1 = vnoise(p * 0.0105);
  float f2 = vnoise(p * 0.0290 + 11.3);

  // 环路内部到岸线的最大距离只有 ~88m，梯度必须按这个尺度给，
  // 否则整片湖都停在"浅水"那一档，永远看不到深蓝。
  vec3 col = mix(uShallow, uMid, smoothstep(1.2, 13.0, d));
  col = mix(col, uDeep, smoothstep(12.0, 46.0, d) * 0.94);
  col = mix(col, uAbyss, smoothstep(40.0, 96.0, d));

  // 极淡的大尺度色差，破掉"同心圆"感
  float mottle = f1 * 0.62 + f2 * 0.38;
  col *= 0.955 + mottle * 0.09;

  /* ---- 波纹：细而密的水纹线，取多组正弦的零交点 ---- */
  // 只留两组低频正弦：加第三组高频会让水面变成一片麻点，而不是"线"
  float n1 = vnoise(p * 0.11 + vec2(uTime * 0.055, uTime * 0.03));
  float n2 = vnoise(p * 0.23 - vec2(uTime * 0.07, uTime * 0.04));
  float w1 = sin(p.x * 1.15 + p.y * 0.72 + uTime * 0.85 + n1 * 6.5);
  float w2 = sin(p.x * -0.68 + p.y * 1.32 + uTime * 0.68 + n2 * 7.5);
  float s = w1 * 0.58 + w2 * 0.42;
  float ridge = 1.0 - smoothstep(0.0, 0.11, abs(s));

  // 远处波纹收住，否则整片湖会变成一张网
  float ridgeFade = 1.0 - smoothstep(30.0, 110.0, d);
  // 成片地出现/消失，比均匀铺满更像手绘
  float ridgeMask = smoothstep(0.30, 0.80, vnoise(p * 0.030 + 21.0));
  col = mix(col, uFoam, ridge * ridgeFade * (0.05 + ridgeMask * 0.19));

  /* ---- 岸边浅水提亮 + 一圈细浪花 ---- */
  float shallow = 1.0 - smoothstep(0.0, 26.0, d);
  col = mix(col, uShallow * 1.08, shallow * 0.26);

  float foamBand = (1.0 - smoothstep(0.0, 2.6, d)) * smoothstep(0.0, 0.9, d);
  float foamWobble = 0.45 + 0.55 * vnoise(p * 0.7 + uTime * 0.2);
  col = mix(col, uFoam, clamp(foamBand * foamWobble, 0.0, 1.0) * 0.55);

  /* ---- 太阳碎光：只在朝向太阳的方向出现 ---- */
  // 碎光收敛：高频噪声点会变成"沙粒噪点"，改成低频 + 只在朝阳方向出现
  vec3 viewDir = normalize(vWorld - cameraPosition);
  float glint = vnoise(p * 0.55 + uTime * 0.22);
  float sparkle = smoothstep(0.86, 1.0, glint);
  float sunFacing = max(0.0, dot(normalize(-viewDir), normalize(uSunDir)) * 0.5 + 0.5);
  col += uSunColor * sparkle * pow(sunFacing, 6.0) * 0.22;

  /* ---- 调色（四时预设）---- */
  col = mix(col, col * uTint, 0.55) * uGain;

  /* ---- 手写雾（ShaderMaterial 不会自动接 scene.fog）---- */
  float dist = length(vWorld - cameraPosition);
  float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogFactor, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`

export function buildWater(polyDist: PolyDist, size = 900, segments = 200): WaterHandle {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments)
  geo.rotateX(-Math.PI / 2)

  const pos = geo.getAttribute('position') as THREE.BufferAttribute
  const shore = new Float32Array(pos.count)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    // 到长堤中心线的距离减去长堤半宽 = 到岸线的距离
    shore[i] = Math.max(0, polyDist.distance(x, z) - WATERLINE_HALF)
  }
  geo.setAttribute('aShore', new THREE.BufferAttribute(shore, 1))
  geo.deleteAttribute('uv')

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uShallow: { value: new THREE.Color(PALETTE.waterShallow) },
      uMid: { value: new THREE.Color(PALETTE.waterMid) },
      uDeep: { value: new THREE.Color(PALETTE.waterDeep) },
      uAbyss: { value: new THREE.Color(PALETTE.waterAbyss) },
      uFoam: { value: new THREE.Color(PALETTE.foam) },
      uTint: { value: new THREE.Color('#ffffff') },
      uGain: { value: 1 },
      uSunDir: { value: new THREE.Vector3(0.5, 0.75, 0.42).normalize() },
      uSunColor: { value: new THREE.Color('#fff6e2') },
      uFogColor: { value: new THREE.Color('#cfeeff') },
      uFogDensity: { value: 0.0016 },
    },
    vertexShader,
    fragmentShader,
    side: THREE.FrontSide,
  })

  const mesh = new THREE.Mesh(geo, material)
  mesh.name = 'water'
  mesh.receiveShadow = false
  mesh.castShadow = false
  // 水面自己不参与阴影，但需要被雾影响 —— 雾在手写 shader 里处理
  mesh.renderOrder = -10

  return {
    mesh,
    material,
    update: (t: number) => {
      material.uniforms.uTime.value = t
    },
  }
}
