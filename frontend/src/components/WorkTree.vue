<template>
  <div class="q-ma-md " style="">
    <q-breadcrumbs gutter="xs" v-if="path.length">
      <q-breadcrumbs-el   >
        <q-btn no-caps flat dense size="md" icon="folder" @click="path = []">{{ $t('worktree.root') }}</q-btn>
      </q-breadcrumbs-el>
      
      <q-breadcrumbs-el v-for="(folderName, index) in path"  :key="index"  class="cursor-pointer" >
        <q-btn no-caps flat dense size="md" icon="folder" @click="onClickBreadcrumb(index)">{{folderName}}</q-btn>
      </q-breadcrumbs-el>
    </q-breadcrumbs>

    <q-dialog v-model="preview_img" maximized>
      <q-card v-if="preview_img_list.length" class="column no-wrap">
        <q-card-section class="q-py-sm">
          <div class="row items-center no-wrap">
            <div class="col">
              <div class="text-subtitle1 ellipsis">{{preview_img_name}}</div>
              <div class="text-caption">{{ preview_img_idx+1 }}/{{ preview_img_list.length }}</div>
            </div>
            <div v-if="playWorkId > 0" class="col-auto">
              <q-btn outline dense @click="setVisualPlayerCover(preview_img_list[preview_img_idx])">{{ $t('worktree.setAsCover') }}</q-btn>
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
            :class="{ 'preview-img--animated': !img_gesturing }"
            :src="preview_img_url"
            :style="previewImgStyle"
            draggable="false"
            @load="resetZoom"
          >
        </div>

        <q-card-actions align="around">
          <q-btn flat :label="$t('worktree.previous')" color="primary" @click="changePreviewImg(false)" />
          <q-btn flat :label="$t('common.close')" color="negative" v-close-popup />
          <q-btn flat :label="$t('worktree.next')" color="primary" @click="changePreviewImg(true)" />
        </q-card-actions>
      </q-card>
    </q-dialog>

    <q-card>
      <q-list separator>
        <q-item
          clickable
          v-ripple
          v-for="item in fatherFolder"
          :key="item.trackId || item.hash"
          :active="item.type === 'audio' && (currentPlayingFile.trackId || currentPlayingFile.hash) === item.trackId"
          active-class="text-on-primary bg-primary"
          @click="onClickItem(item)"
          class="non-selectable"
        >
          <q-item-section avatar style="position: relative;">
            <q-icon size="34px" v-if="item.type === 'folder'" color="info" name="folder" />
            <q-icon size="34px" v-else-if="item.type === 'text'" color="info" name="description" />
            <q-icon size="34px" v-else-if="item.type === 'image'" color="accent" name="photo" />
            <q-icon size="34px" v-else-if="item.type === 'other'" color="info" name="description" />
            <q-btn v-else round dense color="primary" :icon="playIcon(item.trackId || item.hash)" @click="onClickPlayButton(item.trackId || item.hash)" />

          </q-item-section>

          <q-item-section>
            <!-- trackTitle is the scraped track name, only present on audio files
                 whose titles have been filled in; title is always the filename. -->
            <q-item-label class="text-subtitle1">{{ item.trackTitle || item.title }}</q-item-label>
            <q-item-label v-if="item.trackTitle" caption lines="1">{{ item.title }}</q-item-label>
            <q-item-label v-if="item.children" caption lines="1">{{ $t('worktree.items', { count: item.children.length }) }}</q-item-label>
          </q-item-section>

          <!--音频文件时长 + 已保存的播放进度-->
          <q-item-section side v-if="item.type === 'audio' && typeof(item.duration) === 'number'">
            <q-item-label>
              <template v-if="savedPosition(item) > 0">
                {{ formatSeconds(savedPosition(item)) }}
                <span class="q-mx-xs">/</span>
              </template>
              {{ formatSeconds(item.duration) }}
            </q-item-label>
          </q-item-section>

          <!-- 上下文菜单 -->
          <q-menu
            v-if="item.type === 'audio' || item.type === 'text' || item.type === 'image' || item.type === 'other'"
            touch-position
            context-menu
            auto-close
            transition-show="jump-down"
            transition-hide="jump-up"
          >
            <q-list separator>
              <q-item clickable @click="addToQueue(item)" v-if="item.type === 'audio'">
                <q-item-section>{{ $t('worktree.addToQueue') }}</q-item-section>
              </q-item>

              <q-item clickable @click="playNext(item)" v-if="item.type === 'audio'">
                <q-item-section>{{ $t('worktree.playNext') }}</q-item-section>
              </q-item>

              <q-item clickable @click="download(item)">
                <q-item-section>{{ $t('worktree.download') }}</q-item-section>
              </q-item>


            </q-list>
          </q-menu>
        </q-item>
      </q-list>
    </q-card>
  </div>
