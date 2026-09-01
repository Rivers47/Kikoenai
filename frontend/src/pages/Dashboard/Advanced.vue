<template>
  <q-form @submit="onSubmit">
    <q-card class="q-ma-md">
      <q-toolbar>
        <q-toolbar-title>{{ $t('advanced.scraperSettings') }}</q-toolbar-title>
      </q-toolbar>

      <q-list>
        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.dlsiteTimeout') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.dlsiteTimeoutCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.dlsiteTimeout"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.hvdbTimeout') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.hvdbTimeoutCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.hvdbTimeout"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.retryDelay') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.retryDelayCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.retryDelay"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.maxRetry') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.maxRetryCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.retry"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.parallelism') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.parallelismCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.maxParallelism"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.proxyHost') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.proxyHostCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model="config.httpProxyHost"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.proxyPort') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.proxyPortCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.httpProxyPort"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <q-card class="q-ma-md">
      <q-toolbar>
        <q-toolbar-title>{{ $t('advanced.scannerSettings') }}</q-toolbar-title>
      </q-toolbar>

      <q-list>
        <q-item style="height: 70px;">
          <q-item-section>
            <q-item-label>{{ $t('advanced.maxDepth') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.maxDepthCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.scannerMaxRecursionDepth"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>
        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.skipCleanup') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.skipCleanupCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section side>
            <q-toggle v-model="config.skipCleanup" dense />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <q-card class="q-ma-md">
      <q-toolbar>
        <q-toolbar-title>{{ $t('advanced.webServerSettings') }}</q-toolbar-title>
        <div class="q-pr-xs">{{ $t('advanced.restartNotice') }}</div>
      </q-toolbar>

      <q-list>
        <q-item style="height: 70px;">
          <q-item-section>
            <q-item-label>{{ $t('advanced.auth') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.authCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-toggle v-model="config.auth" dense :disable="config.production" />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.gzip') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.gzipCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-toggle v-model="config.enableGzip" dense/>
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.port') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.portCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.listenPort"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.basePath') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.basePathCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model="config.basePath"
              :placeholder="$t('advanced.basePathPlaceholder')"
              input-class="text-right"
              style="max-width: 180px;"
            />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.blockRemote') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.blockRemoteCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-toggle v-model="config.blockRemoteConnection" dense/>
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.tokenExpiry') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.tokenExpiryCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.expiresIn"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.pageSize') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.pageSizeCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-input
              v-model.number="config.pageSize"
              type="number"
              input-class="text-right"
              style="max-width: 100px;"
            />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <q-card class="q-ma-md">
      <q-toolbar>
        <q-toolbar-title>{{ $t('advanced.securitySettings') }}</q-toolbar-title>
      </q-toolbar>

      <q-list>
        <q-item style="height: 70px;">
          <q-item-section>
            <q-item-label>{{ $t('advanced.production') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.productionCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-toggle v-model="config.production" dense disable />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.allowedHosts') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.allowedHostsCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section>
            <q-select
              v-model="config.allowedHosts"
              multiple
              use-input
              use-chips
              hide-dropdown-icon
              new-value-mode="add-unique"
              :placeholder="$t('advanced.allowedHostsPlaceholder')"
            />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <q-card class="q-ma-md">
      <q-toolbar>
        <q-toolbar-title>{{ $t('advanced.otherSettings') }}</q-toolbar-title>
      </q-toolbar>

      <q-list>
        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.dbDefaultPath') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.dbDefaultPathCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-toggle v-model="config.dbUseDefaultPath" dense />
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.coverDefaultPath') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.coverDefaultPathCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-toggle v-model="config.coverUseDefaultPath" dense />
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

    <div class="q-ma-lg row justify-end">
      <q-btn :loading="loading" :label="$t('common.save')" type="submit" color="primary" />
    </div>
  </q-form>
</template>

<script>
import NotifyMixin from '../../mixins/Notification.js'

export default {
  name: 'Advanced',

  mixins: [NotifyMixin],

  data () {
    return {
      config: {},
      loading: false,
    }
  },

  methods: {
    requestConfig () {
      this.$axios.get('/api/config/admin')
        .then((response) => {
          this.config = response.data.config;
        })
        .catch((error) => {
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            if (error.response.status !== 401) {
              this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
            }
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

    onSubmit () {
      this.loading = true

      this.$axios.put('/api/config/admin', {
        config: this.config
      })
        .then((response) => {
          this.loading = false
          this.showSuccNotif(response.data.message)
        })
        .catch((error) => {
          this.loading = false
          if (error.response) {
            // 请求已发出，但服务器响应的状态码不在 2xx 范围内
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`)
          } else {
            this.showErrNotif(error.message || error)
          }
        })
    },

  },

  created () {
    this.requestConfig()

  }
}
</script>