<template>
  <q-card class="q-ma-md">
    <q-toolbar>
      <q-toolbar-title>{{ $t('settings.generalTitle') }}</q-toolbar-title>
      <q-item-label caption>{{ $t('settings.generalCaption') }}</q-item-label>
    </q-toolbar>

    <q-list>
      <q-item style="height: 70px;">
        <q-item-section>
          <q-item-label>{{ $t('settings.language') }}</q-item-label>
          <q-item-label caption>{{ $t('settings.languageCaption') }}</q-item-label>
        </q-item-section>

        <q-item-section avatar>
          <q-select
            v-model="currentLanguage"
            :options="languageOptions"
            emit-value
            map-options
            dense
            outlined
            style="min-width: 180px;"
            @update:model-value="onLanguageChange"
          />
        </q-item-section>
      </q-item>

      <q-item style="height: 70px;">
        <q-item-section>
          <q-item-label>{{ $t('settings.autoMarkListened') }}</q-item-label>
          <q-item-label caption>{{ $t('settings.autoMarkListenedCaption') }}</q-item-label>
        </q-item-section>

        <q-item-section avatar>
          <q-toggle
            :model-value="autoMarkListened"
            @update:model-value="onAutoMarkChange"
            dense
          />
        </q-item-section>
      </q-item>

      <q-item style="height: 70px;">
        <q-item-section>
          <q-item-label>{{ $t('advanced.legacyCardUi') }}</q-item-label>
          <q-item-label caption>{{ $t('advanced.legacyCardUiCaption') }}</q-item-label>
        </q-item-section>

        <q-item-section avatar>
          <q-toggle
            :model-value="oldWorkCardUIStyle"
            @update:model-value="onLegacyCardChange"
            dense
          />
        </q-item-section>
      </q-item>

      <q-separator />

      <q-item style="height: 70px;">
        <q-item-section>
          <q-item-label>{{ $t('advanced.rewindSeconds') }}</q-item-label>
          <q-item-label caption>{{ $t('advanced.rewindSecondsCaption') }}</q-item-label>
        </q-item-section>

        <q-item-section avatar>
          <div class="q-gutter-sm">
            <q-radio dense :model-value="rewindSeekTime" @update:model-value="onRewindChange" :val="5" :label="`5 ${$t('advanced.secondsUnit')}`" />
            <q-radio dense :model-value="rewindSeekTime" @update:model-value="onRewindChange" :val="10" :label="`10 ${$t('advanced.secondsUnit')}`" />
            <q-radio dense :model-value="rewindSeekTime" @update:model-value="onRewindChange" :val="30" :label="`30 ${$t('advanced.secondsUnit')}`" />
          </div>
        </q-item-section>
      </q-item>

      <q-item style="height: 70px;">
        <q-item-section>
          <q-item-label>{{ $t('advanced.forwardSeconds') }}</q-item-label>
          <q-item-label caption>{{ $t('advanced.forwardSecondsCaption') }}</q-item-label>
        </q-item-section>

        <q-item-section avatar>
          <div class="q-gutter-sm">
            <q-radio dense :model-value="forwardSeekTime" @update:model-value="onForwardChange" :val="5" :label="`5 ${$t('advanced.secondsUnit')}`" />
            <q-radio dense :model-value="forwardSeekTime" @update:model-value="onForwardChange" :val="10" :label="`10 ${$t('advanced.secondsUnit')}`" />
            <q-radio dense :model-value="forwardSeekTime" @update:model-value="onForwardChange" :val="30" :label="`30 ${$t('advanced.secondsUnit')}`" />
          </div>
        </q-item-section>
      </q-item>
    </q-list>
  </q-card>
</template>

<script>
import { mapState } from 'vuex'
import NotifyMixin from '../../mixins/Notification.js'
import { changeLanguage, getCurrentLocale } from 'src/boot/i18n.js'

export default {
  name: 'Settings',

  mixins: [NotifyMixin],

  data () {
    return {
      currentLanguage: null,
    }
  },

  computed: {
    ...mapState('AudioPlayer', [
      'autoMarkListened',
      'oldWorkCardUIStyle',
      'rewindSeekTime',
      'forwardSeekTime',
    ]),

    languageOptions () {
      return [
        { value: 'zh-CN', label: this.$t('mainlayout.langZhCN') },
        { value: 'en-US', label: this.$t('mainlayout.langEnUS') },
        { value: 'ja-JP', label: this.$t('mainlayout.langJaJP') },
        { value: 'zh-TW', label: this.$t('mainlayout.langZhTW') },
      ]
    },
  },

  created () {
    this.currentLanguage = getCurrentLocale()
  },

  methods: {
    async onLanguageChange (locale) {
      await changeLanguage(locale)
      this.showSuccNotif(this.$t('settings.languageSaved'))
    },

    onAutoMarkChange (value) {
      this.$store.commit('AudioPlayer/SET_AUTO_MARK_LISTENED', value)
      this.showSuccNotif(value
        ? this.$t('settings.autoMarkEnabled')
        : this.$t('settings.autoMarkDisabled'))
    },

    onLegacyCardChange (value) {
      this.$store.commit('AudioPlayer/SET_OLD_WORK_CARD_UI_STYLE', value)
    },

    onRewindChange (value) {
      this.$store.commit('AudioPlayer/SET_REWIND_SEEK_TIME', value)
    },

    onForwardChange (value) {
      this.$store.commit('AudioPlayer/SET_FORWARD_SEEK_TIME', value)
    },
  },
}
</script>
