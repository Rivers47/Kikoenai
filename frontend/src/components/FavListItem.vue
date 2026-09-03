<template>
  <q-item clickable class="row">
      <q-item-section class="col-auto" top> 
        <router-link :to="`/work/${metadata.id}`">
          <q-img transition="fade" :src="coverUrl" style="height: 120px; width: 160px;" />
        </router-link>
      </q-item-section>


      <q-item-section class="q-gutter-y-xs column items-start" top v-on:click.self="showReviewDialog = true && mode != 'history' ">
        <q-item-label lines="2" class="text-body2">
          <router-link :to="`/work/${metadata.id}`" class="col-auto text-secondary">
            {{metadata.title}}
          </router-link>
        </q-item-label>

        <div class="row q-gutter-x-sm col-auto" >
          <SearchableLabel
            :to="labelRoute('circle', metadata.circle.name)"
            field="circle"
            :name="metadata.circle.name"
            link-class="text-muted"
            class="col-auto"
          >
            {{metadata.circle.name}}
          </SearchableLabel>

          <span class="col-auto">/</span>
          <span class="col-auto text-muted"> {{metadata.release}}</span>
          <span class="col-auto">/</span>

          <SearchableLabel
            v-for="(va, index) in metadata.vas"
            :key=index
            :to="labelRoute('va', va.name)"
            field="va"
            :name="va.name"
            link-class="text-primary"
            class="col-auto"
          >
            {{ va.name }}
          </SearchableLabel>
        </div>

        <div class="row items-center q-gutter-x-xs">
          <q-rating
            v-if="!hideRating"
            v-model="rating"
            @update:model-value="setRating"
            size="sm"
            color="primary"
            icon="star_border"
            icon-selected="star"
            icon-half="star_half"
            class="col-auto"
          />
          <span class="col-auto text-muted ">{{metadata.updated_at}}</span>
        </div>

        <q-item-label class="q-pt-sm" v-if="mode === 'review'">
          <q-card class="my-card col-auto" @click="showReviewDialog = true" v-show="metadata.review_text" >
            <q-card-section class="q-pa-sm">
              <pre class="q-ma-none">{{metadata.review_text}}</pre>
            </q-card-section>
          </q-card>
        </q-item-label>

        <div v-if="mode === 'history'" class="full-width">
          <div class="full-width">
            <q-btn color="primary" :label="$t('favlistitem.playFromHistory')"  class="full-width" @click="playHistory(metadata.id, metadata.state)"/>
          </div>

          <!--
          <div>
            <span class="text-accent">历史：</span>
              <q-badge color="primary">
                {{ metadata.play_updated_at }}
              </q-badge>
          </div>
          -->

          <div>
            <span class="text-accent">{{ $t('favlistitem.progress') }}：</span>
            <q-badge color="tertiary-container" text-color="on-tertiary-container">{{ metadata.state.index+1 }} / {{ metadata.state.queue.length }}</q-badge>
            <q-badge color="primary-container" text-color="on-primary-container">{{ humanReadableSeconds(metadata.state.seconds) }}</q-badge>
            <span class="text-muted">
              {{ metadata.state.queue[metadata.state.index].title }}
            </span>
          </div>
        </div>

        <q-item-label class="q-pt-xs" v-if="mode === 'progress'">
          <q-btn-toggle
            v-if="mode === 'progress'"
            v-model="progress"
            @update:model-value="setProgress"
            dense
            no-caps
            rounded
            toggle-color="primary"
            color="white"
            text-color="black"
            class="q-pa-sm"
            :options="progressOptions"
          />
          </q-item-label>
      </q-item-section>

      <WriteReview v-if="showReviewDialog" @closed="processReview" :workid="workid" :metadata="metadata"></WriteReview>

  </q-item>
</template>

