<template>
  <div id="work-tree" class="q-ma-md " style="">
    <q-breadcrumbs gutter="xs" v-if="path.length">
      <q-breadcrumbs-el   >
        <q-btn no-caps flat dense size="md" icon="folder" @click="goToPath([])">{{ $t('worktree.root') }}</q-btn>
      </q-breadcrumbs-el>
      
      <q-breadcrumbs-el v-for="(folderName, index) in path"  :key="index"  class="cursor-pointer" >
        <q-btn no-caps flat dense size="md" icon="folder" @click="onClickBreadcrumb(index)">{{folderName}}</q-btn>
      </q-breadcrumbs-el>
    </q-breadcrumbs>

    <ImageViewer
      v-model="preview_img"
      :images="previewImages"
      :index="preview_img_idx"
      @update:index="goToPreviewIndex"
    >
      <template v-slot:actions>
        <q-btn
          v-if="playWorkId > 0"
          outline
          dense
          @click="setVisualPlayerCover(preview_img_list[preview_img_idx])"
        >{{ $t('worktree.setAsCover') }}</q-btn>
      </template>
    </ImageViewer>

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
import ImageViewer from './ImageViewer'
import { apiUrl } from 'src/base-path'

export default {
  name: 'WorkTree',
  mixins: [NotifyMixin],

  components: {
    ImageViewer,
  },

  data() {
    return {
      internalTree: [],
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
    queryPath () {
      return (this.$route.query.path || '').split('/').filter(Boolean)
    },

    // Resolve the query path against the tree, stopping at the first segment
    // that does not exist.
    resolved () {
      const path = []
      let fatherFolder = this.internalTree
      for (const folderName of this.queryPath) {
        const folder = fatherFolder.find(item => item.type === 'folder' && item.title === folderName)
        if (!folder) break
        path.push(folderName)
        fatherFolder = folder.children
      }
      return { path, fatherFolder }
    },

    path () {
      return this.resolved.path
    },

    fatherFolder () {
      return this.resolved.fatherFolder
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

    preview_img_list () {
      return this.fatherFolder.filter(item => item.type === 'image')
    },

    preview_img_idx () {
      return this.preview_img_list.findIndex(item => item.title === this.$route.query.img)
    },

    preview_img: {
      get () {
        return this.preview_img_idx >= 0
      },
      set (value) {
        // Only ever set to false, by the dialog closing itself (Esc, backdrop,
        // the close button). A close driven by the route emits nothing.
        if (!value) {
          this.closePreviewImg()
        }
      }
    },

    previewImages () {
      return this.preview_img_list.map(item => ({ name: item.title, url: this.originalImgSrc(item) }))
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
      if (this.$route.query.path) {
        return
      }
      const initialPath = []
      let fatherFolder = this.internalTree.concat()
      while (fatherFolder.length === 1) {
        if (fatherFolder[0].type === 'audio') {
          break
        }
        initialPath.push(fatherFolder[0].title)
        fatherFolder = fatherFolder[0].children
      }
      if (initialPath.length) {
        this.goToPath(initialPath, true)
      }
    },

    goToPath (path, replace) {
      const query = { ...this.$route.query }
      // Leaving the folder closes whatever image was open in it.
      delete query.img
      if (path.length) {
        query.path = path.join('/')
      } else {
        delete query.path
      }
      if (query.path === this.$route.query.path && query.img === this.$route.query.img) {
        return
      }
      const location = { query, hash: '#work-tree' }
      replace ? this.$router.replace(location) : this.$router.push(location)
    },

    onClickBreadcrumb (index) {
      this.goToPath(this.path.slice(0, index + 1))
    },

    onClickItem (item) {
      if (item.type === 'folder') {
        this.goToPath(this.path.concat(item.title));
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
      const url = file.mediaDownloadUrl ? `${file.mediaDownloadUrl}` : apiUrl(`/api/media/download/${file.trackId || file.hash}`);
      const link = document.createElement('a');
      link.href = url;
      link.target="_blank";
      link.click();
    },

    setVisualPlayerCover (imgFile) {
      if (!imgFile) return;
      const urlWithoutToken = imgFile.mediaDownloadUrl ? `${imgFile.mediaDownloadUrl}` : apiUrl(`/api/media/download/${imgFile.trackId || imgFile.hash}`);
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
      const url = file.mediaStreamUrl ? `${file.mediaStreamUrl}` : apiUrl(`/api/media/stream/${file.trackId || file.hash}`);
      return url
    },

    openPreviewImg(item) {
      this.previewPushed = true;
      this.goToImg(item.title);
    },

    goToPreviewIndex(index) {
      const item = this.preview_img_list[index];
      if (item) this.goToImg(item.title, true);
    },

    closePreviewImg() {
      if (this.previewPushed) {
        this.previewPushed = false;
        this.$router.back();
      } else {
        // Opened from a pasted link: there is no entry of ours to pop.
        this.goToImg(null, true);
      }
    },

    goToImg (title, replace) {
      const query = { ...this.$route.query };
      if (title) {
        query.img = title;
      } else {
        delete query.img;
      }
      const location = { query, hash: '#work-tree' };
      replace ? this.$router.replace(location) : this.$router.push(location);
    },

  },

  created() {
    this.previewPushed = false;
  },

  mounted() {
    this.internalTree = this.tree;
  }
}
</script>

<style scoped>
/* ponytail: Quasar forces a grey on .q-item__section--side, which overrides the
   active item's text-on-primary. Inherit only on the active item so the normal
   grey side text is preserved. */
.text-on-primary .q-item__section--side {
  color: inherit;
}
</style>
