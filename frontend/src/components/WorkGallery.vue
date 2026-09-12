<template>
  <div class="work-gallery">
    <q-carousel
      v-model="slide"
      swipeable
      animated
      infinite
      height="100%"
      class="bg-black"
    >
      <q-carousel-slide
        v-for="(src, index) in slides"
        :key="src"
        :name="index"
        class="q-pa-none"
      >
        <q-img
          :src="src"
          fit="contain"
          height="100%"
          transition="fade"
          class="cursor-pointer"
          @click="viewing = true"
        />
      </q-carousel-slide>

      <!-- The built-in `arrows` are bare icons in a single colour, which
           disappear against a light or busy sample image. These are the same
           buttons on their own backdrop. -->
      <template v-slot:control>
        <template v-if="slides.length > 1">
          <q-carousel-control position="left" :offset="[8, 0]" class="column justify-center">
            <q-btn
              round
              size="md"
              icon="chevron_left"
              color="surface-container"
              text-color="on-surface"
              class="gallery-btn shadow-4"
              :aria-label="$t('common.previous')"
              @click="step(-1)"
            />
          </q-carousel-control>

          <q-carousel-control position="right" :offset="[8, 0]" class="column justify-center">
            <q-btn
              round
              size="md"
              icon="chevron_right"
              color="surface-container"
              text-color="on-surface"
              class="gallery-btn shadow-4"
              :aria-label="$t('common.next')"
              @click="step(1)"
            />
          </q-carousel-control>

          <q-carousel-control position="bottom-right" :offset="[8, 8]">
            <q-chip dense square color="surface-container" text-color="on-surface" class="shadow-3">
              {{ slide + 1 }}/{{ slides.length }}
            </q-chip>
          </q-carousel-control>
        </template>
      </template>
    </q-carousel>

    <ImageViewer
      v-model="viewing"
      :images="viewerImages"
      :index="slide"
      @update:index="slide = $event"
    />
  </div>
</template>

<script>
import { apiUrl } from 'src/base-path'
import { workImageUrl, workno } from 'src/utils'
import ImageViewer from './ImageViewer'

export default {
  name: 'WorkGallery',

  components: {
    ImageViewer,
  },

  props: {
    workid: {
      type: [String, Number],
      required: true
    },

    // Scraped work images, as stored in t_work.sample_images: the sample
    // slider first, then any image embedded in the description. Entries that
    // were never downloaded carry no `file` and are skipped -- see
    // workImageUrl.
    images: {
      type: Array,
      required: false,
      default() { return [] }
    },
  },

  data() {
    return {
      slide: 0,
      viewing: false,
    }
  },

  computed: {
    // Cover first, then every scraped image that was downloaded. One list, so
    // the carousel and the viewer cannot drift apart: an image with no local
    // file drops out of both at once.
    viewerImages() {
      const cover = { name: workno(this.workid), url: this.workid ? apiUrl(`/api/cover/${this.workid}`) : '' }
      const scraped = this.images.map(image => ({
        name: image.file || '',
        url: workImageUrl(this.workid, image),
      }))
      return [cover, ...scraped].filter(image => image.url)
    },

    slides() {
      return this.viewerImages.map(image => image.url)
    }
  },

  methods: {
    // Drives the carousel itself rather than relying on its arrows, wrapping
    // at both ends like `infinite` does for swipes.
    step(delta) {
      const count = this.slides.length
      if (count > 1) this.slide = (this.slide + delta + count) % count
    }
  },

  watch: {
    workid() {
      this.slide = 0
      this.viewing = false
    },

    // A work whose images arrive after the cover has already rendered must not
    // keep an index that now points at a different picture.
    images() {
      this.slide = 0
    }
  }
}
</script>

<style scoped lang="scss">
.gallery-btn {
  // A sample image can be light, dark or busy, so the button carries its own
  // backdrop instead of relying on contrast with the picture behind it.
  opacity: 0.8;
  transition: opacity 0.2s;
}

// Revealed on hover, like the tag panel over a work card. Hidden only where a
// pointer actually exists: on touch there is nothing to hover with, and the
// buttons would be gone for good, leaving swipe as the only way through.
@media (hover: hover) {
  .gallery-btn {
    opacity: 0;
  }

  .work-gallery:hover .gallery-btn,
  .gallery-btn:focus-visible {
    opacity: 0.8;
  }

  .gallery-btn:hover,
  .gallery-btn:focus-visible {
    opacity: 1;
  }
}

.work-gallery {
  width: 100%;
  max-width: 560px;
  // Matches Cover.vue's 4/3 box, so the work page keeps its layout whether or
  // not a work has scraped images. The carousel positions its slides
  // absolutely and so cannot size itself to the picture.
  aspect-ratio: 4 / 3;
}
</style>
