<template>
  <q-item clickable :to="`/work/${metadata.id}`" style="padding: 5px;">
    <q-item-section avatar style="padding: 0px 5px 0px 0px;">
      <router-link :to="`/work/${metadata.id}`">
        <q-img transition="fade" :src="samCoverUrl" style="height: 60px; width: 60px;" />
      </router-link>
    </q-item-section>

    <q-item-section>
      <q-item-label lines="2" class="text">
        <router-link :to="`/work/${metadata.id}`" class="text-secondary">
          {{ metadata.title }}
        </router-link>
      </q-item-label>

      <q-item-label>
        <div class="row q-gutter-x-sm q-gutter-y-xs">
          <SearchableLabel
            :to="labelRoute('circle', metadata.circle.name)"
            field="circle"
            :name="metadata.circle.name"
            link-class="text-muted"
            class="col-auto"
          >
            {{ metadata.circle.name }}
          </SearchableLabel>

          <span class="col-auto">/</span>

          <SearchableLabel
            v-for="(va, index) in metadata.vas"
            :to="labelRoute('va', va.name)"
            field="va"
            :name="va.name"
            :key=index
            link-class="text-primary"
            class="col-auto"
          >
            {{ va.name }}
          </SearchableLabel>
        </div>
      </q-item-label>

      <q-item-label v-if="showLabel && $q.screen.width> 700">
        <div class="row q-gutter-x-sm q-gutter-y-xs">
          <SearchableLabel
            v-for="(tag, index) in metadata.tags"
            :to="labelRoute('tag', tag.name)"
            field="tag"
            :name="tag.name"
            :key=index
            link-class="text-muted"
            class="col-auto"
            :lang="$tagLang"
          >
            {{ $tTag(tag.name) }}
          </SearchableLabel>
        </div>
      </q-item-label>
    </q-item-section>
  </q-item>   
</template>

<script>
import { apiUrl } from 'src/base-path'
import { labelRoute } from 'src/utils'
import SearchableLabel from './SearchableLabel'

export default {
  name: 'WorkListItem',

  components: {
    SearchableLabel,
  },

  props: {
    metadata: {
      type: Object,
      required: true
    },
    showLabel: {
      type: Boolean,
      default: true
    },
  },

  methods: {
    labelRoute,
  },

  computed: {
    samCoverUrl () {
      return this.metadata.id ? apiUrl(`/api/cover/${this.metadata.id}?type=sam`) : ""
    },
  }
}
</script>
