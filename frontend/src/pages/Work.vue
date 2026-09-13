<template>
  <div>
    <WorkDetails :metadata="metadata" :images="extras.sampleImages" :resumeSeconds="resumeSeconds" @reset="requestData()" @resumeHistory="resumeMetadataPlayHistory" />
    <!-- <WorkQueue :queue="tracks" :editable="false" /> -->

    <!-- Tabs only appear once there is a second thing to show. A work with no
         scraped description keeps the bare file tree. -->
    <q-tabs
      v-if="hasDescription"
      v-model="tab"
      align="left"
      dense
      narrow-indicator
      class="q-mx-md text-primary"
    >
      <q-tab name="files" :label="$t('work.tabFiles')" />
      <q-tab name="description" :label="$t('work.tabDescription')" />
    </q-tabs>

    <!-- keep-alive so the tree keeps whichever folder the user had opened,
         along with its scroll position, across a tab switch. -->
    <q-tab-panels v-model="tab" keep-alive animated class="bg-transparent">
      <q-tab-panel name="files" class="q-pa-none">
        <WorkTree ref="workTree" :tree="tree" :metadata="metadata" :trackProgress="trackProgress" :editable="false" />
      </q-tab-panel>

      <q-tab-panel name="description" class="q-pa-md">
        <WorkDescription
          :workid="metadata.id"
          :html="extras.descriptionHtml"
          :description="extras.description"
          :parts="extras.descriptionParts"
          :images="extras.sampleImages"
        />
      </q-tab-panel>
    </q-tab-panels>
  </div>
</template>

<script>
import WorkDetails from 'components/WorkDetails'
// import WorkQueue from 'components/WorkQueue'
import WorkTree from 'components/WorkTree'
import WorkDescription from 'components/WorkDescription'
import NotifyMixin from '../mixins/Notification.js'
import { sendOrQueue } from '../utils/outbox'
import { positionsForWork, mergePositions, resumeSecondsFor } from '../utils/positions'

export default {
  name: 'Work',

  mixins: [NotifyMixin],

  components: {
    WorkDetails,
    // WorkQueue,
    WorkTree,
    WorkDescription
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
      // The parked track's position, reconciled against the local store. The
      // info panel and the resume button both read this, so neither can show a
      // number the file tree disagrees with.
      resumeSeconds: null,
      extras: { description: '', descriptionHtml: '', descriptionParts: [], sampleImages: [] },
      tab: 'files',
    }
  },

  computed: {
    hasDescription () {
      return Boolean(this.extras.descriptionHtml)
        || Boolean(this.extras.description)
        || this.extras.descriptionParts.length > 0
    }
  },

  watch: {
    '$route.params.id' (id) {
      this.workid = id;
      this.metadata.state = null;
      this.extras = { description: '', descriptionHtml: '', descriptionParts: [], sampleImages: [] };
      // The next work may have no description at all, and the tab bar goes with it.
      this.tab = 'files';
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
        await this.resolveResumeSeconds();
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
        // trackProgress is keyed by trackId, the same handle every node and
        // queue item carries, so progress badges paint on first render with no
        // second lookup key.
      } catch (error) {
        if (error.response) {
          // 请求已发出，但服务器响应的状态码不在 2xx 范围内
          this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
        } else {
          this.showErrNotif(error.message || error)
        }
      }

      // Reconcile against this device's own record, newest observation wins --
      // the same rule the server applies on write. Runs even when the request
      // above failed, which is the offline case it exists for.
      try {
        const { merged, localNewer } = mergePositions(
          this.trackProgress,
          await positionsForWork(this.workid)
        );
        this.trackProgress = merged;
        this.pushLocallyNewerPositions(localNewer, merged);
      } catch (err) {
        // A failed local read must not cost us the server's answer.
        console.error('local position read failed:', err);
      }
    },

    // Let the server catch up on anything this device knows better. Closes the
    // gap the throttled push opens: a position observed between pushes and then
    // lost to a hard kill would otherwise never leave the device.
    pushLocallyNewerPositions (trackIds, progress) {
      for (const trackId of trackIds) {
        const row = progress[trackId];
        if (!row) continue;
        sendOrQueue(this.$axios, {
          method: 'PUT',
          url: `/api/track-progress/${trackId}`,
          body: {
            seconds: row.seconds,
            completed: !!row.completed,
            observedAt: row.observedAt
          }
        });
      }
    },

    // Same rule the file tree uses, applied to the parked track. Runs off the
    // metadata request rather than the tracks request so the panel and the
    // resume button have a number before the directory listing resolves.
    async resolveResumeSeconds() {
      try {
        this.resumeSeconds = await resumeSecondsFor(this.workid, this.metadata.state);
      } catch (err) {
        console.error('resume reconciliation failed:', err);
      }
    },

    async requestExtras() {
      try {
        const response = await this.$axios.get(`/api/work/${this.workid}/extras`);
        this.extras = response.data;
      } catch (error) {
        // Non-fatal: the description is an extra, and the page is perfectly
        // usable as the file tree it has always been.
        if (error.response) {
          this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
        } else {
          this.showErrNotif(error.message || error)
        }
      }
    },

    requestData () {
      this.requestMetaData();
      this.requestTracks();
      this.requestExtras();
    },

    resumeMetadataPlayHistory() {
      // this.resumeSeconds is the reconciled value -- the server's state.seconds
      // weighed against this device's own record (resumeSecondsFor), which is
      // the same rule the file tree and the "played to" line use. Falls back to
      // the raw server value only until that resolves; -1 is the "nothing to
      // resume" sentinel.

      // 以最小化形式打开播放器
      this.$store.commit('AudioPlayer/TOGGLE_HIDE')
      this.$store.commit('AudioPlayer/SET_QUEUE', {
        workId: this.metadata.id,
        vas: this.metadata.vas,
        queue: this.metadata.state.queue,
        index: this.metadata.state.index,
        resetPlaying: false,
        resumeHistorySeconds: this.resumeSeconds ?? this.metadata.state.seconds ?? -1,
        workLastTrackId: this.metadata.state.queue.length ? this.metadata.state.queue[this.metadata.state.queue.length - 1].trackId : ''
      })
    }
  }
}
</script>
