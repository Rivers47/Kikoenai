<template>
  <div>
    <q-card class="q-ma-md">
      <q-card-section>
        <div class="text-h6">{{ $t('backfill.title') }}</div>
        <div class="text-caption text-grey">
          {{ $t('backfill.description') }}
        </div>
      </q-card-section>

      <q-card-actions align="left" class="q-px-md q-pb-md">
        <q-btn
          color="secondary"
          :label="$t('backfill.dryRun')"
          icon="search"
          :loading="running"
          :disable="running"
          @click="run(true)"
        />
        <q-btn
          color="primary"
          :label="$t('backfill.run')"
          icon="play_arrow"
          :loading="running"
          :disable="running"
          @click="run(false)"
        />
      </q-card-actions>
    </q-card>

    <q-card v-if="summary || logs.length" class="q-ma-md">
      <q-expansion-item
        v-model="logExpanded"
        expand-separator
        icon="terminal"
        :label="$t('backfill.log')"
      >
        <q-scroll-area style="height: 320px;" class="bg-dark text-white q-pa-md">
          <div v-for="(line, i) in logs" :key="i" class="log-line">➜ {{ line }}</div>
        </q-scroll-area>
      </q-expansion-item>
    </q-card>

    <q-card v-if="summary" class="q-ma-md">
      <q-card-section>
        <div class="text-subtitle1 q-mb-sm">{{ $t('backfill.summary') }}</div>
        <div class="row q-gutter-md">
          <div class="col-auto">
            <div class="text-caption text-grey">{{ $t('backfill.total') }}</div>
            <div class="text-h6">{{ summary.total }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">{{ $t('backfill.marked') }}</div>
            <div class="text-h6">{{ summary.marked }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">{{ $t('backfill.seeded') }}</div>
            <div class="text-h6">{{ summary.p2Seeded }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">{{ $t('backfill.skippedTerminal') }}</div>
            <div class="text-h6">{{ summary.skippedTerminal }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">{{ $t('backfill.skippedNoFile') }}</div>
            <div class="text-h6">{{ summary.p2SkippedNoFile }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">{{ $t('backfill.skippedAlreadySeeded') }}</div>
            <div class="text-h6">{{ summary.skippedAlreadySeeded }}</div>
          </div>
        </div>
        <q-banner v-if="summary.dryRun" class="bg-grey-2 q-mt-sm" dense>
          {{ $t('backfill.dryRunBanner') }}
        </q-banner>
      </q-card-section>
    </q-card>
  </div>
</template>

<script>
import NotifyMixin from '../../mixins/Notification.js'

export default {
  name: 'Backfill',

  mixins: [NotifyMixin],

  data () {
    return {
      running: false,
      logExpanded: true,
      logs: [],
      summary: null
    }
  },

  methods: {
    async run (dryRun) {
      this.running = true
      this.logs = []
      this.summary = null
      try {
        const { data } = await this.$axios.post('/api/backfill/progress', { dryRun })
        this.logs = data.logs || []
        this.summary = data.summary || null
        this.showSuccNotif(this.$t(dryRun ? 'backfill.dryRunComplete' : 'backfill.backfillComplete'))
      } catch (err) {
        const msg = err.response?.data?.error || this.$t('backfill.requestFailed')
        // Server may still return partial logs on error
        this.logs = err.response?.data?.logs || []
        this.showErrNotif(msg)
      } finally {
        this.running = false
      }
    }
  }
}
</script>
