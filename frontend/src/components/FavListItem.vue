<template>
  <q-item class="row">
      <q-item-section class="col-auto" top>
        <router-link :to="`/work/${metadata.id}`">
          <q-img transition="fade" :src="coverUrl" style="height: 120px; width: 160px;" />
        </router-link>
      </q-item-section>

      <q-item-section class="q-gutter-y-xs column items-start" top>
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

        <span class="col-auto text-muted">{{metadata.updated_at}}</span>

        <div class="full-width">
          <div class="full-width">
            <q-btn color="primary" text-color="on-primary" :label="t('favlistitem.playFromHistory')" class="full-width" @click="playHistory(metadata.id, metadata.state)"/>
          </div>

          <div>
            <span class="text-accent">{{ t('favlistitem.progress') }}：</span>
            <q-badge color="tertiary-container" text-color="on-tertiary-container">{{ metadata.state.index+1 }} / {{ metadata.state.queue.length }}</q-badge>
            <q-badge color="primary-container" text-color="on-primary-container">{{ humanReadableSeconds(resumeSeconds ?? metadata.state.seconds) }}</q-badge>
            <span class="text-muted">
              {{ parkedTrackTitle }}
            </span>
          </div>
        </div>
      </q-item-section>

  </q-item>
</template>

<script>
import { useI18n } from 'vue-i18n'
import { apiUrl } from 'src/base-path'
import { labelRoute } from 'src/utils'
import { resumeSecondsFor } from '../utils/positions'
import SearchableLabel from './SearchableLabel'

export default {
  setup () {
    const { t } = useI18n() // global scope
    return { t }
  },
  name: 'FavListItem',

  components: {
    SearchableLabel,
  },

  props: {
      workid: {
        type: [String, Number],
        required: true
      },
      metadata: {
        type: Object,
        required: true
      }
  },

  data () {
    return {
      resumeSeconds: null
    }
  },

  computed: {
    // The track this work is parked on, by the same rule as the player and the
    // file tree. A queue stored before track titles existed carries no
    // trackTitle and keeps showing the filename until it is rebuilt from the
    // tree -- i.e. the next time the work is played from its own page.
    parkedTrackTitle() {
      const state = this.metadata.state;
      const item = state && state.queue && state.queue[state.index];
      return item ? (item.trackTitle || item.title) : '';
    },

    coverUrl () {
      return this.workid ? apiUrl(`/api/cover/${this.workid}?type=240x240`) : ""
    },
  },

  mounted() {
    // 可以用mounted因为初始化时metadata不为空
    this.resolveResumeSeconds();
  },

  watch: {
    // 需要watch metadata 当父component刷新metadata时更新
    metadata () {
      this.resolveResumeSeconds();
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
      if (h) out += this.t('favlistitem.hourUnit', { h })
      if (m) out += this.t('favlistitem.minuteUnit', { m })
      return (out + this.t('favlistitem.secondUnit', { s })).trim()
    },

    async resolveResumeSeconds() {
      if (!this.metadata || !this.metadata.state) return
      try {
        this.resumeSeconds = await resumeSecondsFor(this.workid, this.metadata.state)
      } catch (err) {
        console.error('resume reconciliation failed:', err)
      }
    },

    // Same reconciliation as the work page and Recent Works: resuming the same
    // history row must land in the same place from any entry point.
    async playHistory(workId, historyState) {
      const seconds = await resumeSecondsFor(workId, historyState)
      this.$store.commit('AudioPlayer/SET_QUEUE', {
        workId: workId,
        vas: this.metadata.vas,
        queue: historyState.queue,
        index: historyState.index,
        resetPlaying: false,
        resumeHistorySeconds: seconds,
        workLastTrackId: historyState.queue.length ? historyState.queue[historyState.queue.length - 1].trackId : ''
      })
    }
  }

}
</script>
