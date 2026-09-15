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
                    <q-item-label caption>{{ workno(item.rjcode) }}</q-item-label>
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
                      {{ workno(item.rjcode) }}
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
import { workno } from 'src/utils'

// Mirrors the caps the scanner child applies to its own snapshot. A run over a
// large library emits tens of thousands of lines and the panel below is not
// virtualised, so an unbounded tail is a growing DOM on top of a growing array.
// The complete record is in the scanner's log file, named in the first line.
const MAX_MAIN_LOGS = 500
const MAX_TASK_LOGS = 200
const MAX_FAILED_TASKS = 200
const MAX_RESULTS = 500

const push = (array, entry, max) => {
  array.push(entry)
  if (array.length > max) array.splice(0, array.length - max)
}

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
    workno, // template: prints the work code as DLsite/Fanza spell it

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
      this.$socket.emit('PERFORM_WORK_FILE_SCAN')
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

    // Every SCAN_* below carries one entry, not the whole accumulated array,
    // so these handlers append. The old plural events re-sent the entire log on
    // every line -- quadratic, and on a whole-library refresh it meant
    // re-rendering this page's un-virtualised log panel over the full results
    // array once per work. Measured, it never came close to dropping a socket
    // (526KB at the largest, 2.2ms to parse); it is simply waste, and it is
    // what made per-line image logging too expensive to add.
    onSCAN_TASK_ADD (payload) {
      if (!this.tasks.some(task => task.rjcode === payload.rjcode)) {
        this.tasks.push({ rjcode: payload.rjcode, result: null, logs: [] })
      }
    },
    onSCAN_TASK_LOG (payload) {
      const task = this.tasks.find(task => task.rjcode === payload.rjcode)
      if (task) push(task.logs, payload.entry, MAX_TASK_LOGS)
    },
    onSCAN_TASK_REMOVE (payload) {
      const index = this.tasks.findIndex(task => task.rjcode === payload.rjcode)
      if (index !== -1) this.tasks.splice(index, 1)
    },
    onSCAN_FAILED_TASK (payload) {
      push(this.failedTasks, payload.task, MAX_FAILED_TASKS)
    },
    onSCAN_MAIN_LOG (payload) {
      push(this.mainLogs, payload.entry, MAX_MAIN_LOGS)
    },
    onSCAN_RESULT (payload) {
      push(this.results, payload.result, MAX_RESULTS)
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
      this.tasks = []
      // mainLogs, not allLogs: allLogs is a computed, and pushing into it wrote
      // to a cached array that the next delta threw away -- so the line saying
      // the scan had finished could vanish on the way in.
      push(this.mainLogs, { level: 'info', message: payload.message }, MAX_MAIN_LOGS)
    },
    onSCAN_ERROR () {
      this.state = 'error'
      this.tasks = []
    },
    // Socket.IO reconnects on its own after a drop; this is what makes the page
    // catch up afterwards instead of staying frozen on its last line. The
    // server answers with a fresh snapshot, or with the outcome of a run that
    // ended while we were away.
    onConnect () {
      this.$socket.emit('ON_SCANNER_PAGE')
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
        const code = workno(res.rjcode)
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
    this.$socket.on('SCAN_TASK_ADD', this.onSCAN_TASK_ADD)
    this.$socket.on('SCAN_TASK_LOG', this.onSCAN_TASK_LOG)
    this.$socket.on('SCAN_TASK_REMOVE', this.onSCAN_TASK_REMOVE)
    this.$socket.on('SCAN_FAILED_TASK', this.onSCAN_FAILED_TASK)
    this.$socket.on('SCAN_MAIN_LOG', this.onSCAN_MAIN_LOG)
    this.$socket.on('SCAN_RESULT', this.onSCAN_RESULT)
    this.$socket.on('SCAN_INIT_STATE', this.onSCAN_INIT_STATE)
    this.$socket.on('SCAN_FINISHED', this.onSCAN_FINISHED)
    this.$socket.on('SCAN_ERROR', this.onSCAN_ERROR)
    this.$socket.on('connect', this.onConnect)
    this.$socket.on('success', this.onSuccess)
    this.$socket.on('connect_error', this.onConnectError)
  },

  beforeUnmount () {
    this.$socket.off('SCAN_TASK_ADD', this.onSCAN_TASK_ADD)
    this.$socket.off('SCAN_TASK_LOG', this.onSCAN_TASK_LOG)
    this.$socket.off('SCAN_TASK_REMOVE', this.onSCAN_TASK_REMOVE)
    this.$socket.off('SCAN_FAILED_TASK', this.onSCAN_FAILED_TASK)
    this.$socket.off('SCAN_MAIN_LOG', this.onSCAN_MAIN_LOG)
    this.$socket.off('SCAN_RESULT', this.onSCAN_RESULT)
    this.$socket.off('SCAN_INIT_STATE', this.onSCAN_INIT_STATE)
    this.$socket.off('SCAN_FINISHED', this.onSCAN_FINISHED)
    this.$socket.off('SCAN_ERROR', this.onSCAN_ERROR)
    this.$socket.off('connect', this.onConnect)
    this.$socket.off('success', this.onSuccess)
    this.$socket.off('connect_error', this.onConnectError)
  },
}
</script>