<template>
  <div>
    <div class="row q-ma-sm">
      <div v-if="state === 'running'" class="col-xs-12 col-sm-12 row q-pa-sm">
        <q-btn
          class="col"
          color="negative"
          :label="$t('scanner.killScan')"
          :disable="state !== 'running' || !(loggedIn || $socket.connected)"
          @click="killScanProceess()"
        />
      </div>

      <div class="col-xs-6 col-sm-4 row q-pa-sm">
        <q-btn
          class="col"
          color="primary"
          :label="$t('scanner.scanLibrary')"
          :disable="state === 'running' || !(loggedIn || $socket.connected)"
          @click="performScan()"
        />
      </div>

      <div class="col-xs-6 col-sm-4 row q-pa-sm">
        <q-btn
          class="col"
          color="primary"
          :label="$t('scanner.refreshLibrary')"
          :disable="state === 'running' || !(loggedIn || $socket.connected)"
          @click="performUpdate()"
        />
      </div>

      <div class="col-xs-12 col-sm-4 row q-pa-sm">
        <q-btn
          class="col"
          color="secondary"
          :label="$t('scanner.scanFileChanges')"
          :disable="state === 'running' || !(loggedIn || $socket.connected)"
          @click="performWorkFileScan()"
        />
      </div>
    </div>

    <q-card v-show="state" class="q-ma-md">
      <q-expansion-item expand-separator>
        <template v-slot:header>
          <q-item-section avatar>
            <q-spinner-gears v-if="state === 'running'" color="primary" size="2em" />
            <q-icon v-else-if="state === 'finished'" name="done" color="positive" size="2em" />
            <q-icon v-else-if="state === 'error'" name="bug_report" color="negative" size="2em" />
          </q-item-section>

          <q-item-section>
            <q-item-label v-if="allLogs.length > 1" class="ellipsis">{{allLogs[allLogs.length - 2].message}}</q-item-label>
            <q-item-label v-if="allLogs.length > 0" class="ellipsis">{{allLogs[allLogs.length - 1].message}}</q-item-label>
          </q-item-section>
        </template>
        
        <q-scroll-area style="height: 256px;" class="bg-dark text-white q-pa-md">
          <div v-for="(log, index) in allLogs" :key="index" >
            <span :class="textColorOnLevel(log.level)">➜ {{log.message}}</span>
          </div>
        </q-scroll-area>
      </q-expansion-item>
    </q-card>

    <q-card v-show="(tasks.length > 0) || (failedTasks.length > 0)" class="q-ma-md">
      <q-tabs
        v-model="tab"
        dense
        inline-label
        class="text-muted"
        active-color="on-secondary"
        active-bg-color="secondary"
        indicator-color="accent"
        align="justify"
        narrow-indicator
      >
        <q-tab name="tasks" icon="hourglass_full" :label="$t('scanner.processing')">
          <q-badge v-show="tasks.length > 0" color="primary" floating>{{tasks.length}}</q-badge>
        </q-tab>
        <q-tab name="failedTasks" icon="error_outline" :label="$t('scanner.failed')">
          <q-badge v-show="failedTasks.length > 0" color="negative" floating>{{failedTasks.length}}</q-badge>
        </q-tab>
      </q-tabs>

      <q-separator />

      <q-tab-panels v-model="tab" animated>
        <q-tab-panel name="tasks" class="q-pa-none">
          <q-virtual-scroll
            separator
            style="max-height: 313px;"
            :items="tasks"
            :virtual-scroll-item-size="52"
          >
            <template v-slot="{ item, index }">
              <q-expansion-item expand-separator :key="index">
                <template v-slot:header>
                  <q-item-section avatar>
                    <q-spinner-hourglass color="primary" size="2em" />
                  </q-item-section>

                  <q-item-section>
                    <q-item-label v-if="item.logs.length > 0" class="ellipsis">{{item.logs[item.logs.length - 1].message}}</q-item-label>
                    <q-item-label caption>{{item.rjcode.startsWith('d_') ? item.rjcode : `RJ${item.rjcode}`}}</q-item-label>
                  </q-item-section>
                </template>
                
                <q-card>
                  <q-card-section class="bg-dark text-white">
                    <div v-for="(log, index) in item.logs" :key="index">
                      <span :class="textColorOnLevel(log.level)">➜ {{log.message}}</span>
                    </div>
                  </q-card-section>
                </q-card>
              </q-expansion-item>
            </template>
          </q-virtual-scroll>
        </q-tab-panel>

        <q-tab-panel name="failedTasks" class="q-pa-none">
          <q-virtual-scroll
            separator
            style="max-height: 313px;"
            :items="failedTasks"
            :virtual-scroll-item-size="52"
          >
            <template v-slot="{ item, index }">
              <q-expansion-item
                expand-separator
                :key="index"
                expand-icon-class="text-white"
                header-class="bg-negative"
              >
                <template v-slot:header>
                  <q-item-section avatar>
                    <q-icon name="bug_report" color="white" size="2em" />
                  </q-item-section>

                  <q-item-section>
                    <q-item-label class="text-white ellipsis" >
                      {{item.logs[item.logs.length - 1].message}}
                    </q-item-label>

                    <q-item-label caption class="text-white">
                      {{item.rjcode.startsWith('d_') ? item.rjcode : `RJ${item.rjcode}`}}
                    </q-item-label>
                  </q-item-section>
                </template>
                
                <q-card>
                  <q-card-section class="bg-dark text-white">
                    <div v-for="(log, index) in item.logs" :key="index">
                      <span :class="textColorOnLevel(log.level)">➜ {{log.message}}</span>
                    </div>
                  </q-card-section>
                </q-card>
              </q-expansion-item>
              
            </template>
          </q-virtual-scroll>
        </q-tab-panel>
      </q-tab-panels>
    </q-card>
  </div>
