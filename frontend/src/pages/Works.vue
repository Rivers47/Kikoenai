<template>
  <div>
    <!--没有搜索的情况下，显示最近播放作品-->
    <RecentWorks v-if="searchMetas.length == 0" />

    <div class="q-mt-lg q-ml-md row items-center">
      <span class="text-h5 text-weight-regular q-pa-xs relative-position">
        {{pageTitle}}
        <q-badge color="secondary" text-color="on-secondary" floating>{{pagination.totalCount}}</q-badge>
      </span>
      <div> <!--普通搜索模式的信息展示-->
        <!-- A filter is a list of terms, so it is shown as one removable chip
             each rather than as the raw query string. -->
        <FilterTerms
          v-if="$route.query.filter"
          :filter="$route.query.filter"
          @update:filter="applyFilter"
        />
        <q-badge v-else class="q-ma-xs" v-for="meta, index in searchMetas" :key="meta">{{ index == 0 ? "":"," }} {{ meta }}</q-badge>
      </div>
    </div>

    <div
      ref="toolbar"
      class="sticky-toolbar row justify-between bg-surface q-px-sm q-py-sm q-mt-sm"
      :class="{ 'sticky-toolbar--stuck': toolbarStuck }"
    >
      <!-- 排序属性 -->
      <q-select
        dense
        rounded
        outlined
        bg-color=""
        transition-show="scale"
        transition-hide="scale"
        v-model="sortCategoryOption"
        :options="sortCategoryOptions"
        :option-label="humanReadableLabel"
        :label="t('works.sortBy')"
        class="col-auto"
      />

      <!-- 筛选：年龄分级与播放状态为两组独立条件，全部勾选等于不筛选 -->
      <q-btn
        dense
        round
        outline
        padding="sm"
        icon="filter_list"
        class="col-auto"
        :aria-label="t('works.filter')"
      >
        <q-badge
          v-if="excludedFilterCount"
          color="primary"
          text-color="on-primary"
          floating
        >{{ excludedFilterCount }}</q-badge>
        <q-tooltip>{{ t('works.filter') }}</q-tooltip>
        <q-menu anchor="bottom left" self="top left">
          <q-list dense style="min-width: 240px">
            <q-item v-for="option in ratingFilterOptions" :key="option.value" tag="label" dense>
              <q-item-section side>
                <q-checkbox v-model="filters" :val="option.value" />
              </q-item-section>
              <q-item-section>{{ option.label }}</q-item-section>
            </q-item>

            <q-separator />

            <q-item v-for="option in statusFilterOptions" :key="option.value" tag="label" dense>
              <q-item-section side>
                <q-checkbox v-model="filters" :val="option.value" />
              </q-item-section>
              <q-item-section>{{ option.label }}</q-item-section>
            </q-item>

            <q-separator />

            <q-item v-for="option in reviewFilterOptions" :key="option.value" tag="label" dense>
              <q-item-section side>
                <q-checkbox v-model="filters" :val="option.value" />
              </q-item-section>
              <q-item-section>{{ option.label }}</q-item-section>
            </q-item>
          </q-list>
        </q-menu>
      </q-btn>

      <!-- 排序顺序 -->
      <q-toggle v-model="sortInDesc" :label="sortInDesc ? t('works.desc') : t('works.asc')" />

      <!-- 切换显示模式按钮 -->
      <q-btn-toggle
        dense
        spread
        rounded
        v-model="listMode"
        toggle-color="primary-container"
        toggle-text-color="on-primary-container"
        color="surface-container-lowest"
        text-color="on-surface"
        :options="[
          { icon: 'apps', value: false },
          { icon: 'list', value: true }
        ]"
        style="width: 85px;"
        class="col-auto"
      />

      <q-btn-toggle
        dense
        spread
        rounded
        v-model="showLabel"
        toggle-color="primary-container"
        toggle-text-color="on-primary-container"
        color="surface-container-lowest"
        text-color="on-surface"
        :options="[
          { icon: 'label', value: true },
          { icon: 'label_off', value: false }
        ]"
        style="width: 85px;"
        class="col-auto"
        v-if="$q.screen.width > 700 && listMode"
      />

      <q-btn-toggle
        dense
        spread
        rounded
        :disable="$q.screen.width < 1120"
        v-model="detailMode"
        toggle-color="primary-container"
        toggle-text-color="on-primary-container"
        color="surface-container-lowest"
        text-color="on-surface"
        :options="[
          { icon: 'zoom_in', value: true },
          { icon: 'zoom_out', value: false },
        ]"
        style="width: 85px;"
        class="col-auto"
        v-if="$q.screen.width > 700 && !listMode"
      />

    </div>

    <div :class="`row justify-center ${listMode ? 'list' : 'q-mx-md'}`">
      <q-infinite-scroll @load="onLoad" :offset="500" :disable="stopLoad" class="col">

        <q-list v-if="listMode" class="bg-surface-container-low separator">
          <WorkListItem v-for="work in works" :key="work.id" :metadata="work" :showLabel="showLabel && $q.screen.width > 700" />
        </q-list>

        <!--解决android平台hover事件不像safari那样及时响应的问题，需要手动添加触摸响应时间-->
        <!--TODO: verify this-->
        <div v-else-if="$q.platform.is.android && $q.platform.has.touch" class="row q-col-gutter-x-md q-col-gutter-y-lg">
          <div class="col-xs-12 col-sm-6 col-md-4" v-for="work in works" :key="work.id"
            @touchstart="()=>onWorkCardTouch(work.id)"
            :class="detailMode ? 'col-lg-3 col-xl-2': 'col-lg-2 col-xl-2'"
            :style="{ '--sim-hover-work-card': work.id === touchedWorkId ? '1' : '0'}"
          >
            <WorkCard :metadata="work" :thumbnailMode="!detailMode" :oldStyle="oldWorkCardUIStyle" class="fit"/>
          </div>
        </div>

        <!--正常的workCard展示-->
        <div v-else class="row q-col-gutter-x-md q-col-gutter-y-lg">
          <div class="col-xs-12 col-sm-6 col-md-4" v-for="work in works" :key="work.id"
            :class="detailMode ? 'col-lg-3 col-xl-2': 'col-lg-2 col-xl-2'"
            style="--sim-hover-work-card: 0"
          >
            <WorkCard :metadata="work" :thumbnailMode="!detailMode" :oldStyle="oldWorkCardUIStyle" class="fit bg-surface-container-low"/>
          </div>
        </div>

        <div v-show="stopLoad" class="q-mt-lg q-mb-xl text-h6 text-bold text-center">{{ t('works.noMoreWorks') }}</div>

        <template v-slot:loading>
          <div class="row justify-center q-my-md">
            <q-spinner-dots color="primary" size="40px" />
          </div>
        </template>
      </q-infinite-scroll>
    </div>
  </div>
