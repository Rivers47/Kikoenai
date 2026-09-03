<template>
  <div>
    <WorkDetails :metadata="metadata" @reset="requestData()" @resumeHistory="resumeMetadataPlayHistory" />
    <!-- <WorkQueue :queue="tracks" :editable="false" /> -->
    <WorkTree ref="workTree" :tree="tree" :metadata="metadata" :trackProgress="trackProgress" :editable="false" />
  </div>
</template>

<script>
import WorkDetails from 'components/WorkDetails'
// import WorkQueue from 'components/WorkQueue'
import WorkTree from 'components/WorkTree'
import NotifyMixin from '../mixins/Notification.js'

export default {
  name: 'Work',

  mixins: [NotifyMixin],

  components: {
    WorkDetails,
    // WorkQueue,
    WorkTree
  },

  data () {
    return {
      workid: this.$route.params.id,
      metadata: {
        id: this.$route.params.id,
        circle: {}
      },
      tree: [],
      trackProgress: {},
    }
  },

  watch: {
    $route (to) {
      this.workid = to.params.id;
      this.metadata.state = null;
      this.requestData();
    },
    
    metadata() {
    }
  },

  created () {
    this.requestData()
  },

  methods: {
    async requestMetaData() {
      try {
        const response = await this.$axios.get(`/api/work/${this.workid}`);
        this.metadata = response.data
        // Do not auto-resume playback history on page load; the user must
        // explicitly click the "Resume History" button (see WorkDetails.vue).
      } catch (error ) {
        if (error.response) {
          // 请求已发出，但服务器响应的状态码不在 2xx 范围内
          this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
        } else {
          this.showErrNotif(error.message || error)
        }
      }
    },

    async requestTracks() {
      try {
        const response = await this.$axios.get(`/api/tracks/${this.workid}`);
        this.tree = response.data.tree || response.data;
        this.trackProgress = response.data.trackProgress || {};
        // The tree arrives with contentHash already on every audio node, so
        // progress badges paint on first render and any queue committed from
        // here carries its hashes. The first open of a work is slower for it
        // (the backend hashes the audio once, then caches by mtime).
      } catch (error) {
        if (error.response) {
          // 请求已发出，但服务器响应的状态码不在 2xx 范围内
          this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
        } else {
          this.showErrNotif(error.message || error)
        }
      }
    },

    requestData () {
      this.requestMetaData();
      this.requestTracks();
    },

    resumeMetadataPlayHistory() {
      // Position comes from state.seconds, which GET /api/work/:id resolved
      // from t_track_progress -- the same value the "played to" line shows.
      // Not this.trackProgress: it is keyed by the parked queue item's
      // contentHash, which history rows written before per-track progress do
      // not carry, and it only arrives with GET /api/tracks/:id, which lists
      // the work directory and so resolves after the metadata request that
      // renders this button. Either way the lookup missed and resumed at 0.
      // -1 is the "nothing to resume" sentinel for rows with no position yet.

      // 以最小化形式打开播放器
      this.$store.commit('AudioPlayer/TOGGLE_HIDE')
      this.$store.commit('AudioPlayer/SET_QUEUE', {
        workId: this.metadata.id,
        vas: this.metadata.vas,
        queue: this.metadata.state.queue,
        index: this.metadata.state.index,
        resetPlaying: false,
        resumeHistorySeconds: this.metadata.state.seconds ?? -1,
        advancePastFinishedTrack: true,
        workLastTrackId: this.metadata.state.queue.length ? (this.metadata.state.queue[this.metadata.state.queue.length - 1].trackId || this.metadata.state.queue[this.metadata.state.queue.length - 1].hash) : ''
      })
    }
  }
}
</script>
