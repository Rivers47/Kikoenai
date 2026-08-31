// Registers vue-i18n, syncs the Quasar lang pack to the current locale, and
// exposes the tag-translation helpers ($tTag, $tagLang). Locale resolution
// happens once here on boot (LocalStorage → browser → zh-CN).
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
  htmlLang,
  FOLLOW_UI,
  SUPPORTED_TAG_LOCALES,
  STORAGE_KEY,
  TAG_STORAGE_KEY,
} from '../i18n'
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

// The document has no `lang` of its own (index.template.html ships a bare
// <html>), so without this the browser picks its CJK font fallback from its
// own language setting rather than ours — which is how Japanese kanji end up
// drawn with Simplified-Chinese glyph shapes. Tag elements carry their own
// `lang` via $tagLang, since the tag locale can differ from the UI locale.
function syncDocumentLang(locale) {
  if (typeof document !== 'undefined') {
    document.documentElement.lang = htmlLang(locale)
  }
}

/**
 * Switch the UI locale at runtime. Updates vue-i18n, the Quasar lang pack,
 * the document language, and persists the choice. Call from the language switcher.
 */
export async function changeLanguage(locale) {
  setLocale(locale, i18n)
  syncDocumentLang(locale)
  await loadQuasarLang(locale)
}

/**
 * Switch the tag display locale at runtime. Pass FOLLOW_UI to track the UI
 * locale. Purely a display concern — stored tag names stay canonical Japanese.
 */
export function changeTagLanguage(locale) {
  setTagLocale(locale)
}

export default boot(({ app }) => {
  app.use(i18n)
  // Expose $tTag globally in templates (Options API). Resolves against the tag
  // locale, which is independent of the UI locale.
  app.config.globalProperties.$tTag = (name) => translateTag(name, getCurrentTagLocale())
  // BCP-47 code for the tag locale, for `lang` on elements rendering tag names.
  Object.defineProperty(app.config.globalProperties, '$tagLang', {
    get: () => htmlLang(getCurrentTagLocale()),
  })
  // Apply the initial Quasar lang pack and document language.
  const initial = getInitialLocale()
  syncDocumentLang(initial)
  loadQuasarLang(initial)
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
