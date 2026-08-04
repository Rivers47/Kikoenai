<template>
  <div>
    <q-card class="q-ma-md">
      <q-card-section>
        <div class="text-h6">进度回填</div>
        <div class="text-caption text-grey">
          自动标记完成播放的作品为听过。
          先执行预览（dry-run）确认无误后再正式运行。
        </div>
      </q-card-section>

      <q-card-actions align="left" class="q-px-md q-pb-md">
        <q-btn
          color="secondary"
          label="预览（dry-run）"
          icon="search"
          :loading="running"
          :disable="running"
          @click="run(true)"
        />
        <q-btn
          color="primary"
          label="正式运行"
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
        label="运行日志"
      >
        <q-scroll-area style="height: 320px;" class="bg-dark text-white q-pa-md">
          <div v-for="(line, i) in logs" :key="i" class="log-line">➜ {{ line }}</div>
        </q-scroll-area>
      </q-expansion-item>
    </q-card>

    <q-card v-if="summary" class="q-ma-md">
      <q-card-section>
        <div class="text-subtitle1 q-mb-sm">汇总</div>
        <div class="row q-gutter-md">
          <div class="col-auto">
            <div class="text-caption text-grey">总处理数</div>
            <div class="text-h6">{{ summary.total }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">标记已听</div>
            <div class="text-h6">{{ summary.marked }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">回填进度条目</div>
            <div class="text-h6">{{ summary.p2Seeded }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">跳过（已终结）</div>
            <div class="text-h6">{{ summary.skippedTerminal }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">跳过（无文件）</div>
            <div class="text-h6">{{ summary.p2SkippedNoFile }}</div>
          </div>
          <div class="col-auto">
            <div class="text-caption text-grey">跳过（已回填）</div>
            <div class="text-h6">{{ summary.skippedAlreadySeeded }}</div>
          </div>
        </div>
        <q-banner v-if="summary.dryRun" class="bg-grey-2 q-mt-sm" dense>
          以上为预览结果，未写入任何数据。
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
        this.showSuccNotif(dryRun ? '预览完成' : '回填完成')
      } catch (err) {
        const msg = err.response?.data?.error || '回填请求失败'
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
