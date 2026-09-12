<template>
  <q-card class="q-pa-md">
    <div v-if="!hasContent" class="text-muted">{{ $t('workdescription.empty') }}</div>

    <!-- The seller's own markup, sanitized by the backend
         (routes/utils/description-html.js): every tag and attribute comes off
         an allowlist, colours are stripped so the text reads in either theme,
         and each <img> already points at a downloaded local file. -->
    <div v-if="html" class="description-html text-body2" v-html="html"></div>

    <!-- Rows scraped before the markup was kept, and works that came through
         the JSON fallback (which has no markup to keep): plain text, with the
         images and track list the scraper pulled out separately. -->
    <template v-else>
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
    </template>
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

    // Sanitized markup from GET /api/work/:id/extras. Empty for a work whose
    // row predates it.
    html: {
      type: String,
      required: false,
      default: ''
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
      return Boolean(this.html) || Boolean(this.description) || this.parts.length > 0
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

// :deep, because scoped styles never reach v-html content.
.description-html {
  word-break: break-word;

  :deep(img) {
    // Capped like the legacy path's q-img: a wide window would otherwise blow
    // a banner up to the full width of the page.
    max-width: min(100%, 720px);
    height: auto;
    border-radius: 4px;
  }

  // Sellers lay blurbs out in wide tables; let one scroll rather than push the
  // page sideways.
  :deep(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
    border-collapse: collapse;
  }

  :deep(td),
  :deep(th) {
    padding: 2px 8px;
  }

  :deep(a) {
    color: var(--q-primary);
  }

  // The markup carries no colours (the sanitizer drops them), so headings would
  // otherwise be indistinguishable from body text.
  :deep(h1), :deep(h2), :deep(h3), :deep(h4), :deep(h5), :deep(h6) {
    font-size: 1.1em;
    font-weight: 500;
    margin: 1em 0 0.4em;
  }

  :deep(ul), :deep(ol) {
    padding-left: 1.5em;
  }
}
</style>
