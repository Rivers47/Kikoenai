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

    <q-dialog v-model="preview_img" full-width>
      <q-card v-if="preview_img_list.length">
        <q-card-section>
          <div class="row items-center no-wrap">
            <div class="col">
              <div class="text-h6">{{preview_img_name}}</div>
              <div class="text-subtitle2">{{ preview_img_idx+1 }}/{{ preview_img_list.length }}</div>
            </div>
            <div v-if="playWorkId > 0" class="col-auto">
              <q-btn outline @click="setVisualPlayerCover(preview_img_list[preview_img_idx])">{{ $t('worktree.setAsCover') }}</q-btn>
            </div>
          </div>
        </q-card-section>

        <q-card-section class="q-pt-none">
          <q-img style="height: calc(100vh - 200pt);" :src="preview_img_url" fit="contain" />
        </q-card-section>

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
            <q-item-label class="text-subtitle1">{{ item.title }}</q-item-label>
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
import { basenameWithoutExt } from 'src/utils'
import { formatSeconds } from '../utils'
import NotifyMixin from '../mixins/Notification.js'

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
          queue.push(item)
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
      } else if (item.type === 'text' || item.type === 'image') {
        this.openFile(item);
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

    openFile (file) {
      // Fallback to old API for an old backend
      const url = file.mediaStreamUrl ? `${file.mediaStreamUrl}` : `/api/media/stream/${file.trackId || file.hash}`;
      const link = document.createElement('a');
      link.href = url;
      link.target="_blank";
      link.click();
    },

    originalImgSrc (file) {
      // Fallback to old API for an old backend
      const url = file.mediaStreamUrl ? `${file.mediaStreamUrl}` : `/api/media/stream/${file.trackId || file.hash}`;
      return url
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
    },

    changePreviewImg(next) {
      if (this.preview_img_list.length <= 1) return;
      const length = this.preview_img_list.length;
      this.preview_img_idx = (length +this.preview_img_idx + (next ? 1 : -1) ) % length;
    },

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
