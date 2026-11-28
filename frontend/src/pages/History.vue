<template>
  <q-page padding>
    <div class="fit row wrap justify-between items-center q-px-sm q-py-sm">
      <div class="text-h5 text-weight-regular q-pa-xs">{{ t('history.title') }}</div>

      <div class="col-auto row items-center">
        <!-- 年龄分级 -->
        <q-select
          dense
          rounded
          outlined
          transition-show="scale"
          transition-hide="scale"
          v-model="ratingOption"
          :options="ratingOptions"
          :option-label="humanReadableLabel"
          :label="t('history.rating')"
          class="col-auto"
        />

        <q-btn-toggle
          v-model="hideFinishedFilter"
          toggle-color="primary-container"
          toggle-text-color="on-primary-container"
          color="surface-container-lowest"
          text-color="on-surface"
          rounded
          class="outline-style q-ml-sm"
          :options="hideFinishedOptions"
        />
      </div>
    </div>

    <div class="q-px-sm q-pt-md">
      <q-infinite-scroll @load="onLoad" :offset="500" :disable="stopLoad">
        <div class="row justify-center text-muted" v-if="works.length === 0">{{ t('history.emptyHint') }}</div>
        <q-list bordered separator v-if="works.length">
          <FavListItem v-for="work in works" :key="work.id" :workid="work.id" :metadata="work" />
        </q-list>
        <template v-slot:loading>
          <div class="row justify-center q-my-md">
            <q-spinner-dots color="primary" size="40px" />
          </div>
        </template>
      </q-infinite-scroll>
    </div>
  </q-page>
</template>

<script>
import { useI18n } from 'vue-i18n'
import FavListItem from 'components/FavListItem'
import NotifyMixin from '../mixins/Notification.js'

// Read into the initial state: restoring these in mounted() sent a first request
// with the defaults, so that response could win over the stored settings.
const stored = (key) => localStorage.getItem(key)

export default {
  setup () {
    const { t } = useI18n() // global scope
    return { t }
  },
  name: 'History',

  mixins: [NotifyMixin],

  components: {
    FavListItem
  },

  data () {
    return {
      ratingOption: stored('historyRatingOption') || 'all',
      hideFinishedFilter: stored('hideFinishedHistory') || 'listened',
      works: [],
      stopLoad: false,
      pagination: { currentPage: 0, pageSize: 12, totalCount: 0 },
      // Bumped by reset(); a response from an older generation is dropped, so a
      // slow page from the previous filter can never repaint the current list.
      _generation: 0,
      _inFlight: null,
    }
  },

  computed: {
    ratingOptions () {
      return ['all', 'sfw', 'nsfw']
    },

    hideFinishedOptions () {
      return [
        { label: this.t('history.hideFinished'), value: 'listened' },
        { label: this.t('history.all'), value: 'all' },
      ]
    },
  },

  // The page is kept alive so that returning from a work restores both the
  // loaded list and the scroll position. While cached the component stays
  // mounted, so the infinite scroller has to be frozen explicitly — otherwise
  // it reacts to scrolling on whatever page is actually visible.
  activated () {
    this.$nextTick(() => {
      if (this.works.length < this.pagination.totalCount) {
        this.stopLoad = false
      }
    })
  },

  deactivated () {
    this.stopLoad = true
  },

  watch: {
    ratingOption (v) {
      localStorage.historyRatingOption = v
      this.reset()
    },

    hideFinishedFilter (v) {
      localStorage.hideFinishedHistory = v
      this.reset()
    },
  },

  methods: {
    humanReadableLabel (option) {
      switch (option) {
        case 'sfw': return this.t('history.ratingAllAges')
        case 'nsfw': return this.t('history.ratingAdult')
        default: return this.t('history.ratingAll')
      }
    },

    onLoad (index, done) {
      this.requestWorksQueue()
        .then(() => done())
    },

    reset () {
      this._generation += 1
      this._inFlight = null
      this.stopLoad = true
      this.works = []
      this.pagination = { currentPage: 0, pageSize: 12, totalCount: 0 }
      this.requestWorksQueue()
    },

    // Concurrent callers join the pending request instead of asking for the same
    // page twice; `page` is read once here so a late response cannot rewrite it.
    requestWorksQueue () {
      if (this._inFlight) return this._inFlight

      const generation = this._generation
      const page = this.pagination.currentPage + 1
      const params = {
        page,
        excludeFinished: this.hideFinishedFilter,
      }
      if (this.ratingOption !== 'all') {
        params.rating = this.ratingOption
      }

      this._inFlight = this.$axios.get('/api/history', { params })
        .then((response) => {
          if (generation !== this._generation) return

          const works = response.data.works
          this.works = (page === 1) ? works.concat() : this.works.concat(works)
          this.pagination = response.data.pagination
          this.stopLoad = this.works.length >= this.pagination.totalCount
        })
        .catch((error) => {
          if (generation !== this._generation) return

          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            if (error.response.status !== 401) {
              this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
            }
          } else {
            this.showErrNotif(error.message || error)
          }
          this.stopLoad = true
        })
        .finally(() => {
          if (generation === this._generation) this._inFlight = null
        })

      return this._inFlight
    },
  }
}
</script>

<style scoped>
.outline-style {
  border: 1px solid var(--q-color-primary);
}
</style>
