<template>
  <q-img
    :src="resolvedCoverUrl"
    :ratio="4/3"
    style="max-width: 560px;"
    transition="fade"
  >
    <!-- hide work id and release in thumbnail mode for cleaner look -->
    <div v-if="release !== ''" class="absolute-top-left transparent" style="padding: 0;">
      <q-chip dense square color="surface-container" text-color="on-surface" class="q-ma-sm shadow-3">
        {{code}}
      </q-chip>
    </div>

    <div v-if="release !== ''" class="absolute-bottom-right transparent" style="padding: 0px;">
      <q-chip dense square color="surface-container" text-color="on-surface" class="q-ma-sm shadow-3">
        {{release}}
      </q-chip>
    </div>

    <!-- 标签 -->
    <div class="q-pa-none q-ma-sm absolute-bottom-left tags-panel">
      <LabelDropdown
        v-for="tag in tags"
        :key='tag.id'
        :to="labelRoute('tag', tag.name)"
        field="tag"
        :name="tag.name"
        :label="$tTag(tag.name)"
        dense
        size="md"
        color="surface-container"
        text-color="on-surface"
        class="shadow-3 q-ma-xs"
        :lang="$tagLang"
      />
    </div>

    <!--其他自定义组件-->
    <slot name="cover"></slot>
  </q-img>
</template>

<script>

import { workno, labelRoute } from 'src/utils'
import LabelDropdown from './LabelDropdown'
import { apiUrl } from 'src/base-path'

export default {
  name: 'Cover',

  components: {
    LabelDropdown,
  },

  props: {
    workid: {
      type: [String, Number],
      required: true
    },
    
    release: {
      required: true
    },

    tags: {
      type: Array,
      require: false,
      default() {return [];}
    },

    // Optional override for the cover source. Used by the Downloads page,
    // which points at the exact URL it cached offline (`?type=main`) rather
    // than the default variant, which may not be in Cache Storage.
    coverUrl: {
      type: String,
      default: ''
    },
  },

  computed: {
    resolvedCoverUrl () {
      if (this.coverUrl) return this.coverUrl
      return this.workid ? apiUrl(`/api/cover/${this.workid}`) : ""
    },

    code () {
      return workno(this.workid)
    },

  },

  methods: {
    labelRoute,
  }
}
</script>

<style scoped lang="scss">
.tags-panel {
  opacity: calc(var(--hover-work-card) + var(--active-work-card) + var(--sim-hover-work-card));
  transition: opacity 0.2s;
  padding: 0;
  max-width: 100%;
  background: rgb(var(--inverse-surface-rgb) / 0.5);
  border-radius: 5px;
  // background: radial-gradient(closest-side at center, rgba(0, 0, 0, 0.8) 0, rgba(0, 0, 0, 0.7), rgba(0, 0, 0, 0) 100%);
  // background: linear-gradient(to right, rgba(0, 0, 0, 0), rgba(0,0,0,0.4) 30%, rgba(0,0,0,0.5) 50%, rgba(0,0,0,0.4) 70%, rgba(0,0,0,0));
}

// These cover the artwork, so they are trimmed back towards the dense chips
// they replaced: the side padding is the chip's 0.4em, and the box is 24px,
// the smallest target WCAG 2.2 allows rather than the button's own 2em. The
// arrow is sized to clear 24px too, since it is a target in its own right.
.tags-panel :deep(.q-btn--dense) {
  min-height: 24px;
  padding-top: 0;
  padding-bottom: 0;
}

.tags-panel :deep(.q-btn-dropdown--current) {
  padding-left: 0.4em;
  padding-right: 0.4em;
}

.tags-panel :deep(.q-btn-dropdown__arrow-container) {
  padding: 0 3px;
}

.tags-panel :deep(.q-btn-dropdown__arrow) {
  font-size: 18px;
}

</style>