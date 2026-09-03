<template>
  <q-img
    :src="resolvedCoverUrl"
    :ratio="4/3"
    style="max-width: 560px;"
    transition="fade"
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
      <SearchableLabel
        v-for="tag in tags"
        :key='tag.id'
        :to="labelRoute('tag', tag.name)"
        field="tag"
        chip
        :name="tag.name"
        >
        <q-chip dense square class="shadow-3" :lang="$tagLang">
          {{ $tTag(tag.name) }}
        </q-chip>
      </SearchableLabel>
    </div>

    <!--其他自定义组件-->
    <slot name="cover"></slot>
  </q-img>
</template>

<script>

import { isFanzaId, labelRoute } from 'src/utils'
import SearchableLabel from './SearchableLabel'
import { apiUrl } from 'src/base-path'

export default {
  name: 'Cover',

  components: {
    SearchableLabel,
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
      const id = String(this.workid)
      if (isFanzaId(id)) {
        return id
      }
      return 'RJ' + id
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

</style>