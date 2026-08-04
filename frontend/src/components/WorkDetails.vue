<template>
  <div class="row">
      <CoverSFW 
        class="col q-ma-sm row justify-start shadow-4"
        :workid="metadata.id" 
        :nsfw="false" 
        :release="metadata.release" 
        style="border-radius: 8px; overflow: hidden;"
      />

    <div class="col-md-6 col-12 q-pa-sm">
      <div class="q-px-sm q-py-none">
        <!-- 标题 -->
        <div class="text-h6 text-weight-regular">
          <router-link :to="`/work/${metadata.id}`" class="text-primary">
            {{metadata.title}}
          </router-link>
        </div>

        <!-- 社团名 -->
        <div class="text-subtitle1 text-weight-regular">
          <router-link :to="`/works?circleId=${metadata.circle.id}`" class="text-muted">
            {{metadata.circle.name}}
          </router-link>
        </div>


        <!-- 评价&评论 -->
        <div class="row items-center q-gutter-xs">
          <!-- 评价 -->
          <div class="col-auto">
            <q-rating
              v-model="rating"
              @update:model-value="setRating"
              name="rating"
              size="sm"
              :color="userMarked ? 'rating-star' : 'primary'"
              icon="star_border"
              icon-selected="star"
              icon-half="star_half"
            />

            <!-- 评价分布明细 -->
            <q-tooltip v-if=metadata.rate_count_detail content-class="text-subtitle1">
              <div>平均: {{metadata.rate_average_2dp}}</div>
              <div v-for="(rate, index) in sortedRatings" :key=index class="row items-center">
                <div class="col"> {{rate.review_point}}星 </div>

                <!-- 评价占比 -->
                <q-linear-progress
                  :value="rate.ratio/100"
                  color="on-info-container"
                  track-color="info-container"
                  style="height: 15px; width: 100px"
                  class="col-auto"
                />

                <div class="col q-mx-sm"> ({{rate.count}}) </div>
              </div>
            </q-tooltip>
          </div>

          <div class="col-auto">
            <span class="text-weight-medium text-body1 text-negative">{{metadata.rate_average_2dp}}</span> <span class="text-muted"> ({{metadata.rate_count}})</span>
          </div>

          <!-- 评论数量 -->
          <div class="col-auto q-px-sm">
            <q-icon name="chat" size="xs" /> <span class="text-muted"> ({{metadata.review_count}})</span>
          </div>

          <!-- DLsite链接 -->
          <div class="col-auto">
            <q-icon name="launch" size="xs" /><a class="text-primary" :href="sourceLink" rel="noreferrer noopener" target="_blank">{{sourceLabel}}</a>
          </div>
        </div>
      </div>

      <!-- 价格&售出数 -->
      <div class="q-pt-sm q-pb-none">
        <span class="q-mx-sm text-weight-medium text-h6 text-negative">{{metadata.price}} 日元</span> 售出数: {{metadata.dl_count}}
      </div>

      <!-- 标签 -->
      <div class="q-px-none q-py-sm" v-if="showTags">
        <router-link
          v-for="(tag, index) in metadata.tags"
          :to="`/works?tagId=${tag.id}`"
          :key=index
        >
          <q-chip size="md" class="shadow-4">
            {{tag.name}}
          </q-chip>
        </router-link>
      </div>

      <!-- Voice Actor -->
      <div class="q-px-none q-pb-xs">
        <router-link
          v-for="(va, index) in metadata.vas"
          :to="`/works?vaId=${va.id}`"
          :key=index
        >
          <q-chip square size="md" class="shadow-4" color="tertiary-container" text-color="on-tertiary-container" icon="mic">
            {{va.name}}
          </q-chip>
        </router-link>
      </div>

      <!-- Illustrator -->
      <!-- <div class="q-px-none q-pb-xs" v-if="metadata.illustrators && metadata.illustrators.length > 0">
        <router-link
          v-for="(illustrator, index) in metadata.illustrators"
          :to="`/works?illustratorId=${illustrator.id}`"
          :key=index
        >
          <q-chip square size="md" class="shadow-4" color="tertiary-container" text-color="on-tertiary-container" icon="brush">
            {{illustrator.name}}
          </q-chip>
        </router-link>
      </div> -->

      <!-- Scriptwriter -->
      <div class="q-px-none q-pb-xs" v-if="metadata.scriptWriters && metadata.scriptWriters.length > 0">
        <router-link
          v-for="(sw, index) in metadata.scriptWriters"
          :to="`/works?scriptWriterId=${sw.id}`"
          :key=index
        >
          <q-chip square size="md" class="shadow-4" color="secondary-container" text-color="on-secondary-container" icon="edit">
            {{sw.name}}
          </q-chip>
        </router-link>
      </div>

      <!-- 系列 -->
      <div class="q-px-none q-pb-xs" v-if="metadata.series">
        <router-link :to="`/works?seriesId=${metadata.series.id}`">
          <q-chip square size="md" class="shadow-4" color="surface-container-highest" text-color="on-surface" icon="collections_bookmark">
            {{metadata.series.name}}
          </q-chip>
        </router-link>
      </div>

      <q-btn-dropdown
        dense
        class="q-mt-sm shadow-4 q-mx-xs q-px-md"
        style="min-width: 120px"
        color="primary"
        text-color="on-primary"
        :label="progressLabel"
      >
        <q-list bordered=false class="progress-menu">
          <q-item clickable @click="setProgress('marked')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'marked'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>想听</q-item-label>
            </q-item-section>
          </q-item>

          <q-item clickable @click="setProgress('listening')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'listening'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>在听</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable @click="setProgress('listened')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'listened'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>听过</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable @click="setProgress('replay')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'replay'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>重听</q-item-label>
            </q-item-section>
          </q-item>
          <q-item clickable @click="setProgress('postponed')">
            <q-item-section avatar>
              <q-icon name="headset" v-show="progress === 'postponed'" />
            </q-item-section>
            <q-item-section>
              <q-item-label>搁置</q-item-label>
            </q-item-section>
          </q-item>

          <q-separator />

          <q-item clickable @click="clearProgress" class="text-negative">
            <q-item-section avatar class="q-pa-none">
              <q-icon  name="remove_circle_outline" />
            </q-item-section>
            <q-item-section>
              <q-item-label>清除进度</q-item-label>
            </q-item-section>
          </q-item>
        </q-list>
      </q-btn-dropdown>

      <q-btn dense @click="showReviewDialog = true" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" label="写评论" />

      <div v-if="metadata.state" class="q-mt-sm q-px-sm">
        <div class="text-caption text-weight-medium text-on-surface-variant">上次播放记录</div>
        <div class="text-body2 text-secondary">
          <q-icon name="music_note" size="xs" class="q-mr-xs" />
          {{ currentHistoryTrack }}
        </div>
        <div class="text-caption text-on-surface0-variant">
          播放至 {{ formatSeconds(historySeconds) }}
        </div>
      </div>

      <q-btn v-if="metadata.state && playWorkId !== metadata.id" dense @click="resumeThisHistory" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" label="播放此作品的历史记录" />
      <q-btn v-if="metadata.state" dense @click="clearThisHistory" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" label="删除播放记录">
        <q-tooltip>当历史记录中有已被删除的音频文件，可能会无法正确播放文件，可通过此按钮解决</q-tooltip>
      </q-btn>


      <q-btn dense @click="scanWorkFile" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" label="扫描本地文件" />

      <q-btn v-if="isAdmin" dense @click="showEditDialog = true" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" label="编辑元数据" />

      <q-btn dense :loading="refreshMetadataLoading" @click="refreshMetadata" color="secondary q-mt-sm shadow-4 q-mx-xs q-px-sm" text-color="on-secondary" label="刷新元数据" />

      <WriteReview v-if="showReviewDialog" @closed="processReview" :workid="metadata.id" :metadata="metadata"></WriteReview>

      <EditMetadata v-if="showEditDialog" :metadata="metadata" @saved="onEditSaved" @closed="showEditDialog = false" />
    </div>
  </div>
