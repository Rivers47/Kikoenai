<template>
  <div>
    <q-dialog v-model="showDialog" persistent @hide="closeDialog">
      <q-card style="width: 600px; max-width: 90vw">
        <q-card-section class="q-pb-none">
          <div class="text-body1">{{ $t('transcribetracks.title') }}</div>
          <div class="text-caption text-grey">{{ $t('transcribetracks.hint') }}</div>
        </q-card-section>

        <q-card-section v-if="rows.length" class="q-py-none">
          <q-expansion-item dense icon="tune" :label="$t('transcribetracks.options')">
            <q-input
              v-model="query"
              filled
              dense
              clearable
              :disable="running"
              :label="$t('transcribetracks.queryLabel')"
              :hint="$t('transcribetracks.queryHint')"
              class="q-mb-sm"
            />
            <q-checkbox
              v-model="overwrite"
              dense
              :disable="running"
              :label="$t('transcribetracks.overwrite')"
            />
          </q-expansion-item>
        </q-card-section>

        <q-card-section v-if="rows.length" class="q-py-none">
          <q-checkbox
            v-model="allSelected"
            dense
            :disable="running"
            :label="$t('transcribetracks.selectAll', { count: selected.length })"
          />
        </q-card-section>

        <q-card-section v-if="note" class="q-py-sm">
          <div class="text-caption text-warning">{{ note }}</div>
        </q-card-section>

        <q-card-section class="scroll" style="max-height: 50vh">
          <div v-if="loading" class="text-center q-pa-md"><q-spinner size="2em" color="primary" /></div>
          <div v-else-if="!rows.length" class="text-grey">{{ $t('transcribetracks.noAudio') }}</div>

          <q-item
            v-for="row in rows"
            :key="row.relPath"
            v-ripple
            dense
            clickable
            :disable="running"
            class="q-px-none"
            @click="toggle(row.relPath)"
          >
            <q-item-section side class="q-pr-sm">
              <q-checkbox
                v-model="selected"
                :val="row.relPath"
                :disable="running"
                dense
                @click.stop
              />
            </q-item-section>
            <q-item-section avatar style="min-width: 32px">
              <q-spinner v-if="row.status === 'running'" size="1.5em" color="primary" />
              <q-icon
                v-else-if="statusIcon(row.status)"
                :name="statusIcon(row.status).icon"
                :color="statusIcon(row.status).color"
              />
            </q-item-section>
            <q-item-section>
              <q-item-label class="ellipsis">{{ row.relPath }}</q-item-label>
              <q-item-label v-if="row.status" caption :class="row.status === 'failed' ? 'text-negative' : ''">
                {{ row.error || $t(`transcribetracks.status.${row.status}`) }}
              </q-item-label>
            </q-item-section>
          </q-item>
        </q-card-section>

        <div class="row justify-between">
          <q-card-actions align="left">
            <q-btn flat :label="$t('common.close')" :disable="running" @click="closeDialog()" />
          </q-card-actions>
          <q-card-actions align="right" class="text-primary">
            <q-btn v-if="running" flat color="negative" :label="$t('common.cancel')" @click="cancel()" />
            <q-btn
              v-else
              flat
              icon="record_voice_over"
              :label="$t('transcribetracks.start')"
              :disable="!selected.length"
              @click="start()"
            />
          </q-card-actions>
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script>
import NotifyMixin from '../mixins/Notification.js'

// A row with no status draws nothing: a placeholder circle reads as an
// unselected radio button next to the real checkbox.
const STATUS_ICON = {
  written: { icon: 'check_circle', color: 'positive' },
  skipped: { icon: 'remove_circle_outline', color: 'grey' },
  empty: { icon: 'volume_off', color: 'grey' },
  failed: { icon: 'error', color: 'negative' }
}

