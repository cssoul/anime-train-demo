<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef, computed } from 'vue'
import { createScene, type SceneHandle, type Stats } from './three/scene'
import { CAMERA_PRESETS, RENDER, TIME_PRESETS, type CameraPresetKey, type TimePreset } from './three/config'

const canvasHost = ref<HTMLElement | null>(null)
const sceneHandle = shallowRef<SceneHandle | null>(null)

const booting = ref(true)
const scale = ref(1)
const stats = ref<Stats>({ fps: 0, frameMs: 0, calls: 0, triangles: 0, resolution: '1920×1080' })

const playing = ref(true)
const speed = ref(1)
const timePreset = ref<TimePreset>('noon')
const camPreset = ref<CameraPresetKey>('hero')
const follow = ref(false)
const autoFrame = ref(true)
const resScale = ref(1)

const timeKeys = Object.keys(TIME_PRESETS) as TimePreset[]
const camKeys = Object.keys(CAMERA_PRESETS) as CameraPresetKey[]
const resOptions = [
  { label: '1080p', value: 1 },
  { label: '810p', value: 0.75 },
  { label: '720p', value: 0.6 },
]

const fpsTone = computed(() => (stats.value.fps >= 50 ? 'good' : stats.value.fps >= 35 ? 'ok' : 'bad'))

function fit() {
  scale.value = Math.min(window.innerWidth / RENDER.width, window.innerHeight / RENDER.height)
}

function togglePlay() {
  playing.value = !playing.value
  sceneHandle.value?.setPlaying(playing.value)
}

function pickTime(k: TimePreset) {
  timePreset.value = k
  sceneHandle.value?.setTime(k)
}

function pickCam(k: CameraPresetKey) {
  // 机位预设本身就是"相对列车的偏移"，所以切预设仍然是跟拍状态
  camPreset.value = k
  follow.value = false
  autoFrame.value = true
  sceneHandle.value?.setFollow(false)
  sceneHandle.value?.setCameraPreset(k)
}

function toggleFollow() {
  follow.value = !follow.value
  if (follow.value) autoFrame.value = true
  sceneHandle.value?.setFollow(follow.value)
}

function toggleAutoFrame() {
  autoFrame.value = !autoFrame.value
  if (autoFrame.value) {
    follow.value = false
    sceneHandle.value?.setFollow(false)
  }
  sceneHandle.value?.setAutoFrame(autoFrame.value)
}

function pickRes(v: number) {
  resScale.value = v
  sceneHandle.value?.setResolutionScale(v)
}

function onSpeed(e: Event) {
  speed.value = Number((e.target as HTMLInputElement).value)
  sceneHandle.value?.setSpeed(speed.value)
}

function onKey(e: KeyboardEvent) {
  if (e.code === 'Space') {
    e.preventDefault()
    togglePlay()
  } else if (e.key === 'f' || e.key === 'F') {
    toggleFollow()
  } else if (e.key === 'a' || e.key === 'A') {
    toggleAutoFrame()
  }
}

onMounted(() => {
  fit()
  window.addEventListener('resize', fit)
  window.addEventListener('keydown', onKey)

  // 让浏览器先把加载态画出来，再做重活儿
  requestAnimationFrame(() => {
    if (!canvasHost.value) return
    sceneHandle.value = createScene(canvasHost.value, {
      onStats: (s) => {
        stats.value = s
      },
      onAutoFrame: (on) => {
        autoFrame.value = on
      },
    })
    booting.value = false
  })
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', fit)
  window.removeEventListener('keydown', onKey)
  sceneHandle.value?.dispose()
})
</script>

<template>
  <div class="viewport">
    <div class="stage" :style="{ transform: `scale(${scale})` }">
      <div ref="canvasHost" class="canvas-host"></div>

      <div class="overlay">
        <div class="card card-title">
          <h1>环湖小火车</h1>
          <div class="sub">
            日本动漫卡通风 · Three.js 赛璐璐渲染 · 环湖长堤数字微缩场景
          </div>
          <div class="meta">
            <span
              >渲染 <b>{{ stats.resolution }}</b></span
            >
            <span
              >FPS <b :class="`fps-${fpsTone}`">{{ stats.fps.toFixed(0) }}</b></span
            >
            <span
              >帧时 <b>{{ stats.frameMs.toFixed(1) }}ms</b></span
            >
            <span
              >Draw Call <b>{{ stats.calls }}</b></span
            >
            <span
              >三角面 <b>{{ (stats.triangles / 1000).toFixed(0) }}k</b></span
            >
          </div>
        </div>

        <div class="card card-controls">
          <div class="row">
            <span class="row-label">运行</span>
            <div class="group">
              <button class="chip play" :class="{ active: playing }" @click="togglePlay">
                {{ playing ? '暂停' : '播放' }}
              </button>
              <button class="chip" :class="{ active: autoFrame }" @click="toggleAutoFrame">
                自动取景
              </button>
              <button class="chip" :class="{ active: follow }" @click="toggleFollow">
                贴近跟拍
              </button>
            </div>
          </div>

          <div class="row">
            <span class="row-label">速度</span>
            <input
              type="range"
              min="0.1"
              max="3"
              step="0.1"
              :value="speed"
              @input="onSpeed"
            />
            <span class="speed-value">{{ speed.toFixed(1) }}×</span>
          </div>

          <div class="row">
            <span class="row-label">时段</span>
            <div class="group">
              <button
                v-for="k in timeKeys"
                :key="k"
                class="chip"
                :class="{ active: timePreset === k }"
                @click="pickTime(k)"
              >
                {{ TIME_PRESETS[k].label }}
              </button>
            </div>
          </div>

          <div class="row">
            <span class="row-label">机位</span>
            <div class="group">
              <button
                v-for="k in camKeys"
                :key="k"
                class="chip"
                :class="{ active: camPreset === k && !follow }"
                @click="pickCam(k)"
              >
                {{ CAMERA_PRESETS[k].label }}
              </button>
            </div>
          </div>

          <div class="row">
            <span class="row-label">画质</span>
            <div class="group">
              <button
                v-for="r in resOptions"
                :key="r.label"
                class="chip"
                :class="{ active: resScale === r.value }"
                @click="pickRes(r.value)"
              >
                {{ r.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="card card-hint">
          鼠标左键拖拽旋转 · 滚轮缩放 · 右键平移<br />
          <kbd>Space</kbd> 播放/暂停 · <kbd>F</kbd> 贴近跟拍 · <kbd>A</kbd> 自动跟拍
        </div>
      </div>

      <div v-if="booting" class="booting">
        <div>正在生成湖上铁道场景…</div>
        <div class="bar"><i></i></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.fps-good {
  color: #2f8f3e;
}
.fps-ok {
  color: #d18a1a;
}
.fps-bad {
  color: #c0392b;
}
</style>
