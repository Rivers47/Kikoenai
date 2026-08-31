<template>
  <q-card class="card hover-show">
    <!-- The cover link is an overlay rather than a wrapper: the tag chips sit
         on top of the cover, and nesting them inside the link would put an
         anchor (and their menu button) inside another anchor. -->
    <div class="cover-wrap">
      <CoverSFW :workid="metadata.id" :nsfw="false" :release="metadata.release" :tags="metadata.tags" />
      <router-link class="cover-link" :to="`/work/${metadata.id}`" :aria-label="metadata.title" />
    </div>

    <q-separator />

    <div v-if="!thumbnailMode">
      <!-- 标题 -->
      <div class="q-mx-sm text-h6 text-weight-regular ellipsis-2-lines">
        <router-link :to="`/work/${metadata.id}`" class="text-primary">
          {{ metadata.title }}
        </router-link>
      </div>

      <!-- 社团 -->
      <div class="q-ml-sm q-mt-sm q-mb-xs text-subtitle1 text-weight-regular ellipsis">
        <SearchableLabel
          :to="labelRoute('circle', metadata.circle.name)"
          field="circle"
          :name="metadata.circle.name"
          link-class="text-muted"
        >
          {{ metadata.circle.name }}
        </SearchableLabel>
      </div>

      <!-- 评价&评论 -->
      <div v-show="metadata.title" class="row items-center">
        <!-- 评价 -->
        <div class="col-auto q-ml-sm">
          <q-rating
            v-model="rating"
            size="sm"
            :color="userMarked ? 'rating-star' : 'primary'"
            icon="star_border"
            icon-selected="star"
            icon-half="star_half"
          />

          <!-- 评价分布明细 -->
          <q-tooltip content-class="text-subtitle1" v-if=metadata.rate_count_detail>
            <div>{{ $t('workcard.average') }}: {{ metadata.rate_average_2dp }}</div>
            <div v-for="(rate, index) in sortedRatings" :key=index class="row items-center">
              <div class="col">{{ $t('workcard.stars', { n: rate.review_point }) }}</div>

              <!-- 评价占比 -->
              <q-linear-progress
                :value="rate.ratio/100"
                color="on-info-container"
                track-color="info-container"
                style="height: 15px; width: 100px"
                class="col-auto"
              />

              <div class="col q-mx-sm">({{ rate.count }})</div>
            </div>
          </q-tooltip>
        </div>

        <div class="col-auto">
          <span class="text-weight-medium text-body1 text-negative">{{ metadata.rate_average_2dp }}</span>
          <span class="text-muted"> ({{ metadata.rate_count }})</span>
        </div>

        <!-- 评论数量 -->
        <div class="col-auto q-px-sm">
          <q-icon name="chat" size="xs" />
          <span class="text-muted"> ({{ metadata.review_count }})</span>
        </div>

        <!-- DLsite链接 -->
        <div class="col-auto">
          <q-icon name="launch" size="xs" />
          <a class="text-primary" :href="`https://www.dlsite.com/home/work/=/product_id/RJ${dlsiteCode}.html`" rel="noreferrer noopener" target="_blank">DLsite</a>
        </div>
      </div>

      <!-- 价格&售出数 -->
      <div v-show="metadata.title" class="row items-center">
        <span class="q-ml-sm text-weight-medium text-h6 text-negative">
          {{ metadata.price }}¥
        </span>
        <q-chip size="sm" icon="sell">{{ metadata.dl_count }}</q-chip>
        <q-chip v-if="!metadata.nsfw" class="q-mx-sm sfw-badge" dense>{{ $t('workcard.allAges') }}</q-chip>
      </div>

      <!-- 声优 -->
      <div
        class="q-mx-xs q-my-sm"
        :class="{ 'horize-scroll-va-list': $q.platform.has.touch }"
      >
        <SearchableLabel
          v-for="(va, index) in metadata.vas"
          :to="labelRoute('va', va.name)"
          field="va"
          :name="va.name"
          :key=index
        >
          <q-chip square size="md" class="shadow-2" color="primary-container" text-color="on-primary-container">
            {{ va.name }}
          </q-chip>
        </SearchableLabel>
      </div>
    </div>
  </q-card>
</template>

<script>
import CoverSFW from 'components/CoverSFW'
import NotifyMixin from '../mixins/Notification.js'
import { labelRoute } from 'src/utils'
import SearchableLabel from './SearchableLabel'

export default {
  name: 'WorkCard',

  mixins: [NotifyMixin],

  components: {
    SearchableLabel,
    CoverSFW
  },

  props: {
    metadata: {
      type: Object,
      required: true
    },
    thumbnailMode: {
      type: Boolean,
      default: false
    }
  },

  data () {
    return {
      rating: 0,
      userMarked: false,
      showTags: true
    }
  },

  computed: {
    sortedRatings: function() {
      function compare(a, b) {
        return (a.review_point > b.review_point) ? -1 : 1;
      }

      return this.metadata.rate_count_detail.slice().sort(compare);
    },
    dlsiteCode() {
      let c = String(this.metadata.id);
      c = this.metadata.id > 1000000 
        ? c.padStart(8,'0')  // 8位RJ番号
        : c.padStart(6,'0'); // 6位RJ番号
      return c;
    }
  },

  // TODO: Refactor with Vuex?
  mounted() {
    if (this.metadata.userRating) {
      this.userMarked = true;
      this.rating = this.metadata.userRating;
    } else {
      this.userMarked = false;
      this.rating = this.metadata.rate_average_2dp || 0;
    }

    // 极个别作品没有标签
    if (this.metadata.tags && this.metadata.tags.length > 0 && this.metadata.tags[0].name === null) {
      this.showTags = false;
    }
  },

  watch: {
    rating (newRating, oldRating) {
      if (oldRating) {
        const submitPayload = {
          'user_name': this.$store.state.User.name, // 用户名不会被后端使用
          'work_id': this.metadata.id,
          'rating': newRating
        };
        this.userMarked = true;
        this.submitRating(submitPayload);
      }
    }
  },

  methods: {
    labelRoute,
    submitRating (payload) {
      this.$axios.put('/api/review', payload)
        .then((response) => {
          this.showSuccNotif(response.data.message)
        })
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },
  }
}
</script>


<style scoped>
.card {
  overflow: hidden;
  border-radius: 8px;
  box-shadow: 0 0px 8px rgba(0, 0, 0, 0.4);
}

.horize-scroll-va-list {
  display: flex;
  overflow-y: scroll;
}

.cover-wrap {
  position: relative;
}

.cover-wrap .cover-link {
  position: absolute;
  inset: 0;
}

/* Above the cover link, so the chips and their carets stay clickable. */
.cover-wrap :deep(.tags-panel) {
  z-index: 1;
}

.hover-show {
  --hover-work-card: 0; /* 桌面平台上，鼠标的hover状态 */
  --active-work-card: 0; /* 桌面平台上，组建被选中状态 */
}

.hover-show:hover {
  --hover-work-card: 1;
}

.hover-show:active {
  --active-work-card: 1;
}

</style>