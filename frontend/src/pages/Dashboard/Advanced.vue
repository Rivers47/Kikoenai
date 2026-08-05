<template>
  <q-form @submit="onSubmit">
    <q-card class="q-ma-md">
      <q-toolbar>
        <q-toolbar-title>{{ $t('advanced.webPrefsTitle') }}</q-toolbar-title>
      </q-toolbar>

      <q-list>
        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.language') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.languageCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-select
              v-model="currentLanguage"
              :options="languageOptions"
              emit-value
              map-options
              dense
              outlined
              style="min-width: 160px;"
              @update:model-value="onLanguageChange"
            />
          </q-item-section>
        </q-item>

        <q-item style="height: 70px;">
          <q-item-section>
            <q-item-label>{{ $t('advanced.legacyCardUi') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.legacyCardUiCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-toggle :model-value="oldWorkCardUIStyle" @update:model-value="changeOldWorkCardUIStyle" dense/>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>
    <q-card class="q-ma-md">
      <q-toolbar>
        <q-toolbar-title>{{ $t('advanced.playerSettings') }}</q-toolbar-title>
      </q-toolbar>

      <q-list>
        <q-item style="height: 70px;">
          <q-item-section>
            <q-item-label>{{ $t('advanced.rewindSeconds') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.rewindSecondsCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <div class="q-gutter-sm">
              <q-radio dense v-model="rewindSeekTime" :val="5" :label="`5 ${$t('advanced.secondsUnit')}`" />
              <q-radio dense v-model="rewindSeekTime" :val="10" :label="`10 ${$t('advanced.secondsUnit')}`" />
              <q-radio dense v-model="rewindSeekTime" :val="30" :label="`30 ${$t('advanced.secondsUnit')}`" />
            </div>
          </q-item-section>
        </q-item>

        <q-item>
          <q-item-section>
            <q-item-label>{{ $t('advanced.forwardSeconds') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.forwardSecondsCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <div class="q-gutter-sm">
              <q-radio dense v-model="forwardSeekTime" val="5" :label="`5 ${$t('advanced.secondsUnit')}`" />
              <q-radio dense v-model="forwardSeekTime" val="10" :label="`10 ${$t('advanced.secondsUnit')}`" />
              <q-radio dense v-model="forwardSeekTime" val="30" :label="`30 ${$t('advanced.secondsUnit')}`" />
            </div>
          </q-item-section>
        </q-item>
      </q-list>
    </q-card>

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
      </q-list>
    </q-card>

    <q-card class="q-ma-md">
      <q-toolbar>
        <q-toolbar-title>{{ $t('advanced.otherSettings') }}</q-toolbar-title>
      </q-toolbar>

      <q-list>
        <q-item style="height: 70px;">
          <q-item-section>
            <q-item-label>{{ $t('advanced.checkUpdate') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.checkUpdateCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-toggle v-model="config.checkUpdate" dense />
          </q-item-section>
        </q-item>

        <q-item v-if="config.checkUpdate">
          <q-item-section>
            <q-item-label>{{ $t('advanced.checkBeta') }}</q-item-label>
            <q-item-label caption>{{ $t('advanced.checkBetaCaption') }}</q-item-label>
          </q-item-section>

          <q-item-section avatar>
            <q-toggle v-model="config.checkBetaUpdate" dense />
          </q-item-section>
        </q-item>

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
import { mapState } from 'vuex'
import { changeLanguage, getCurrentLocale } from '../../boot/i18n.js'

export default {
  name: 'Advanced',

  mixins: [NotifyMixin],

  data () {
    return {
      config: {},
      loading: false,
      rewindSeekTime: '5',
      forwardSeekTime: '30',
      currentLanguage: getCurrentLocale(),
    }
  },

  computed: {
    ...mapState('AudioPlayer', [
      'oldWorkCardUIStyle',
    ]),
    languageOptions () {
      return [
        { value: 'zh-CN', label: this.$t('advanced.langZhCN') },
        { value: 'en-US', label: this.$t('advanced.langEnUS') },
        { value: 'ja-JP', label: this.$t('advanced.langJaJP') },
        { value: 'zh-TW', label: this.$t('advanced.langZhTW') },
      ]
    },
  },

  methods: {
    requestConfig () {
      this.$axios.get('/api/config/admin')
        .then((response) => {
          this.config = response.data.config;
          // Integer => String
          this.rewindSeekTime = this.config.rewindSeekTime.toString()
          this.forwardSeekTime = this.config.forwardSeekTime.toString()
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
      // String => Integer
      this.config.rewindSeekTime = parseInt(this.rewindSeekTime)
      this.config.forwardSeekTime = parseInt(this.forwardSeekTime)

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

    changeOldWorkCardUIStyle(value) {
      console.log("change old work card ui to: ", value, typeof(value));
      this.$store.commit('AudioPlayer/SET_OLD_WORK_CARD_UI_STYLE', value);
    },

    async onLanguageChange (locale) {
      await changeLanguage(locale)
      this.currentLanguage = locale
    },
  },

  created () {
    this.requestConfig()

  }
}
</script>