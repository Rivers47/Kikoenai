<template>
  <q-page padding>
    <div class="fit row wrap justify-between items-center q-px-sm q-py-sm">
      <div class="col-lg-6 col-md-6 col-xs-7">
          <q-btn-toggle
            v-model="mode"
            @update:model-value="changeMode"
            spread
            no-caps
            rounded
            toggle-color="primary"
            class="text-bold outline-style"
            :options="modeOptions"
          />
      </div>

      <!-- 排序选项 -->
      <div v-if="mode != 'history'" class="col-auto row">
        <q-select dense rounded outlined v-model="sortBy" :options="sortOptionsWithLabels" option-value="order"/>
        <q-btn
          :disable="sortButtonDisabled"
          dense
          round
          outline
          padding="sm"
          class="q-ml-sm"
          :icon="direction? 'arrow_downward' : 'arrow_upward'"
          @click="switchSortMode"
        />
      </div>

      <!-- 历史模式：隐藏已听完筛选 -->
      <div v-if="mode === 'history'" class="col-auto row">
        <q-btn-toggle
          v-model="hideFinishedFilter"
          @update:model-value="onHideFinishedChange"
          toggle-color="primary"
          rounded
          class="outline-style"
          :options="hideFinishedOptions"
        />
      </div>
    </div>

    <!-- 进度选项，仅在我的进度tab选项中显示-->
    <div
      v-if="mode === 'progress'"
      class="q-px-sm q-pt-md"
    >
      <q-btn-toggle
        v-model="progressFilter"
        @update:model-value="changeProgressFilter"
        toggle-color="primary"
        rounded
        class="outline-style"
        :options="progressOptions"
      />
    </div>

    <!-- 作品列表 -->
    <div>
      <div class="q-px-sm q-pt-md">
        <q-infinite-scroll @load="onLoad" :offset="500" :disable="stopLoad" ref="scroll" v-if="mode !=='folder'">
          <div class="row justify-center text-muted" v-if="works.length === 0">{{ $t('favourites.emptyHint') }}</div>
          <q-list bordered separator class="shadow-2" v-if="works.length">
             <FavListItem v-for="work in works" :key="work.id" :workid="work.id" :metadata="work" @reset="reset()" :mode="mode"></FavListItem> 
          </q-list>
          <template v-slot:loading>
            <div class="row justify-center q-my-md">
              <q-spinner-dots color="primary" size="40px" />
            </div>
          </template>
        </q-infinite-scroll>

        <div v-else class="row justify-center text-muted">{{ $t('favourites.notImplemented') }}</div>
      </div>
    </div>
  </q-page>
</template>

<script>
import FavListItem from 'components/FavListItem'
import NotifyMixin from '../mixins/Notification.js'