<script>
import WriteReview from './WriteReview'
import NotifyMixin from '../mixins/Notification.js'
import { apiUrl } from 'src/base-path'
import { labelRoute } from 'src/utils'
import SearchableLabel from './SearchableLabel'

export default {
  name: 'FavListItem',

  mixins: [NotifyMixin],

  components: {
    SearchableLabel,
    WriteReview
  },

  props: {
      workid: {
        type: [String, Number],
        required: true
      },
      metadata: {
        type: Object,
        required: true
      },
      mode: {
        type: String,
        default: 'review'
      }
  },

  data () {
    return {
      rating: 0,
      showReviewDialog: false,
      hideRating: false,
      progress: ''
    }
  },

  computed: {
    progressOptions() {
      return [
        { label: this.$t('favlistitem.marked'), value: 'marked' },
        { label: this.$t('favlistitem.listening'), value: 'listening' },
        { label: this.$t('favlistitem.listened'), value: 'listened' },
        { label: this.$t('favlistitem.replay'), value: 'replay' },
        { label: this.$t('favlistitem.postponed'), value: 'postponed' }
      ]
    },

    coverUrl () {
      return this.workid ? apiUrl(`/api/cover/${this.workid}?type=240x240`) : ""
    },
  },

  mounted() {
    // 可以用mounted因为初始化时metadata不为空
    this.setMetadata();
  },

  watch: {
    // 需要watch metadata 当父component刷新metadata时更新
    metadata () {
      this.setMetadata();
    }
  },

  methods: {
    labelRoute,
    // Zero hours/minutes are omitted. The en-US unit strings carry a leading
    // space (CJK ones don't), so join with '' and trim what that leaves behind.
    humanReadableSeconds(seconds) {
      const h = Math.floor(seconds / 3600)
      const m = Math.floor(seconds / 60) % 60
      const s = Math.floor(seconds) % 60
      let out = ''
      if (h) out += this.$t('favlistitem.hourUnit', { h })
      if (m) out += this.$t('favlistitem.minuteUnit', { m })
      return (out + this.$t('favlistitem.secondUnit', { s })).trim()
    },

    setMetadata () {
      if (this.metadata.userRating) {
        this.rating = this.metadata.userRating;
      } else {
        this.hideRating = true;
      }
      if (!this.rating) {
        this.hideRating = true;
      } else {
        this.hideRating = false;
      }

      this.progress = this.metadata.progress;
    },

    processReview (modified) {
      if (modified) {
        this.calledFromChild = true;
        this.$emit('reset');
      }
      this.showReviewDialog = false;
    },

    setRating (newRating) {
      // 取消标星可能是操作失误，所以不响应。应使用删除标记来删除打星
      if (newRating) {
        const submitPayload = {
          'user_name': this.$store.state.User.name, // 用户名不会被后端使用
          'work_id': this.metadata.id,
          'rating': newRating
        };
        this.submitRating(submitPayload);
      }
    },

    submitRating (payload) {
      const params = {
        starOnly: true
      }
      this.$axios.put('/api/review', payload, { params })
        .then((response) => {
          this.showSuccNotif(response.data.message)
        })
        .then(()=> this.$emit('reset'))
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

    setProgress (newProgress) {
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
          this.showSuccNotif(response.data.message)
        })
        .then(()=> this.$emit('reset'))
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

    playHistory(workId, historyState) {
      this.$store.commit('AudioPlayer/SET_QUEUE', {
        workId: workId,
        vas: this.metadata.vas,
        queue: historyState.queue,
        index: historyState.index,
        resetPlaying: false,
        resumeHistorySeconds: historyState.seconds,
        advancePastFinishedTrack: true,
        workLastTrackId: historyState.queue.length ? (historyState.queue[historyState.queue.length - 1].trackId || historyState.queue[historyState.queue.length - 1].hash) : ''
      })
      // this.$store.commit('AudioPlayer/SET_RESUME_HISTORY_SECONDS', historyState.seconds)
    }
  }

}
</script>