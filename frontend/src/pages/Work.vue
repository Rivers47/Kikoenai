<template>
  <div>
    <WorkDetails :metadata="metadata" @reset="requestData()" @resumeHistroy="resumeMetadataPlayHistroy" />
    <!-- <WorkQueue :queue="tracks" :editable="false" /> -->
    <WorkTree ref="workTree" :tree="tree" :metadata="metadata" :trackProgress="trackProgress" :editable="false" />
  </div>
</template>

<script>
import WorkDetails from 'components/WorkDetails'
// import WorkQueue from 'components/WorkQueue'
import WorkTree from 'components/WorkTree'
import NotifyMixin from '../mixins/Notification.js'
import { mapState } from 'vuex'

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

  computed: {
    ...mapState('AudioPlayer', [
      'playing',
      'playWorkId'
    ]),
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
        // 如果有播放状态记录
        // 同时当前尚未播放，则设置历史播放进度
        if (this.metadata.state && this.playWorkId == 0) {
          this.resumeMetadataPlayHistroy()
        }
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
        const hashMap = response.data.hash || {};
        if (Object.keys(hashMap).length === 0) return;
        // Build a new tree (no in-place mutation — the nodes may be observed by
        // Vuex strict mode) with contentHash merged by relPath. Reassigning
        // this.tree triggers WorkTree's `tree` watcher -> internalTree rebuild.
        this.tree = this.mergeContentHashes(this.tree, hashMap);
      } catch (error) {
        // Hashing can be slow/expensive; fail silently — badges just won't show.
        console.error('fetch work memo failed:', error);
      }
    },

    // Return a new tree with contentHash set on audio nodes by matching relPath.
    // Purely functional — never mutates the input nodes (some are observed by
    // Vuex strict mode, which throws on outside-mutation).
    mergeContentHashes(nodes, hashMap) {
      if (!Array.isArray(nodes)) return nodes;
      return nodes.map((node) => {
        if (node.type === 'audio' && node.relPath && hashMap[node.relPath] !== undefined) {
          return { ...node, contentHash: hashMap[node.relPath] };
        }
        if (node.type === 'folder' && Array.isArray(node.children)) {
          return { ...node, children: this.mergeContentHashes(node.children, hashMap) };
        }
        return node;
      });
    },
    
    requestData () {
      this.requestMetaData();
      this.requestTracks();
    },

    resumeMetadataPlayHistroy() {
      // 以最小化形式打开播放器
      this.$store.commit('AudioPlayer/TOGGLE_HIDE')
      this.$store.commit('AudioPlayer/SET_QUEUE', {
        workId: this.metadata.id,
        queue: this.metadata.state.queue,
        index: this.metadata.state.index,
        resetPlaying: false,
        resumeHistroySeconds: this.metadata.state.seconds,
        workLastTrackHash: this.metadata.state.queue.length ? this.metadata.state.queue[this.metadata.state.queue.length - 1].hash : ''
      })
      console.log(`resume seconds = ${this.metadata.state.seconds}`)
    }
  }
}
</script>