</template>

<style scoped>
.progress-menu :deep(.q-item__section--avatar) {
  min-width: 0;
  padding-right: 4px;
}
.progress-menu :deep(.q-item__section--main) {
  align-items: flex-end;
}
</style>

<script>
import CoverSFW from 'components/CoverSFW'
import WriteReview from './WriteReview'
import EditMetadata from './EditMetadata'
import NotifyMixin from '../mixins/Notification.js'
import { mapState } from 'vuex'

export default {
  name: 'WorkDetails',

  mixins: [NotifyMixin],

  components: {
    CoverSFW,
    WriteReview,
    EditMetadata
  },

  props: {
    metadata: {
      type: Object,
      required: true
    }
  },

  data() {
    return {
      refreshMetadataLoading: false,
      userMarked: false,
      rating: 0,
      progress: '',
      showReviewDialog: false,
      showEditDialog: false,
      showTags: true
    }
  },

  computed: {
    sortedRatings: function() {
      function compare(a, b) {
        return (a.review_point > b.review_point) ? -1 : 1;
      }
      return this.metadata.rate_count_detail.slice().sort(compare);
    },

    progressLabel() {
      return {
        marked: '想听',
        listening: '在听',
        listened: '听过',
        replay: '重听',
        postponed: '搁置'
      }[this.progress] || '标记进度';
    },
    
    dlsiteCode() {
      let c = String(this.metadata.id);
      c = this.metadata.id > 1000000 
        ? c.padStart(8,'0')  // 8位RJ番号
        : c.padStart(6,'0'); // 6位RJ番号
      return c;
    },

    isFanza() {
      return String(this.metadata.id).startsWith('d_');
    },

    sourceLink() {
      if (this.isFanza) {
        return `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=${this.metadata.id}/`;
      }
      return `https://www.dlsite.com/home/work/=/product_id/RJ${this.metadata.id}.html`;
    },

    sourceLabel() {
      return this.isFanza ? 'Fanza' : 'DLsite';
    },

    currentHistoryTrack() {
      const state = this.metadata.state
      if (!state || !state.queue || state.queue.length === 0) return '—'
      const idx = Math.min(state.index ?? 0, state.queue.length - 1)
      const track = state.queue[idx]
      return track ? (track.title || '—') : '—'
    },

    historySeconds() {
      return this.metadata.state?.seconds ?? 0
    },

    isAdmin() {
      return !this.$store.state.User.auth || this.$store.state.User.group === 'administrator' || this.$store.state.User.name === 'admin';
    },

    ...mapState('AudioPlayer', [
      'playing',
      'playWorkId'
    ]),
  },

  watch: {
    // 需要用watch因为父component pages/work.vue是先用空值初始化的
    metadata (newMetaData) {
      if (newMetaData.userRating) {
        this.userMarked = true;
        this.rating = newMetaData.userRating;
      } else {
        this.userMarked = false;
        this.rating = newMetaData.rate_average_2dp || 0;
      }
      this.progress = newMetaData.progress;

      // 极个别作品没有标签
      if (newMetaData.tags && newMetaData.tags.length > 0 && newMetaData.tags[0].name === null) {
        this.showTags = false;
      }
    },
  },

  methods: {
    setProgress (newProgress) {
      this.progress = newProgress;
      const submitPayload = {
        'user_name': this.$store.state.User.name, // 用户名不会被后端使用
        'work_id': this.metadata.id,
        'progress': newProgress
      };
      this.submitProgress(submitPayload);
    },

    submitProgress (payload) {
      const params = {
        starOnly: false,
        progressOnly: true
      }
      this.$axios.put('/api/review', payload, {params})
        .then((response) => {
          this.showSuccNotif(response.data.message);
          this.$emit('reset');
        })
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

    // 只清除进度，保留评分与评论。仅 progress 的行会被后端整行删除。
    clearProgress () {
      this.$q.dialog({
        title: '清除进度',
        message: '将清除该作品的进度标记，保留评分与评论。是否继续？',
        cancel: '取消',
        ok: '确定',
        persistent: true
      }).onOk(() => {
        this.$axios.delete('/api/review/progress', { params: { work_id: this.metadata.id } })
          .then((response) => {
            this.showSuccNotif(response.data.message)
            this.$emit('reset')
          })
          .catch((error) => {
            if (error.response) {
              this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
            } else {
              this.showErrNotif(error.message || error)
            }
          })
      })
    },

    setRating (newRating) {
      const submitPayload = {
        'user_name': this.$store.state.User.name, // 用户名不会被后端使用
        'work_id': this.metadata.id,
        'rating': newRating
      };
      this.submitRating(submitPayload);
    },

    submitRating (payload) {
      this.$axios.put('/api/review', payload)
        .then((response) => {
          this.showSuccNotif(response.data.message);
          this.$emit('reset');
        })
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

    processReview () {
      this.showReviewDialog = false;
    },

    onEditSaved () {
      this.showEditDialog = false;
      this.$emit('reset');
    },

    resumeThisHistory() {
      this.$emit("resumeHistory")
    },

    clearThisHistory() {
      this.$q.dialog({
        title: '注意',
        message: '确定要删除这个作品的播放历史吗？',
        cancel: "取消",
        ok: "确定"
      }).onOk(async () => {
        this.$axios.delete('/api/history', { data: { work_id: this.metadata.id } })
          .then((_) => {
            this.$q.notify("删除历史成功")
          })
          .catch((err) => {
            this.$q.notify("删除历史失败：", err.message)
            console.error(err)
          })
      })
    },

    async scanWorkFile() {
      try {
        const response = await this.$axios.post(`/api/work/scan/${this.metadata.id}`);
        if (response.data.memo) {
          this.$router.go(0);
        }
      } catch(err) {
        console.error(err);
        this.showErrNotif(err.message || err);
      }
    },

    async refreshMetadata() {
      this.refreshMetadataLoading = true;
      try {
        await this.$axios.post(`/api/refresh/${this.metadata.id}`);
        this.showSuccNotif('元数据刷新成功');
        this.$emit('reset');
      } catch(err) {
        console.error(err);
        this.showErrNotif(err.response?.data?.error || err.message || err);
      } finally {
        this.refreshMetadataLoading = false;
      }
    },

    formatSeconds(totalSeconds) {
      if (totalSeconds == null || totalSeconds < 0) return '—'
      const mins = Math.floor(totalSeconds / 60)
      const secs = Math.floor(totalSeconds % 60)
      return `${mins}:${secs.toString().padStart(2, '0')}`
    }
  }
}
</script>