</template>

<script>
import { useI18n } from 'vue-i18n'
import WorkCard from 'components/WorkCard'
import WorkListItem from 'components/WorkListItem'
import NotifyMixin from '../mixins/Notification.js'
import RecentWorks from 'src/components/RecentWorks'
import { mapState } from 'vuex'
import FilterTerms from 'components/FilterTerms'

// Read into the initial state: restoring these in mounted() sent a first request
// with the defaults, so that response could win over the stored settings.
const stored = (key) => localStorage.getItem(key)
const storedBool = (key, fallback) => {
  const raw = stored(key)
  return raw === null || raw === '' ? fallback : raw === 'true'
}

// Orthogonal dropdown groups: a work matches if its rating is one of the ticked
// ratings AND its progress is one of the ticked states.
const RATING_FILTERS = ['sfw', 'nsfw']
const STATUS_FILTERS = ['marked', 'listened', 'postponed', 'unmarked']
// Star or review text — deliberately not progress, which has its own group, so
// the two axes stay independent: a work can be 想听 and unstarred.
const REVIEW_FILTERS = ['has', 'none']
const FILTER_GROUPS = [RATING_FILTERS, STATUS_FILTERS, REVIEW_FILTERS]
const ALL_FILTERS = FILTER_GROUPS.flat()

// A group with nothing ticked can never match, so "empty group" means either the
// user emptied it or it did not exist yet when this array was saved; start it
// fully ticked either way, which is also what makes an added group safe.
const withGroupsFilled = (values) => {
  const filled = [...values]
  for (const group of FILTER_GROUPS) {
    if (!group.some((value) => filled.includes(value))) filled.push(...group)
  }
  return filled
}

