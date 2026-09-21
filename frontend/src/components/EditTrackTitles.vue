<template>
  <div>
    <q-dialog v-model="showDialog" @hide="closeDialog">
      <q-card style="width: 600px; max-width: 90vw">
        <q-card-section class="q-pb-none">
          <div class="text-body1">{{ $t('edittracktitles.title') }}</div>
          <div class="text-caption text-grey">{{ $t('edittracktitles.hint') }}</div>
        </q-card-section>

        <q-card-section v-if="rows.length" class="q-py-none">
          <q-expansion-item dense icon="playlist_add" :label="$t('edittracktitles.fillFromList')">
            <q-input
              v-model="trackList"
              type="textarea"
              filled
              dense
              autogrow
              input-style="max-height: 20vh"
              :label="$t('edittracktitles.trackListLabel')"
              class="q-mb-sm"
            />
            <q-select
              v-if="folders.length > 1"
              v-model="selectedFolders"
              :options="folderOptions"
              :label="$t('edittracktitles.applyTo')"
              filled
              dense
              multiple
              emit-value
              map-options
              class="q-mb-sm"
            />
            <div v-if="suggestNote" class="text-caption text-warning q-mb-sm">{{ suggestNote }}</div>
            <q-btn
              v-if="llmConfigured"
              flat
              dense
              icon="auto_awesome"
              :label="$t('edittracktitles.suggest')"
              :loading="suggesting"
              @click="suggest()"
            />
            <q-btn
              flat
              dense
              color="primary"
              :label="$t('edittracktitles.apply')"
              :disable="!trackList.trim() || !selectedFolders.length"
              @click="applyTrackList()"
            />
          </q-expansion-item>
        </q-card-section>

        <q-card-section class="scroll" style="max-height: 50vh">
          <div v-if="loading" class="text-center q-pa-md"><q-spinner size="2em" color="primary" /></div>
          <div v-else-if="!rows.length" class="text-grey">{{ $t('edittracktitles.noAudio') }}</div>

          <div v-for="group in folders" :key="group.folder">
            <div class="text-subtitle2 q-mb-sm ellipsis">
              <q-icon name="folder" color="info" class="q-mr-xs" />{{ group.folder || $t('edittracktitles.rootFolder') }}
            </div>
            <q-input
              v-for="row in group.rows"
              :key="row.relPath"
              v-model="row.value"
              :label="row.title"
              filled
              dense
              clearable
              class="q-mb-sm"
            />
          </div>
        </q-card-section>

        <div class="row justify-between">
          <q-card-actions align="left">
            <q-btn flat :label="$t('common.cancel')" @click="closeDialog()" />
          </q-card-actions>
          <q-card-actions align="right" class="text-primary">
            <q-btn flat :label="$t('common.save')" :loading="saving" @click="submit()" />
          </q-card-actions>
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script>
import NotifyMixin from '../mixins/Notification.js'