export default {
  name: 'Favourites',

  mixins: [NotifyMixin],

  components: {
    FavListItem
  },

  props: {
    route: {
      type: String,
      default: 'review'
    },
    progress: {
      type: String,
      default: 'marked'
    }
  },

  computed: {
    direction () {
      return this.sortMode === 'desc'
    },

    sortButtonDisabled () {
      return this.sortBy.order === 'allage' || this.sortBy.order === 'nsfw'
    },

    modeOptions () {
      return [
        { label: this.$t('favourites.playHistory'), value: 'history' },
        { label: this.$t('favourites.myReviews'), value: 'review' },
        { label: this.$t('favourites.myProgress'), value: 'progress' },
        { label: this.$t('favourites.folder'), value: 'folder' },
      ]
    },

    hideFinishedOptions () {
      return [
        { label: this.$t('favourites.hideFinished'), value: 'listened' },
        { label: this.$t('favourites.all'), value: 'all' },
      ]
    },

    progressOptions () {
      return [
        { label: this.$t('favourites.marked'), value: 'marked' },
        { label: this.$t('favourites.listening'), value: 'listening' },
        { label: this.$t('favourites.listened'), value: 'listened' },
        { label: this.$t('favourites.replay'), value: 'replay' },
        { label: this.$t('favourites.postponed'), value: 'postponed' },
      ]
    },

    sortOptionsWithLabels () {
      const labels = {
        updated_at: this.$t('favourites.sortByUpdatedAt'),
        userRating: this.$t('favourites.sortByRating'),
        release: this.$t('favourites.sortByRelease'),
        review_count: this.$t('favourites.sortByReviewCount'),
        dl_count: this.$t('favourites.sortByDlCount'),
        allage: this.$t('favourites.sortByAllAge'),
        nsfw: this.$t('favourites.sortByNsfw'),
      }
      return Object.keys(labels).map(order => ({ label: labels[order], order }))
    },
  },

  data() {
    return {
      mode: 'history',
      progressFilter: 'marked',
      hideFinishedFilter: localStorage.hideFinishedHistory || 'listened',
      works: [],
      stopLoad: false,
      pagination: { currentPage:0, pageSize:12, totalCount:0 },
      sortMode: 'desc',
      sortBy: {
          label: '',
          order: 'updated_at'
        },
    }
  },

  created() {
    this.mode = this.route;
    this.progressFilter = this.progress;
  },

  mounted() {
    if (localStorage.sortByFavourites) {
      try {
        this.sortBy = JSON.parse(localStorage.sortByFavourites);
      } catch {
        localStorage.removeItem('sortByFavourites');
      }
    }
  },

  watch: {
    sortBy(newSortOptionSetting) {
      localStorage.sortByFavourites = JSON.stringify(newSortOptionSetting);
      this.reset();
    },

    sortMode() {
      this.reset();
    },

    // Browser back and forth
    route() {
      this.mode = this.route;
      this.reset();
    },
    progress() {
      this.progressFilter = this.progress;
      this.reset();
    }
  },

  methods: {
    // Split two-way binding
    changeMode(newMode) {
      this.$router.push(`/favourites/${newMode}`);
      this.reset();
    },

    // Split two-way binding
    changeProgressFilter(newFilter) {
      this.$router.push(`/favourites/progress/${newFilter}`);
      this.reset();
    },

    switchSortMode() {
      if(this.sortMode ==='desc') {
        this.sortMode = 'asc'
      } else {
        this.sortMode = 'desc'
      }
    },

    onLoad (index, done) {
      this.requestWorksQueue()
        .then(() => done())
    },

    reset () {
      // Freeze the scroller first
      this.stopLoad = true
      this.pagination = { currentPage:0, pageSize:12, totalCount:0 }
      // Clear stale works synchronously so the new mode's template doesn't
      // render items from the previous mode that lack the required fields
      // (e.g. review items have no `state`, which history mode accesses).
      this.works = []
      // Manually fetch first page content before enable scroller
      // Note: the internal API of the infinite scroller does not work well
      this.requestWorksQueue()
        .then(() => {
          this.stopLoad = false
        })
    },

    requestWorksQueue () {
      const params = {
        page: this.pagination.currentPage + 1 || 1
      }

      // History mode has no sort UI (it's always most-recent-first server-side);
      // don't leak the persisted review-mode sort options into /api/history.
      if (this.mode !== 'history') {
        params.order = this.sortBy.order
        params.sort = this.sortMode

        if (this.sortBy.order === 'allage') {
          params.order = 'nsfw'
          params.sort = 'asc'
        }

        if (this.sortBy.order === 'nsfw') {
          params.order = 'nsfw'
          params.sort = 'desc'
        }
      }

      if (this.mode === 'progress') {
        params.filter = this.progressFilter;
      }

      if (this.mode === 'history') {
        params.excludeFinished = this.hideFinishedFilter;
      }

      const requestUrl = this.mode == 'history' ? "/api/history" : '/api/review'
      return this.$axios.get(requestUrl, { params })
        .then((response) => {                  
          const works = response.data.works
          this.works = (params.page === 1) ? works.concat() : this.works.concat(works)
          this.pagination = response.data.pagination

          if (this.works.length >= this.pagination.totalCount) {
            this.stopLoad = true
          }
        })
        .catch((error) => {
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
    },

    onHideFinishedChange (newValue) {
      localStorage.hideFinishedHistory = newValue
      this.hideFinishedFilter = newValue
      this.reset()
    },
  }
}
</script>

<style scoped>
.outline-style {
  border: 1px solid var(--q-color-primary);
}
</style>