// The filter started life as a single age-rating select stored as 'nsfw_0|1|2';
// keep the rating a user had picked rather than resetting them to everything.
const storedFilters = () => {
  const raw = stored('worksFilter')
  if (raw) {
    try {
      const saved = JSON.parse(raw)
      if (Array.isArray(saved)) {
        const known = saved.filter((v) => ALL_FILTERS.includes(v))
        // An empty array is the user unticking everything; anything unrecognised
        // means this is not our format, so fall through to the defaults.
        if (known.length || !saved.length) return withGroupsFilled(known)
      }
    } catch {
      localStorage.removeItem('worksFilter')
    }
  }
  const legacy = stored('nsfwOption')
  if (legacy === 'nsfw_1') return withGroupsFilled(['sfw'])
  if (legacy === 'nsfw_2') return withGroupsFilled(['nsfw'])
  return [...ALL_FILTERS]
}

export default {
  setup () {
    const { t } = useI18n() // global scope
    return { t }
  },
  name: 'Works',

  mixins: [NotifyMixin],

  components: {
    WorkCard,
    WorkListItem,
    RecentWorks,
    FilterTerms,
  },

  data () {
    return {
      listMode: storedBool('listMode', false),
      showLabel: storedBool('showLabel', true),
      detailMode: storedBool('detailMode', true),
      stopLoad: false,
      works: [],
      page: 1,
      pagination: { currentPage:0, pageSize:12, totalCount:0 },
      seed: 7, // random sort

      // 排序种类，例如可以选择按照发售日期来排序结果
      sortCategoryOption: stored('sortCategoryOption') || "release",
      sortCategoryOptions: ["release", "rating", "created_at", "played", "random"],

      // Checked values of the filter menu; every one ticked means no filtering.
      filters: storedFilters(),

      // 排序顺序，true表示降序，false表示升序
      sortInDesc: storedBool('sortInDesc', true),

      touchedWorkId: 0, // 用来解决android移动端设备没有hover事件导致workCard不能跟随手指显示标签的问题

      isActive: false,
      toolbarStuck: false,
      _lastFilter: null,
      // Bumped by reset(); a response from an older generation is dropped, so a
      // slow page from the previous filter can never repaint the current list.
      _generation: 0,
      _inFlight: null,
    }
  },
  created () {
    this.seed = Math.floor(Math.random() * 100);
    this._lastFilter = this.filter
  },

  computed: {
    filter () {
      return this.$route.query.filter || ''
    },

    pageTitle () {
      return this.filter ? this.t('works.searchKeyword') : this.t('works.allWorks')
    },

    searchMetas () {
      return this.filter ? [this.filter] : []
    },

    ratingFilterOptions () {
      return [
        { value: 'sfw', label: this.t('works.nsfwAllAges') },
        { value: 'nsfw', label: this.t('works.nsfwAdult') },
      ]
    },

    statusFilterOptions () {
      return [
        { value: 'marked', label: this.t('works.statusMarked') },
        { value: 'listened', label: this.t('works.statusListened') },
        { value: 'postponed', label: this.t('works.statusPostponed') },
        { value: 'unmarked', label: this.t('works.statusNoProgress') },
      ]
    },

    reviewFilterOptions () {
      return [
        { value: 'has', label: this.t('works.starOrComment') },
        { value: 'none', label: this.t('works.noStarOrComment') },
      ]
    },

    selectedRatings () {
      return RATING_FILTERS.filter((value) => this.filters.includes(value))
    },

    selectedStatuses () {
      return STATUS_FILTERS.filter((value) => this.filters.includes(value))
    },

    selectedReviews () {
      return REVIEW_FILTERS.filter((value) => this.filters.includes(value))
    },

    excludedFilterCount () {
      return ALL_FILTERS.length - this.filters.length
    },

    ...mapState('AudioPlayer', [
      'oldWorkCardUIStyle',
    ]),
  },
  mounted () {
    // The window is the scroll container here (nothing between the page and the
    // viewport clips), so a plain listener is enough to drive the stuck shadow.
    this.onWindowScroll = () => {
      if (this._scrollRaf) return
      this._scrollRaf = requestAnimationFrame(() => {
        this._scrollRaf = 0
        this.updateToolbarStuck()
      })
    }
    window.addEventListener('scroll', this.onWindowScroll, { passive: true })
  },
  beforeUnmount () {
    window.removeEventListener('scroll', this.onWindowScroll)
    if (this._scrollRaf) cancelAnimationFrame(this._scrollRaf)
  },

  activated () {
    this.isActive = true
    this.$nextTick(() => {
      this.stopLoad = false
      this.updateToolbarStuck()
    })
    if (this.filter !== this._lastFilter) {
      this.reset()
    }
  },
  deactivated () {
    this.isActive = false
    this.stopLoad = true
    this.toolbarStuck = false
  },

  watch: {
    // Navigating away changes the query too, so compare against the filter the
    // current list was actually loaded with.
    filter () {
      if (this.isActive && this.$route.name === 'works' && this.filter !== this._lastFilter) {
        this.reset()
      }
    },

    sortCategoryOption (v) {
      localStorage.sortCategoryOption = v;
      this.reset()
    },

    filters: {
      deep: true,
      handler (v) {
        localStorage.worksFilter = JSON.stringify(v)
        this.reset()
      }
    },


    sortInDesc (v) {
      localStorage.sortInDesc = v;
      this.reset()
    },

    showLabel (newLabelSetting) {
      localStorage.showLabel = newLabelSetting;
    },

    listMode (newListModeSetting) {
      localStorage.listMode = newListModeSetting;
    },

    detailMode(newModeSetting) {
      localStorage.detailMode = newModeSetting;
    },

  },

  methods: {
    // Stuck once its top edge reaches the sticky offset — 0 while the header is
    // slid away, the header's height while it is showing.
    updateToolbarStuck () {
      const toolbar = this.$refs.toolbar
      if (!toolbar || !this.isActive) return
      const offset = parseFloat(getComputedStyle(toolbar).top) || 0
      this.toolbarStuck = toolbar.getBoundingClientRect().top <= offset + 0.5
    },

    // Dropping the last term leaves no filter at all, which is the whole
    // library rather than an empty search.
    applyFilter (filter) {
      this.$router.push(filter ? { path: '/works', query: { filter } } : '/works')
    },

    onLoad (index, done) {
      this.requestWorksQueue()
        .then(() => done())
    },

    // Concurrent callers join the pending request instead of asking for the same
    // page twice; `page` is read once here so a late response cannot rewrite it.
    requestWorksQueue () {
      if (this._inFlight) return this._inFlight

      const generation = this._generation
      const filter = this.filter
      const page = this.pagination.currentPage + 1
      const ratings = this.selectedRatings
      const statuses = this.selectedStatuses
      const reviews = this.selectedReviews

      // Nothing ticked in a group matches nothing, so answer it here instead of
      // inventing a query parameter that means "no rows".
      if (!ratings.length || !statuses.length || !reviews.length) {
        this.works = []
        this.pagination = { currentPage: 0, pageSize: 12, totalCount: 0 }
        this.stopLoad = true
        return Promise.resolve()
      }

      const params = {
        page,
        sort: this.sortInDesc ? "desc" : "asc",
        order: this.sortCategoryOption,
        seed: this.seed,
      }

      if (ratings.length < RATING_FILTERS.length) params.rating = ratings.join(',')
      if (statuses.length < STATUS_FILTERS.length) params.progress = statuses.join(',')
      if (reviews.length < REVIEW_FILTERS.length) params.review = reviews.join(',')

      if (filter) {
        params.filter = filter
      }

      this._inFlight = this.$axios.get(filter ? '/api/search' : '/api/works', { params })
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

    reset () {
      this._generation += 1
      this._inFlight = null
      this.seed = Math.floor(Math.random() * 100);
      this.stopLoad = true
      this.works = []
      this.pagination = { currentPage:0, pageSize:12, totalCount:0 }
      this._lastFilter = this.filter
      window.scrollTo(0, 0)
      // The page-1 response re-arms the scroller once the new list is known.
      this.requestWorksQueue()
    },

    // 将一些标签名称转换成可阅读的文字
    // 例如排序属性中，有release作为标记，release通常用来直接传递给服务器，
    // 通过这个函数可以将release转换成更加可阅读的文字标签“发售日期”
    humanReadableLabel(label) {
      switch(label) {
        case "release": return this.t('works.release');
        case "rating": return this.t('works.rating');
        case "created_at": return this.t('works.createdAt');
        case "played": return this.t('works.played');
        case "random": return this.t('works.random');
        default: return label;
      }
    },

    onWorkCardTouch(id) {
      this.touchedWorkId = id;
      console.log('touch on work id = ', id);
    },


  },
}
</script>

<style lang="scss" scoped>
  .list {
    // 宽度 >= $breakpoint-sm-min
    @media (min-width: $breakpoint-sm-min) {
      padding: 0px 20px;
    }
  }

  .work-card {
    // 宽度 > $breakpoint-xl-min
    @media (min-width: $breakpoint-md-min) {
      width: 560px;
    }
  }

</style>
