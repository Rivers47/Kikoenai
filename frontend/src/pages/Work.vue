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
        // Tree is rendered instantly from listing + memo (no file reads). Hashes
        // are computed/cached separately and merged reactively here so the tree
        // doesn't wait on hashing multi-GB works.
        this.requestMemo();
      } catch (error) {
        if (error.response) {
          // 请求已发出，但服务器响应的状态码不在 2xx 范围内
          this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
        } else {
          this.showErrNotif(error.message || error)
        }
      }
    },

    // Fetch lazily-computed content hashes and merge them onto the already-
    // rendered tree nodes by relPath. Per-track progress badges populate
    // reactively once contentHash is set (WorkTree reads trackProgress[contentHash]).
    async requestMemo() {
      try {
        const response = await this.$axios.get(`/api/work/${this.workid}/memo`);
        const contentHashMap = response.data.contentHash || {};
        if (Object.keys(contentHashMap).length === 0) return;
        // Build a new tree (no in-place mutation — the nodes may be observed by
        // Vuex strict mode) with contentHash merged by relPath. Reassigning
        // this.tree triggers WorkTree's `tree` watcher -> internalTree rebuild.
        this.tree = this.mergeContentHashes(this.tree, contentHashMap);
        // The tree now has hashes, but a queue committed before this resolved
        // does not -- SET_QUEUE snapshotted the pre-merge node objects, and the
        // merge above builds new ones rather than mutating them. Heal it, or
        // per-track progress goes unreported for the rest of the session.
        this.syncPlayingQueueContentHashes();
      } catch (error) {
        // Hashing can be slow/expensive; fail silently — badges just won't show.
        console.error('fetch work memo failed:', error);
      }
    },

    // Push freshly merged hashes onto the live queue, but only when the queue
    // actually belongs to this work -- the user may have navigated here while
    // something else is playing.
    syncPlayingQueueContentHashes() {
      // Read straight from the store: this component maps no AudioPlayer
      // state, and `this.playWorkId` would be undefined here.
      if (String(this.$store.state.AudioPlayer.playWorkId) !== String(this.workid)) return;
      const hashByTrackId = this.collectContentHashesByTrackId(this.tree, {});
      if (Object.keys(hashByTrackId).length === 0) return;
      this.$store.commit('AudioPlayer/UPDATE_QUEUE_CONTENT_HASHES', hashByTrackId);
    },

    // Flatten the merged tree to { [trackId]: contentHash }. Keyed by trackId
    // rather than relPath because queue items carry trackId, not relPath.
    collectContentHashesByTrackId(nodes, out) {
      if (!Array.isArray(nodes)) return out;
      for (const node of nodes) {
        if (node.type === 'folder') {
          this.collectContentHashesByTrackId(node.children, out);
        } else if (node.type === 'audio' && node.contentHash) {
          out[node.trackId || node.hash] = node.contentHash;
        }
      }
      return out;
    },

    // Return a new tree with contentHash set on audio nodes by matching relPath.
    // Purely functional — never mutates the input nodes (some are observed by
    // Vuex strict mode, which throws on outside-mutation).
    mergeContentHashes(nodes, contentHashMap) {
      if (!Array.isArray(nodes)) return nodes;
      return nodes.map((node) => {
        if (node.type === 'audio' && node.relPath && contentHashMap[node.relPath] !== undefined) {
          return { ...node, contentHash: contentHashMap[node.relPath] };
        }
        if (node.type === 'folder' && Array.isArray(node.children)) {
          return { ...node, children: this.mergeContentHashes(node.children, contentHashMap) };
        }
        return node;
      });
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
        workLastTrackId: this.metadata.state.queue.length ? (this.metadata.state.queue[this.metadata.state.queue.length - 1].trackId || this.metadata.state.queue[this.metadata.state.queue.length - 1].hash) : ''
      })
    }
  }
}
</script>
