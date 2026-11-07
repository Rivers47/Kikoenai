// Registers vue-i18n, applies the Quasar lang pack for the current locale, and
// owns the runtime language switchers.
//
// The UI locale and the tag display locale are independent; see src/i18n/index.js.

import { boot } from 'quasar/wrappers'
import { Quasar } from 'quasar'
import i18n, {
  setLocale,
  setTagLocale,
  getInitialLocale,
  getCurrentLocale,
  getCurrentTagLocale,
  getTagLocalePref,
  FOLLOW_UI,
  SUPPORTED_TAG_LOCALES,
  STORAGE_KEY,
  TAG_STORAGE_KEY,
} from '../i18n'

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
 * Switch the UI locale at runtime. Updates vue-i18n, the Quasar lang pack
 * (which also owns `<html lang>` / `dir`), and persists the choice. Call from
 * the language switcher.
 */
export async function changeLanguage(locale) {
  setLocale(locale, i18n)
  await loadQuasarLang(locale)
}

/**
 * Switch the tag display locale at runtime. Pass FOLLOW_UI to track the UI
 * locale. Purely a display concern — stored tag names stay canonical Japanese.
 */
export function changeTagLanguage(locale) {
  setTagLocale(locale)
}

export default boot(async ({ app }) => {
  app.use(i18n)
  // Awaited on purpose: Quasar.lang.set() is what puts `lang`/`dir` on <html>
  // (from the pack's `isoName`), and Quasar waits for async boot files before
  // mounting. Without the await the first paint would carry no `lang` at all,
  // leaving the browser to pick CJK glyph variants from its own language
  // setting — the bug this whole path exists to prevent. `loadQuasarLang()`
  // always settles (it falls back to the en-US pack), so it cannot hang boot.
  await loadQuasarLang(getInitialLocale())
})

export {
  STORAGE_KEY,
  TAG_STORAGE_KEY,
  FOLLOW_UI,
  SUPPORTED_TAG_LOCALES,
  getCurrentLocale,
  getCurrentTagLocale,
  getTagLocalePref,
}
