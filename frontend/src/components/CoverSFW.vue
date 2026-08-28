<template>
  <q-img
    :src="coverUrl"
    :ratio="4/3"
    :img-class="imgClass"
    style="max-width: 560px;"
    transition="fade"
    @mouseover="toggleBlurFlag()"
    @mouseout="toggleBlurFlag()"
  >
    <div class="absolute-top-left transparent" style="padding: 0;">
      <q-chip dense square color="dark" text-color="white" class="q-ma-sm shadow-3">
        {{code}}
      </q-chip>
    </div>

    <div v-if="release !== ''" class="absolute-bottom-right transparent" style="padding: 0px;">
      <q-chip dense square color="surface-container-highest" text-color="on-surface" class="q-ma-sm shadow-3">
        {{release}}
      </q-chip>
    </div>

    <!-- 标签 -->
    <div class="q-pa-none q-ma-sm absolute-bottom-left tags-panel">
      <router-link
        v-for="tag in tags"
        :key='tag.id'
        :to="`/works?tagId=${tag.id}`"
        >
        <q-chip dense square class="shadow-3">
          {{ $tTag(tag.name) }}
        </q-chip>
      </router-link>
    </div>

    <!--其他自定义组件-->
    <slot name="cover"></slot>
  </q-img>
</template>

<script>

import { formatID, isFanzaId } from 'src/utils'

export default {
  name: 'CoverSFW',

  props: {
    workid: {
      type: [String, Number],
      required: true
    },
    
    nsfw: {
      type: Boolean,
      default: true
    },

    release: {
      required: true
    },

    tags: {
      type: Array,
      require: false,
      default() {return [];}
    },
  },

  data () {
    return {
      blurFlag: true,
    }
  },

  computed: {
    coverUrl () {
      return this.workid ? `/api/cover/${this.workid}` : ""
    },

    rjcode () {
      return formatID(this.workid)
    },

    code () {
      const id = String(this.workid)
      if (isFanzaId(id)) {
        return id
      }
      return 'RJ' + id
    },

    imgClass () {
      if (this.$q.platform.is.mobile) {
        // 在移动设备上图片直接显示
        return ""
      } else {
        if (!this.nsfw) {
          // 在PC上SFW的图片直接显示
          return ""
        } else {
          // 在PC上NSFW的图片鼠标悬停显示
          return this.blurFlag ? "blur-image" : ""
        }
      }
    },

  },

  methods: {
    toggleBlurFlag () {
      this.blurFlag = !this.blurFlag
    }
  }
}
</script>

<style scoped lang="scss">
.blur-image {
  filter: blur(10px);
}

.tags-panel {
  opacity: calc(var(--hover-work-card) + var(--active-work-card) + var(--sim-hover-work-card));
  transition: opacity 0.2s;
  padding: 0;
  max-width: 70%;
  background: rgba(0,0,0,0.5);
  border-radius: 5px;
  // background: radial-gradient(closest-side at center, rgba(0, 0, 0, 0.8) 0, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0) 100%);
  // background: linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0,0,0,0.4) 30%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.4) 70%, rgba(0,0,0,0));
}

</style>