export default {
  name: 'TranscribeTracks',

  mixins: [NotifyMixin],

  props: {
    metadata: {
      type: Object,
      required: true
    }
  },

  data() {
    return {
      showDialog: true,
      loading: true,
      running: false,
      rows: [],
      selected: [],
      // Blank means the server's configured value, which is never sent to
      // the browser -- publicConfig exposes a boolean alone.
      query: '',
      overwrite: false,
      note: ''
    }
  },

  computed: {
    // null renders the indeterminate dash.
    allSelected: {
      get() {
        if (!this.selected.length) return false
        return this.selected.length === this.rows.length ? true : null
      },
      set(value) {
        this.selected = value ? this.rows.map(row => row.relPath) : []
      }
    }
  },

  mounted() {
    this.fetchTracks()

    this.$socket.on('TRANSCRIBE_PROGRESS', this.onProgress)
    this.$socket.on('TRANSCRIBE_RESULT', this.onResult)
    this.$socket.on('TRANSCRIBE_ERROR', this.onError)
    this.$socket.on('disconnect', this.onSocketDisconnect)
  },

  beforeUnmount() {
    this.$socket.off('TRANSCRIBE_PROGRESS', this.onProgress)
    this.$socket.off('TRANSCRIBE_RESULT', this.onResult)
    this.$socket.off('TRANSCRIBE_ERROR', this.onError)
    this.$socket.off('disconnect', this.onSocketDisconnect)
  },

  methods: {
    toggle(relPath) {
      if (this.running) return
      const index = this.selected.indexOf(relPath)
      if (index === -1) this.selected.push(relPath)
      else this.selected.splice(index, 1)
    },

    statusIcon(status) {
      return STATUS_ICON[status] || null
    },

    // Opened from the metadata dialog, which has no file tree of its own. The
    // server walks the same list, so rows match up by relPath.
    fetchTracks() {
      this.$axios.get(`/api/tracks/${this.metadata.id}`)
        .then((response) => {
          this.rows = this.flattenAudio(response.data.tree || response.data, [])
          // The server skips tracks that already have a subtitle anyway.
          this.selected = this.rows.map(row => row.relPath)
        })
        .catch((error) => {
          if (error.response) {
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
        .finally(() => {
          this.loading = false
        })
    },

    flattenAudio(nodes, prefix) {
      const rows = []
      for (const node of nodes) {
        if (node.type === 'folder') {
          rows.push(...this.flattenAudio(node.children || [], prefix.concat(node.title)))
        } else if (node.type === 'audio') {
          rows.push({ relPath: node.relPath, status: '', error: '' })
        }
      }
      return rows
    },

    /**
     * Lazily, on first run: the handshake rejects any account but admin, so
     * connecting app-wide would error for every ordinary user. As in
     * EditTrackTitles.
     */
    ensureSocket() {
      if (this.$socket.connected) return Promise.resolve()

      return new Promise((resolve, reject) => {
        const cleanup = () => {
          this.$socket.off('connect', onConnect)
          this.$socket.off('connect_error', onError)
        }
        const onConnect = () => { cleanup(); resolve() }
        const onError = (err) => { cleanup(); reject(err) }

        this.$socket.on('connect', onConnect)
        this.$socket.on('connect_error', onError)
        this.$socket.connect()
      })
    },

    /**
     * Over Socket.IO, not a request: a work runs for minutes to hours.
     * Progress arrives per track in onProgress.
     */
    start() {
      this.running = true
      this.note = ''
      this.rows.forEach((row) => { row.status = ''; row.error = '' })

      this.ensureSocket()
        .then(() => {
          this.$socket.emit('TRANSCRIBE_WORK', {
            workId: this.metadata.id,
            relPaths: this.selected,
            // Raw; asr.js escapes it, so hotwords can be typed as-is.
            query: (this.query || '').trim(),
            overwrite: this.overwrite
          })
        })
        .catch((error) => {
          this.running = false
          this.showErrNotif(error.message || error)
        })
    },

    cancel() {
      this.$socket.emit('TRANSCRIBE_CANCEL')
    },

    // Echoed back, so a reply for another open dialog is ignored.
    onProgress({ workId, relPath, status, error }) {
      if (workId !== this.metadata.id) return
      const row = this.rows.find(candidate => candidate.relPath === relPath)
      if (!row) return
      row.status = status
      row.error = error || ''
    },

    onResult({ workId, written, skipped, failed, empty, overlay, cancelled }) {
      if (workId !== this.metadata.id) return
      this.running = false

      const notes = []
      if (cancelled) notes.push(this.$t('transcribetracks.cancelled'))
      // Where the files landed: the point of writing beside the audio is that
      // they are findable for a typo fix.
      if (overlay) notes.push(this.$t('transcribetracks.wroteOverlay', { count: overlay }))
      if (failed) notes.push(this.$t('transcribetracks.someFailed', { count: failed }))
      this.note = notes.join(' ')

      this.showSuccNotif(this.$t('transcribetracks.done', { written, skipped, empty }))
      if (written) this.$emit('saved')
    },

    onError({ workId, error }) {
      if (workId !== this.metadata.id) return
      this.running = false
      this.showErrNotif(error)
    },

    // A dropped socket aborts the run server-side too.
    onSocketDisconnect() {
      if (!this.running) return
      this.running = false
      this.showErrNotif(this.$t('transcribetracks.disconnected'))
    },

    closeDialog() {
      this.showDialog = false
      this.$emit('closed')
    }
  }
}
</script>
