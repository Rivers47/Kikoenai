<template>
  <div class="q-pa-md">
    <div class="row items-center no-wrap q-mb-sm">
      <q-btn flat round dense icon="arrow_back" :aria-label="$t('common.back')" @click="goBack" />
      <div class="text-h6 q-ml-sm ellipsis">{{ title }}</div>
    </div>

    <q-card>
      <q-card-section>
        <div v-if="loading" class="row justify-center q-pa-lg">
          <q-spinner size="32px" color="primary" />
        </div>
        <div v-else-if="error" class="text-negative">{{ error }}</div>
        <div v-else-if="!content" class="text-grey">{{ $t('textviewer.emptyFile') }}</div>
        <pre v-else class="text-file-content">{{ content }}</pre>
      </q-card-section>
    </q-card>
  </div>
</template>

<script>
export default {
  name: 'TextViewer',

  data () {
    return {
      content: '',
      loading: false,
      error: '',
    }
  },

  computed: {
    trackId () {
      return this.$route.params.trackId
    },

    title () {
      return this.$route.query.title || this.trackId
    }
  },

  watch: {
    trackId () {
      this.load()
    }
  },

  methods: {
    async load () {
      this.content = '';
      this.error = '';
      this.loading = true;

      try {
        // The backend detects the charset (jschardet) and puts it in
        // Content-Type, so the browser decodes Shift-JIS files correctly.
        // transformResponse is neutered so axios never JSON-parses the body.
        const response = await this.$axios.get(`/api/media/stream/${this.trackId}`, {
          responseType: 'text',
          transformResponse: [data => data]
        });
        this.content = typeof response.data === 'string'
          ? response.data
          : String(response.data);
      } catch (error) {
        this.error = (error.response && error.response.data && error.response.data.error)
          ? error.response.data.error
          : error.message;
      } finally {
        this.loading = false;
      }
    },

    goBack () {
      // Deep-linked into this page (no in-app entry behind it): go to the work
      // page instead of out of the app. trackId is `${workId}/${index}`.
      if (window.history.state && window.history.state.back) {
        this.$router.back();
      } else if (this.trackId.includes('/')) {
        this.$router.push(`/work/${this.trackId.split('/')[0]}`);
      } else {
        this.$router.push('/');
      }
    }
  },

  mounted () {
    this.load()
  }
}
</script>

<style scoped>
/* Keep the file's own line breaks but wrap long lines instead of scrolling
   the page sideways. */
.text-file-content {
  margin: 0;
  font-family: inherit;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