</template>

<script>
import NotifyMixin from '../../mixins/Notification.js'

export default {
  name: 'Scanner',

  mixins: [NotifyMixin],

  data () {
    return {
      tab: 'tasks',
      state: null, // ['running', 'finished', 'error']
      loggedIn: false,
      tasks: [],
      failedTasks: [],
      mainLogs: [],
      results: []
    }
  },

  methods: {
    cleanRerun() {
      this.tasks = []
      this.failedTasks = []
      this.mainLogs = []
      this.results = []
      this.state = 'running'
    },

    performScan () {
      this.cleanRerun()
      this.$socket.emit('PERFORM_SCAN')
    },

    performWorkFileScan () {
      this.cleanRerun()
      this.$socket.emit('PERFORM_LYRIC_SCAN')
    },

    performUpdate () {
      this.cleanRerun()
      this.$socket.emit('PERFORM_UPDATE')
    },

    killScanProceess () {
      this.$socket.emit('KILL_SCAN_PROCESS')
    },

    textColorOnLevel(level) {
      switch(level) {
        case 'error': return 'text-negative';
        case 'warn': return 'text-warning';
        default: return '';
      }
    },

    onSCAN_TASKS (payload) {
      this.tasks = payload.tasks
    },
    onSCAN_FAILED_TASKS (payload) {
      this.failedTasks = payload.failedTasks
    },
    onSCAN_MAIN_LOGS (payload) {
      this.mainLogs = payload.mainLogs
    },
    onSCAN_RESULTS (payload) {
      this.results = payload.results
    },
    onSCAN_INIT_STATE (payload) {
      this.state = 'running'
      this.tasks = payload.tasks
      this.failedTasks = payload.failedTasks
      this.mainLogs = payload.mainLogs
      this.results = payload.results
    },
    onSCAN_FINISHED (payload) {
      this.state = 'finished'
      this.allLogs.push({
        level: 'info',
        message: payload.message
      })
    },
    onSCAN_ERROR () {
      this.state = 'error'
    },
    onSuccess () {
      this.loggedIn = true
    },
    onConnectError () {
      this.showErrNotif(this.$t('scanner.socketConnectFail'))
    },
  },

  computed: {
    allLogs () {
      const resultLogs = this.results.map(res => {
        const prefix = res.rjcode.startsWith('d_') ? '' : 'RJ'
        const code = `${prefix}${res.rjcode}`
        const count = res.count
        if (res.result === 'added') {
          return { level: 'info', message: this.$t('scanner.addedSuccess', { code, count }) }
        } else if (res.result === 'updated') {
          return { level: 'info', message: this.$t('scanner.updatedSuccess', { code, count }) }
        } else {
          return { level: 'error', message: this.$t('scanner.processFailed', { code, count }) }
        }
      })
      return this.mainLogs.concat(resultLogs)
    }
  },

  mounted () {
    this.$socket.emit('ON_SCANNER_PAGE')
    this.$socket.on('SCAN_TASKS', this.onSCAN_TASKS)
    this.$socket.on('SCAN_FAILED_TASKS', this.onSCAN_FAILED_TASKS)
    this.$socket.on('SCAN_MAIN_LOGS', this.onSCAN_MAIN_LOGS)
    this.$socket.on('SCAN_RESULTS', this.onSCAN_RESULTS)
    this.$socket.on('SCAN_INIT_STATE', this.onSCAN_INIT_STATE)
    this.$socket.on('SCAN_FINISHED', this.onSCAN_FINISHED)
    this.$socket.on('SCAN_ERROR', this.onSCAN_ERROR)
    this.$socket.on('success', this.onSuccess)
    this.$socket.on('connect_error', this.onConnectError)
  },

  beforeUnmount () {
    this.$socket.off('SCAN_TASKS', this.onSCAN_TASKS)
    this.$socket.off('SCAN_FAILED_TASKS', this.onSCAN_FAILED_TASKS)
    this.$socket.off('SCAN_MAIN_LOGS', this.onSCAN_MAIN_LOGS)
    this.$socket.off('SCAN_RESULTS', this.onSCAN_RESULTS)
    this.$socket.off('SCAN_INIT_STATE', this.onSCAN_INIT_STATE)
    this.$socket.off('SCAN_FINISHED', this.onSCAN_FINISHED)
    this.$socket.off('SCAN_ERROR', this.onSCAN_ERROR)
    this.$socket.off('success', this.onSuccess)
    this.$socket.off('connect_error', this.onConnectError)
  },
}
</script>