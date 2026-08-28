// Registers vue-i18n, syncs the Quasar lang pack to the current locale, and
// exposes the tag-translation helper ($tTag). Locale resolution happens once
// here on boot (LocalStorage → browser → zh-CN).

import { boot } from 'quasar/wrappers'
import { Quasar } from 'quasar'
import i18n, { setLocale, getInitialLocale, getCurrentLocale, STORAGE_KEY } from '../i18n'
import { translateTag } from '../i18n/tags'

// Map our locale → Quasar lang pack import. Dynamic import per locale; guard
// load failure by falling back to en-US.
const QUASAR_LANG_IMPORT = {
  'zh-CN': () => import('quasar/lang/zh-CN'),
  'en-US': () => import('quasar/lang/en-US'),
  'ja-JP': () => import('quasar/lang/ja'),
  'zh-TW': () => import('quasar/lang/zh-TW'),
}

async function loadQuasarLang(locale) {
  try {
    const pack = (await QUASAR_LANG_IMPORT[locale]()).default
    Quasar.lang.set(pack)
  } catch (err) {
    console.warn('Failed to load Quasar lang pack for', locale, '— falling back to en-US', err)
    try {
      const pack = (await QUASAR_LANG_IMPORT['en-US']()).default
      Quasar.lang.set(pack)
    } catch (_) { /* give up silently */ }
  }
}

/**
 * Switch the UI locale at runtime. Updates vue-i18n, the Quasar lang pack,
 * and persists the choice. Call from the language switcher.
 */
export async function changeLanguage(locale) {
  setLocale(locale, i18n)
  await loadQuasarLang(locale)
}

export default boot(({ app }) => {
  app.use(i18n)
  // Expose $tTag globally in templates (Options API).
  app.config.globalProperties.$tTag = (name) => translateTag(name, getCurrentLocale())
  // Apply the initial Quasar lang pack.
  loadQuasarLang(getInitialLocale())
})

export { STORAGE_KEY, getCurrentLocale }