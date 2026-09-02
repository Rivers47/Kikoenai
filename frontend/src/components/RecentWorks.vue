<template>
  <div>
    <div class="row justify-between q-mt-lg q-ml-md">
      <div class="col text-h5 text-weight-regular">{{ $t('recentworks.recentPlayed') }}</div>
      <q-btn flat icon="navigate_next" @click="$router.push('/favourites/history')"></q-btn>
    </div>
    <q-virtual-scroll
      class="q-px-sm"
      :class="{'scroll-style-change': !$q.platform.has.touch}"
      :items="works"
      ref="scroll"
      virtual-scroll-horizontal
      @virtual-scroll="onVirtualScroll"
      @wheel.stop.prevent="onMouseWheel"
    >
      <template v-slot="{ item }">
        <div
          class="q-pa-sm"
          style="width: 500px; max-width: 80vw;"
          @click.stop.prevent="resumeThisHistory(item)"
        >
          <Cover
            class="card q-mx-sm shadow-4"
            :workid="item.id"
            :release="''"
            >
            <template v-slot:cover>
              <div class="playInfo absolute-bottom">
                <div class="ellipsis-2-lines audioText">
                  {{ getWorkHistoryInfo(item) }}
                </div>
                <div class="ellipsis workText" >
                  {{ item.title }}
                </div>
              </div>
            </template>
          </Cover>
        </div>
      </template>
    </q-virtual-scroll>
  </div>
</template>

<script>

import Cover from './Cover.vue';

export default {
  name: 'RecentWorks',

  components: {
    Cover
},

  data () {
    return {
      currentPage: 0,
      pagination: { currentPage:0, pageSize:12, totalCount:0 },
      works: [],
      stopLoad: false,
      isLoading: false,
    }
  },

  methods: {
    async getHistory() {
      if (this.stopLoad || this.isLoading) return;

      this.isLoading = true;

      const params = {
        page: this.pagination.currentPage + 1,
        sort: 'desc',
        excludeFinished: localStorage.hideFinishedHistory || 'listened',
      };

      // console.warn('load more page on: ', params.page);
      try {
        const response = await this.$axios.get('/api/history', { params });
        this.works = this.works.concat(response.data.works);
        this.pagination = response.data.pagination;
        this.$refs.scroll.refresh();
        // console.log("vscroll = ", this.$refs.scroll);

        // 只有请求成功后才判断是否已经全部加载完毕。
        // 这个判断不能放到 try 外面：请求失败时 works 和 totalCount 都还是 0，
        // 0 >= 0 会把 stopLoad 置成 true，于是一次偶发的网络错误就让组件在本次
        // 页面生命周期内永远不再发请求 —— 而 Works 页在 keep-alive 里，
        // 退出再进入也不会重新 mounted，只能整页刷新才恢复。
        if (this.works.length >= this.pagination.totalCount) {
          this.stopLoad = true;
        }
      } catch(err) {
        console.warn('load recent work failed: ', err);
      } finally {
        this.isLoading = false;
      }
    },

    async onVirtualScroll(details) {
      // console.log('virtual on virtual scroll: ', details.from, '->', details.to, ' index = ', details.index);
      const alreadyScrolledCount = details.index + 1;
      const loadMoreThres = 3; // 当剩余显示的数量小于这个数字时，加载更多播放历史
      if (loadMoreThres > (this.works.length - alreadyScrolledCount)) {
        this.getHistory();
      }
    },

    onMouseWheel(e) {
      // console.log('vmouse wheel = ', e);
      this.$refs.scroll.$el.scrollLeft += (e.deltaX || e.deltaY);
    },

    // 返回单个作品播放历史的简单信息
    getWorkHistoryInfo(work) {
      const state = work.state;
      const lastPlayItem = state.queue[state.index]
      return lastPlayItem.title;
    },

    resumeThisHistory(work) {
      this.$store.commit('AudioPlayer/SET_QUEUE', {
        workId: work.id,
        vas: work.vas,
        queue: work.state.queue,
        index: work.state.index,
        resetPlaying: false,
        resumeHistorySeconds: work.state.seconds,
        workLastTrackId: work.state.queue.length ? (work.state.queue[work.state.queue.length - 1].trackId || work.state.queue[work.state.queue.length - 1].hash) : ''
      })
      console.log(`resume seconds = ${work.state.seconds}`)
    }

  },

  mounted() {
    this.getHistory();
  },

  // Works 页在 keep-alive 中，加载失败后不会再次 mounted。
  // 重新进入页面时，如果上一次一条都没加载出来就再试一次。
  activated() {
    if (this.works.length === 0) {
      this.getHistory();
    }
  },
}
</script>

<style scoped lang="scss">

.card {
  border-radius: 8px;
  overflow: hidden;
}

.playInfo {
  background: linear-gradient(to top, black, rgba(0, 0, 0, 0.5), transparent);
  width: 100%;
  padding: 0.5rem;
}

.audioText {
  font-weight: bold;
  font-size: larger;
}

.workText {
  font-weight: normal;
  font-size: small;
  color: lightgrey;

}

.scroll-style-change {
  scrollbar-color: gray transparent;
}

.scroll-style-change::-webkit-scrollbar {
  background: transparent;
  height: 0.5rem;
}

.scroll-style-change::-webkit-scrollbar-thumb {
  background: gray;
  min-width: 3rem;
  border-radius: 10px;
}

</style>