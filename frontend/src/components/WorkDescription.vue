<template>
  <q-card class="q-pa-md">
    <div v-if="!hasContent" class="text-muted">{{ $t('workdescription.empty') }}</div>

    <!-- The scraper splits the description into the seller's own blocks
         (.work_parts). A work scraped through the JSON fallback has none, and
         falls back to the flat description below. -->
    <div v-for="(part, index) in parts" :key="index" class="q-mb-md">
      <div v-if="part.heading" class="text-subtitle1 text-weight-medium q-mb-xs">{{ part.heading }}</div>

      <div v-if="part.text" class="description-text text-body2">{{ part.text }}</div>

      <q-list v-if="part.tracks && part.tracks.length" dense class="q-mt-xs">
        <q-item v-for="(track, trackIndex) in part.tracks" :key="trackIndex" class="q-px-none">
          <q-item-section>{{ track.title }}</q-item-section>
          <q-item-section side v-if="track.time">{{ track.time }}</q-item-section>
        </q-item>
      </q-list>

      <q-img
        v-for="url in localImages(part)"
        :key="url"
        :src="imageUrl(url)"
        fit="contain"
        transition="fade"
        class="q-mt-sm rounded-borders"
        style="max-width: 720px;"
      />
    </div>

    <div v-if="!parts.length && description" class="description-text text-body2">{{ description }}</div>
  </q-card>
</template>

<script>
import { workImageUrl } from 'src/utils'

export default {
  name: 'WorkDescription',

  props: {
    workid: {
      type: [String, Number],
      required: true
    },

    description: {
      type: String,
      required: false,
      default: ''
    },

    parts: {
      type: Array,
      required: false,
      default() { return [] }
    },

    // t_work.sample_images, used here only to find the local copy of an image
    // the description embeds. An image with no local copy is not rendered.
    images: {
      type: Array,
      required: false,
      default() { return [] }
    },
  },

  computed: {
    hasContent() {
      return Boolean(this.description) || this.parts.length > 0
    },

    // Remote url -> stored entry. Description images are downloaded under a
    // positional name, so the url is the only thing tying the two together.
    imagesByUrl() {
      const map = {}
      for (const image of this.images) {
        if (image && image.url) map[image.url] = image
      }
      return map
    }
  },

  methods: {
    imageUrl(url) {
      return workImageUrl(this.workid, this.imagesByUrl[url])
    },

    // Only the images that were downloaded. The rest are left out rather than
    // loaded from DLsite -- see workImageUrl.
    localImages(part) {
      return (part.images || []).filter(url => this.imageUrl(url))
    }
  }
}
</script>

<style scoped lang="scss">
.description-text {
  // The scraper keeps the seller's own line breaks.
  white-space: pre-line;
  word-break: break-word;
}
</style>
