<template>
  <q-dialog :model-value="modelValue" @update:model-value="$emit('update:modelValue', $event)" maximized no-route-dismiss>
    <q-card v-if="images.length" class="column no-wrap">
      <q-card-section class="q-py-sm">
        <div class="row items-center no-wrap">
          <div class="col">
            <div class="text-subtitle1 ellipsis">{{ current.name }}</div>
            <div class="text-caption">{{ index + 1 }}/{{ images.length }}</div>
          </div>
          <div class="col-auto">
            <slot name="actions" :image="current" />
          </div>
        </div>
      </q-card-section>

      <!-- Pinch/pan happens here: the app-wide viewport meta disables browser
           zoom, so the gesture is handled with pointer events + a transform. -->
      <div
        class="col zoom-area"
        ref="zoomArea"
        @pointerdown="onZoomPointerDown"
        @pointermove="onZoomPointerMove"
        @pointerup="onZoomPointerUp"
        @pointercancel="onZoomPointerUp"
        @wheel.prevent="onZoomWheel"
        @dblclick="onZoomDoubleClick"
      >
        <img
          class="preview-img"
          :class="{ 'preview-img--animated': !gesturing }"
          :src="current.url"
          :style="imgStyle"
          draggable="false"
          @load="resetZoom"
        >
      </div>

      <q-card-actions align="around">
        <q-btn flat :label="$t('common.previous')" color="primary" @click="step(-1)" />
        <q-btn flat :label="$t('common.close')" color="negative" v-close-popup />
        <q-btn flat :label="$t('common.next')" color="primary" @click="step(1)" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<script>
const MAX_ZOOM = 8
const DOUBLE_TAP_ZOOM = 2.5

export default {
  name: 'ImageViewer',

  props: {
    modelValue: {
      type: Boolean,
      default: false
    },

    // [{ name, url }] — url is what gets loaded, name is the caption.
    images: {
      type: Array,
      required: true
    },

    index: {
      type: Number,
      default: 0
    },
  },

  emits: ['update:modelValue', 'update:index'],

  data() {
    return {
      // translate(tx, ty) scale(scale), transform-origin at the element's centre.
      scale: 1,
      tx: 0,
      ty: 0,
      gesturing: false,
    }
  },

  computed: {
    current() {
      return this.images[this.index] || { name: '', url: '' }
    },

    imgStyle() {
      return {
        transform: `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`,
        cursor: this.scale > 1 ? 'grab' : 'auto'
      }
    }
  },

  watch: {
    index() {
      this.resetZoom()
    }
  },

  created() {
    // Gesture bookkeeping — deliberately not in data(), nothing renders from it.
    this.zoomPointers = new Map()
    this.pinchDist = 0
    this.gestureMoved = false
    this.lastTapTime = 0
  },

  methods: {
    step(delta) {
      const length = this.images.length
      if (length <= 1) return
      this.$emit('update:index', (length + this.index + delta) % length)
    },

    resetZoom() {
      this.scale = 1
      this.tx = 0
      this.ty = 0
    },

    // Size the image actually occupies at scale 1 (it is object-fit: contain),
    // plus the container size — both needed to bound panning.
    displayedImgSize() {
      const el = this.$refs.zoomArea
      const img = el && el.querySelector('img')
      if (!img || !img.naturalWidth) return null
      const cw = el.clientWidth
      const ch = el.clientHeight
      const fit = Math.min(cw / img.naturalWidth, ch / img.naturalHeight)
      return { cw, ch, w: img.naturalWidth * fit, h: img.naturalHeight * fit }
    },

    // Never let the image be dragged past its own edges.
    clampTranslation() {
      const size = this.displayedImgSize()
      if (!size) return
      const maxX = Math.max(0, (size.w * this.scale - size.cw) / 2)
      const maxY = Math.max(0, (size.h * this.scale - size.ch) / 2)
      this.tx = Math.min(maxX, Math.max(-maxX, this.tx))
      this.ty = Math.min(maxY, Math.max(-maxY, this.ty))
    },

    // Zoom to `scale` keeping whatever is under `focal` (client coords) put.
    zoomTo(scale, focal) {
      const el = this.$refs.zoomArea
      if (!el) return
      const rect = el.getBoundingClientRect()
      const next = Math.min(MAX_ZOOM, Math.max(1, scale))
      // Focal point relative to the container centre (the transform origin).
      const fx = focal.x - (rect.left + rect.width / 2)
      const fy = focal.y - (rect.top + rect.height / 2)
      // Point of the untransformed image currently sitting under the focal.
      const qx = (fx - this.tx) / this.scale
      const qy = (fy - this.ty) / this.scale
      this.scale = next
      this.tx = fx - next * qx
      this.ty = fy - next * qy
      this.clampTranslation()
    },

    onZoomPointerDown(evt) {
      if (this.zoomPointers.size === 0) this.gestureMoved = false
      this.zoomPointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY })
      this.pinchDist = 0
      this.gesturing = true
      evt.currentTarget.setPointerCapture(evt.pointerId)
    },

    onZoomPointerMove(evt) {
      const prev = this.zoomPointers.get(evt.pointerId)
      if (!prev) return
      const cur = { x: evt.clientX, y: evt.clientY }
      this.zoomPointers.set(evt.pointerId, cur)
      if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 2) this.gestureMoved = true

      const points = Array.from(this.zoomPointers.values())
      if (points.length >= 2) {
        const [a, b] = points
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        // First move of a pinch only establishes the baseline distance.
        if (this.pinchDist) {
          this.zoomTo(this.scale * (dist / this.pinchDist), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
        }
        this.pinchDist = dist
      } else if (this.scale > 1) {
        this.tx += cur.x - prev.x
        this.ty += cur.y - prev.y
        this.clampTranslation()
      }
    },

    onZoomPointerUp(evt) {
      this.zoomPointers.delete(evt.pointerId)
      this.pinchDist = 0
      if (this.zoomPointers.size > 0) return

      this.gesturing = false
      // Touch double-tap. A plain dblclick is not reliably synthesized while
      // touch-action is none, so tapping is timed here.
      if (evt.pointerType === 'touch' && !this.gestureMoved) {
        const now = Date.now()
        if (now - this.lastTapTime < 300) {
          this.lastTapTime = 0
          this.toggleZoom({ x: evt.clientX, y: evt.clientY })
        } else {
          this.lastTapTime = now
        }
      }
    },

    onZoomWheel(evt) {
      this.zoomTo(this.scale * (evt.deltaY < 0 ? 1.15 : 1 / 1.15), { x: evt.clientX, y: evt.clientY })
    },

    onZoomDoubleClick(evt) {
      this.toggleZoom({ x: evt.clientX, y: evt.clientY })
    },

    toggleZoom(focal) {
      if (this.scale > 1) {
        this.resetZoom()
      } else {
        this.zoomTo(DOUBLE_TAP_ZOOM, focal)
      }
    },
  }
}
</script>

<style scoped>
/* touch-action: none is what lets the pinch handlers see both pointers instead
   of the browser swallowing the gesture as a scroll. min-height: 0 keeps this
   flex child from overflowing the maximized card. */
.zoom-area {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
  touch-action: none;
  user-select: none;
}

.preview-img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  transform-origin: center center;
  will-change: transform;
}

/* Animate programmatic zoom (double tap, wheel), never a live finger drag. */
.preview-img--animated {
  transition: transform 0.15s ease-out;
}
</style>