export default {
  name: 'EditTrackTitles',

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
      saving: false,
      rows: [],
      trackList: '',
      selectedFolders: [],
      llmConfigured: false,
      suggesting: false,
      suggestNote: ''
    }
  },

  computed: {
    // One group per distinct folder, shallowest first. Grouped by folder
    // rather than by adjacent run because the tree interleaves files and
    // folders, so one folder's rows are not always contiguous.
    //
    // Depth order puts the root and the top-level folders at the top, which is
    // what a track list usually describes -- a deep folder is more often
    // extras, an SE variant or a bonus. sort() is stable, so folders at the
    // same depth keep disk order.
    folders() {
      const depth = folder => (folder ? folder.split('/').length : 0)
      const byFolder = new Map()
      for (const row of this.rows) {
        if (!byFolder.has(row.folder)) byFolder.set(row.folder, [])
        byFolder.get(row.folder).push(row)
      }
      return [...byFolder]
        .map(([folder, rows]) => ({ folder, rows }))
        .sort((a, b) => depth(a.folder) - depth(b.folder))
    },

    folderOptions() {
      return this.folders.map(group => ({
        label: group.folder || this.$t('edittracktitles.rootFolder'),
        value: group.folder
      }))
    }
  },

  mounted() {
    this.fetchTracks()
    // Only offer the suggester when the server has an endpoint to call. The
    // flag is a boolean on purpose -- the LLM settings are env-only so that no
    // key can reach a browser (backend/track-titles.js).
    this.$axios.get('/api/config/shared')
      .then((response) => {
        this.llmConfigured = Boolean(response.data.sharedConfig.llmConfigured)
      })
      .catch(() => {})

    this.$socket.on('SUGGEST_TRACK_TITLES_RESULT', this.onSuggestResult)
    this.$socket.on('SUGGEST_TRACK_TITLES_ERROR', this.onSuggestError)
    // A dropped socket is the one way the reply never arrives: the server side
    // always answers, since callModel carries its own timeout.
    this.$socket.on('disconnect', this.onSocketDisconnect)
  },

  beforeUnmount() {
    this.$socket.off('SUGGEST_TRACK_TITLES_RESULT', this.onSuggestResult)
    this.$socket.off('SUGGEST_TRACK_TITLES_ERROR', this.onSuggestError)
    this.$socket.off('disconnect', this.onSocketDisconnect)
  },

  methods: {
    // Opened from the metadata dialog, which has no file tree of its own, so
    // this reads one. Same endpoint Work.vue uses; trackProgress is ignored.
    fetchTracks() {
      this.$axios.get(`/api/tracks/${this.metadata.id}`)
        .then((response) => {
          this.rows = this.flattenAudio(response.data.tree || response.data, [])
          this.selectedFolders = this.folders.map(group => group.folder)
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
          rows.push({
            relPath: node.relPath,
            title: node.title,
            folder: prefix.join('/'),
            original: node.trackTitle || '',
            value: node.trackTitle || ''
          })
        }
      }
      return rows
    },

    /**
     * Connect the shared Socket.IO client if nothing has yet.
     *
     * Lazily, on the first suggest rather than on mount or in MainLayout: the
     * handshake in backend/socket.js rejects any account but admin when auth
     * is on, so connecting app-wide would throw an error notification at every
     * ordinary user. Nothing disconnects it afterwards, matching
     * DashboardLayout.
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
     * Ask the server to read the track list out of the work's description.
     *
     * Over Socket.IO, not a request: a local model regularly takes longer to
     * answer than a reverse proxy will hold one open. The reply arrives in
     * onSuggestResult.
     *
     * It fills the textarea rather than the rows -- the result is a proposal,
     * and which folders it belongs to is still the caller's call.
     */
    suggest() {
      this.suggesting = true
      this.suggestNote = ''
      this.ensureSocket()
        .then(() => {
          this.$socket.emit('SUGGEST_TRACK_TITLES', { workId: this.metadata.id })
        })
        .catch((error) => {
          this.suggesting = false
          this.showErrNotif(error.message || error)
        })
    },

    // The work id is echoed back so a reply meant for another open dialog --
    // or for a work this one has since moved off -- is ignored.
    onSuggestResult({ workId, titles, trackCount, unverified }) {
      if (workId !== this.metadata.id) return
      this.suggesting = false
      this.trackList = titles.join('\n')

      if (!titles.length) {
        this.showWarnNotif(this.$t('edittracktitles.suggestEmpty'))
        return
      }

      // Two separate things to warn about, and both can be true at once.
      // A short list means positional fill will stop early; unverified titles
      // mean the model reworded or invented rather than copied, which is the
      // usual failing of a small local model.
      const notes = []
      if (titles.length !== trackCount) {
        notes.push(this.$t('edittracktitles.suggestPartial', {
          count: titles.length,
          total: trackCount
        }))
      }
      if (unverified) {
        notes.push(this.$t('edittracktitles.suggestUnverified', { count: unverified }))
      }
      this.suggestNote = notes.join(' ')
    },

    onSuggestError({ workId, error }) {
      if (workId !== this.metadata.id) return
      this.suggesting = false
      this.showErrNotif(error)
    },

    onSocketDisconnect() {
      if (!this.suggesting) return
      this.suggesting = false
      this.showErrNotif(this.$t('edittracktitles.suggestDisconnected'))
    },

    /**
     * Fill each chosen folder from the top of the list: line 1 onto that
     * folder's first track, line 2 onto its second, and so on.
     *
     * Positional rather than matched per filename, because a variant folder
     * (NO_SE, a wav copy) holds the same tracks in the same order under the
     * same names -- so one list serves every folder carrying it, and a folder
     * the list does not describe is left unselected. Extra lines and extra
     * files both just go unused; nothing is written until Save.
     */
    applyTrackList() {
      // Blank lines are paste noise, and keeping them would shift every title
      // after the gap onto the wrong file.
      const titles = this.trackList.split('\n').map(line => line.trim()).filter(Boolean)
      if (!titles.length) return

      let filled = 0
      for (const group of this.folders) {
        if (!this.selectedFolders.includes(group.folder)) continue
        group.rows.forEach((row, index) => {
          if (index < titles.length) {
            row.value = titles[index]
            filled += 1
          }
        })
      }

      this.showSuccNotif(this.$t('edittracktitles.filled', { count: filled }))
    },

    closeDialog() {
      this.$emit('closed')
    },

    submit() {
      // Only changed rows: setTrackTitles issues one UPDATE per entry, and an
      // untouched track needs no write. Keyed by relPath, one object of
      // editable fields each -- the endpoint addresses the work's file rows,
      // not track titles specifically.
      const files = {}
      for (const row of this.rows) {
        const value = (row.value || '').trim()
        if (value !== row.original) files[row.relPath] = { trackTitle: value }
      }

      if (!Object.keys(files).length) {
        this.closeDialog()
        return
      }

      this.saving = true
      this.$axios.put(`/api/work/${this.metadata.id}/file-metadata`, { files })
        .then(() => {
          this.showSuccNotif(this.$t('edittracktitles.saveSuccess'))
          this.$emit('saved')
        })
        .catch((error) => {
          if (error.response) {
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
        .finally(() => {
          this.saving = false
        })
    }
  }
}
</script>

<style lang="sass" scoped>
.scroll
  overflow-y: auto
</style>