</template>

<script>
import { mapState, mapGetters } from 'vuex'
import { basenameWithoutExt, toQueueItem } from 'src/utils'
import { formatSeconds } from '../utils'
import NotifyMixin from '../mixins/Notification.js'

const MAX_ZOOM = 8
const DOUBLE_TAP_ZOOM = 2.5

export default {
  name: 'WorkTree',
  mixins: [NotifyMixin],

  data() {
    return {
      path: [],
      internalTree: [],
      preview_img: false,
      preview_img_idx: 0,
      preview_img_list: [],
      preview_img_hash: "",
      // Image viewer transform: translate(img_tx, img_ty) scale(img_scale),
      // transform-origin at the element's centre.
      img_scale: 1,
      img_tx: 0,
      img_ty: 0,
      img_gesturing: false,
    }
  },

  props: {
    tree: {
      type: Array,
      required: true,
    },
    metadata: {
      type: Object,
      required: true,
    },
    trackProgress: {
      type: Object,
      default: () => ({}),
    }
  },

  watch: {
    tree (value) {
      this.internalTree = value;
      this.initPath();
    }
  },

  computed: {
    fatherFolder () {
      let fatherFolder = this.internalTree.concat()
      this.path.forEach(folderName => {
        fatherFolder = fatherFolder.find(item => item.type === 'folder' && item.title === folderName).children
      })

      return fatherFolder
    },

    queue () {
      const queue = []
      this.fatherFolder.forEach(item => {
        if (item.type === 'audio') {
          // Project rather than pushing the whole tree node: this queue is
          // serialized into every PUT /api/history body. See toQueueItem.
          queue.push(toQueueItem(item))
        }
      })

      return queue
    },

    preview_img_url () {
      const item = this.preview_img_list[this.preview_img_idx];
      return item ? this.originalImgSrc(item) : "";
    },

    preview_img_name () {
      const item = this.preview_img_list[this.preview_img_idx];
      return item ? item.title : "";
    },

    previewImgStyle () {
      return {
        transform: `translate(${this.img_tx}px, ${this.img_ty}px) scale(${this.img_scale})`,
        cursor: this.img_scale > 1 ? 'grab' : 'auto'
      }
    },

    ...mapState('AudioPlayer', [
      'playing',
      'playWorkId',
    ]),

    ...mapGetters('AudioPlayer', [
      'currentPlayingFile'
    ])
  },

  methods: {
    formatSeconds,

    // 该曲目已保存的播放进度（秒），无记录返回 0（Phase 2）
    savedPosition (item) {
      if (!item || !item.contentHash) return 0
      const rec = this.trackProgress[item.contentHash]
      return rec && typeof rec.seconds === 'number' ? rec.seconds : 0
    },

    playIcon (trackId) {
      const id = trackId || ''
      return this.playing && (this.currentPlayingFile.trackId || this.currentPlayingFile.hash) === id ? "pause" : "play_arrow"            
    },

    initPath () {
      const initialPath = []
      let fatherFolder = this.internalTree.concat()
      while (fatherFolder.length === 1) {
        if (fatherFolder[0].type === 'audio') {
          break
        }
        initialPath.push(fatherFolder[0].title)
        fatherFolder = fatherFolder[0].children
      }
      this.path = initialPath
    },
    
    onClickBreadcrumb (index) {
      this.path = this.path.slice(0, index+1)
    },

    onClickItem (item) {
      if (item.type === 'folder') {
        this.path.push(item.title);
      } else if (item.type === 'image') {
        this.openPreviewImg(item);
      } else if (item.type === 'text') {
        this.openTextPage(item);
      } else if (item.type === 'other') {
        this.download(item);
      } else if ((this.currentPlayingFile.trackId || this.currentPlayingFile.hash) !== item.trackId) {
        const resumeSeconds = this.trackProgress[item.contentHash];
        this.$store.commit('AudioPlayer/SET_QUEUE', {
          workId: this.metadata.id,
          vas: this.metadata.vas,
          queue: this.queue.concat(),
          index: this.queue.findIndex(file => (file.trackId || file.hash) === item.trackId),
          resetPlaying: true,
          resumeHistorySeconds: resumeSeconds ? resumeSeconds.seconds : -1,
          workLastTrackId: this.queue.length ? (this.queue[this.queue.length - 1].trackId || this.queue[this.queue.length - 1].hash) : ''
        })
      }
    },

    onClickPlayButton (trackId) {
      if ((this.currentPlayingFile.trackId || this.currentPlayingFile.hash) === trackId) {
        this.$store.commit('AudioPlayer/TOGGLE_PLAYING')
      } else {
        const item = this.fatherFolder.find(i => (i.trackId || i.hash) === trackId);
        const resumeSeconds = item && item.contentHash ? this.trackProgress[item.contentHash] : null;
        this.$store.commit('AudioPlayer/SET_QUEUE', {
          workId: this.metadata.id,
          vas: this.metadata.vas,
          queue: this.queue.concat(),
          index: this.queue.findIndex(file => (file.trackId || file.hash) === trackId),
          resetPlaying: true,
          resumeHistorySeconds: resumeSeconds ? resumeSeconds.seconds : -1,
          workLastTrackId: this.queue.length ? (this.queue[this.queue.length - 1].trackId || this.queue[this.queue.length - 1].hash) : ''
        })
      }
    },

    addToQueue (file) {
      this.$store.commit('AudioPlayer/ADD_TO_QUEUE', file)
    },

    playNext (file) {
      this.$store.commit('AudioPlayer/PLAY_NEXT', file)
    },

    download (file) {
      // Fallback to old API for an old backend
      const url = file.mediaDownloadUrl ? `${file.mediaDownloadUrl}` : `/api/media/download/${file.trackId || file.hash}`;
      const link = document.createElement('a');
      link.href = url;
      link.target="_blank";
      link.click();
    },

    setVisualPlayerCover (imgFile) {
      if (!imgFile) return;
      const urlWithoutToken = imgFile.mediaDownloadUrl ? `${imgFile.mediaDownloadUrl}` : `/api/media/download/${imgFile.trackId || imgFile.hash}`;
      this.$store.commit('AudioPlayer/SET_VISUAL_PLAYER_COVER_URL', urlWithoutToken);
      this.$q.notify({
        message: this.$t('worktree.coverSetSuccess'),
        actions: [
          { label: this.$t('worktree.goToFullScreen'),
            handler: () => {
              // this.$router.push(`/fullScreenPlayer/${this.playWorkId}`)
              this.$router.push(`/fullScreenPlayer`)
            }
          }
        ],
      });
    },

    // Show a text file on its own in-app page instead of navigating to the raw
    // file. A real navigation tears down the installed PWA: the SPA document
    // (and the audio element with it) is destroyed, so playback stops, and with
    // target="_blank" the new browsing context has a single history entry, so
    // Android's back button closes the app.
    openTextPage (file) {
      this.$router.push({
        path: `/text/${file.trackId || file.hash}`,
        query: { title: file.title }
      });
    },

    originalImgSrc (file) {
      // Fallback to old API for an old backend
      const url = file.mediaStreamUrl ? `${file.mediaStreamUrl}` : `/api/media/stream/${file.trackId || file.hash}`;
      return url
    },

    resetZoom () {
      this.img_scale = 1;
      this.img_tx = 0;
      this.img_ty = 0;
    },

    // Size the image actually occupies at scale 1 (it is object-fit: contain),
    // plus the container size — both needed to bound panning.
    displayedImgSize () {
      const el = this.$refs.zoomArea;
      const img = el && el.querySelector('img');
      if (!img || !img.naturalWidth) return null;
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      const fit = Math.min(cw / img.naturalWidth, ch / img.naturalHeight);
      return { cw, ch, w: img.naturalWidth * fit, h: img.naturalHeight * fit };
    },

    // Never let the image be dragged past its own edges.
    clampTranslation () {
      const size = this.displayedImgSize();
      if (!size) return;
      const maxX = Math.max(0, (size.w * this.img_scale - size.cw) / 2);
      const maxY = Math.max(0, (size.h * this.img_scale - size.ch) / 2);
      this.img_tx = Math.min(maxX, Math.max(-maxX, this.img_tx));
      this.img_ty = Math.min(maxY, Math.max(-maxY, this.img_ty));
    },

    // Zoom to `scale` keeping whatever is under `focal` (client coords) put.
    zoomTo (scale, focal) {
      const el = this.$refs.zoomArea;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const next = Math.min(MAX_ZOOM, Math.max(1, scale));
      // Focal point relative to the container centre (the transform origin).
      const fx = focal.x - (rect.left + rect.width / 2);
      const fy = focal.y - (rect.top + rect.height / 2);
      // Point of the untransformed image currently sitting under the focal.
      const qx = (fx - this.img_tx) / this.img_scale;
      const qy = (fy - this.img_ty) / this.img_scale;
      this.img_scale = next;
      this.img_tx = fx - next * qx;
      this.img_ty = fy - next * qy;
      this.clampTranslation();
    },

    onZoomPointerDown (evt) {
      if (this.zoomPointers.size === 0) this.gestureMoved = false;
      this.zoomPointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });
      this.pinchDist = 0;
      this.img_gesturing = true;
      evt.currentTarget.setPointerCapture(evt.pointerId);
    },

    onZoomPointerMove (evt) {
      const prev = this.zoomPointers.get(evt.pointerId);
      if (!prev) return;
      const cur = { x: evt.clientX, y: evt.clientY };
      this.zoomPointers.set(evt.pointerId, cur);
      if (Math.abs(cur.x - prev.x) + Math.abs(cur.y - prev.y) > 2) this.gestureMoved = true;

      const points = Array.from(this.zoomPointers.values());
      if (points.length >= 2) {
        const [a, b] = points;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        // First move of a pinch only establishes the baseline distance.
        if (this.pinchDist) {
          this.zoomTo(this.img_scale * (dist / this.pinchDist), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
        this.pinchDist = dist;
      } else if (this.img_scale > 1) {
        this.img_tx += cur.x - prev.x;
        this.img_ty += cur.y - prev.y;
        this.clampTranslation();
      }
    },

    onZoomPointerUp (evt) {
      this.zoomPointers.delete(evt.pointerId);
      this.pinchDist = 0;
      if (this.zoomPointers.size > 0) return;

      this.img_gesturing = false;
      // Touch double-tap. A plain dblclick is not reliably synthesized while
      // touch-action is none, so tapping is timed here.
      if (evt.pointerType === 'touch' && !this.gestureMoved) {
        const now = Date.now();
        if (now - this.lastTapTime < 300) {
          this.lastTapTime = 0;
          this.toggleZoom({ x: evt.clientX, y: evt.clientY });
        } else {
          this.lastTapTime = now;
        }
      }
    },

    onZoomWheel (evt) {
      this.zoomTo(this.img_scale * (evt.deltaY < 0 ? 1.15 : 1 / 1.15), { x: evt.clientX, y: evt.clientY });
    },

    onZoomDoubleClick (evt) {
      this.toggleZoom({ x: evt.clientX, y: evt.clientY });
    },

    toggleZoom (focal) {
      if (this.img_scale > 1) {
        this.resetZoom();
      } else {
        this.zoomTo(DOUBLE_TAP_ZOOM, focal);
      }
    },

    openPreviewImg(item) {
      const preview_img_list = this.fatherFolder.filter(item => item.type === 'image')
      let preview_img_idx = -1;
      preview_img_list.forEach((i, idx) => {
        if ((i.trackId || i.hash) === (item.trackId || item.hash)) {
          preview_img_idx = idx;
        }
      });
      this.preview_img = true;
      this.preview_img_list = preview_img_list;
      this.preview_img_idx = preview_img_idx;
      this.resetZoom();
    },

    changePreviewImg(next) {
      if (this.preview_img_list.length <= 1) return;
      const length = this.preview_img_list.length;
      this.preview_img_idx = (length +this.preview_img_idx + (next ? 1 : -1) ) % length;
      this.resetZoom();
    },

  },

  created() {
    // Gesture bookkeeping — deliberately not in data(), nothing renders from it.
    this.zoomPointers = new Map();
    this.pinchDist = 0;
    this.gestureMoved = false;
    this.lastTapTime = 0;
  },

  mounted() {
    this.internalTree = this.tree;
  }
}
</script>

<style scoped>
/* Image viewer. touch-action: none is what lets the pinch handlers see both
   pointers instead of the browser swallowing the gesture as a scroll.
   min-height: 0 keeps this flex child from overflowing the maximized card. */
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

/* ponytail: Quasar forces a grey on .q-item__section--side, which overrides the
   active item's text-on-primary. Inherit only on the active item so the normal
   grey side text is preserved. */
.text-on-primary .q-item__section--side {
  color: inherit;
}
</style>
