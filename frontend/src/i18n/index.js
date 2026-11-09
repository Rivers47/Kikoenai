// vue-i18n instance + locale resolution. Auto-discovers per-scope partial
// catalogs under src/i18n/parts/<locale>/ so parallel agents can add files
// without touching this index.
//
// Locales seeded: zh-CN (base/fallback), en-US, ja-JP, zh-TW — all complete.
//
// Two independent locales live here: the UI locale (vue-i18n catalog) and the
// tag display locale (translateTag). The tag locale defaults to FOLLOW_UI, so
// it tracks the UI locale until the user pins it to something else.

import { computed, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { LocalStorage } from 'quasar'
import { translateTag } from './tags'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'zh-TW']
const STORAGE_KEY = 'app_language'
const TAG_STORAGE_KEY = 'tag_language'
const FALLBACK_LOCALE = 'zh-CN'

/** Sentinel tag-locale value meaning "whatever the UI locale is". */
export const FOLLOW_UI = 'follow'
export const SUPPORTED_TAG_LOCALES = [FOLLOW_UI, ...SUPPORTED_LOCALES]

// BCP-47 *script* codes for the `lang` attribute on elements that render a tag
// name (never for <html> — Quasar's lang pack owns that attribute, writing its
// own `isoName`). Browsers pick the CJK font fallback from the nearest `lang`,
// so this is what keeps a tag name out of the wrong glyph variants (Japanese
// kanji drawn with Simplified-Chinese shapes), even when the tag locale differs
// from the UI locale.
const HTML_LANG = {
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'ja-JP': 'ja',
  'en-US': 'en',
}

// Current locales, readable by non-Vue code (translateTag). Refs: the tag names
// in Cover/WorkCard/WorkListItem/List are rendered without any `t()` call, so
// they only repaint on a locale switch if the render subscribed to these —
// `tTag()` and `tagLang` in useTagTranslate() read them, which is what makes a
// switch repaint already-mounted (keep-alive) pages. Do not go back to plain
// variables.
const currentLocale = ref(FALLBACK_LOCALE)
const tagLocalePref = ref(FOLLOW_UI)

// Webpack require.context auto-imports every partial per locale. Agents just
// drop a new <scope>.js file into parts/<locale>/ and it's picked up here.
const req = require.context('./parts', true, /\/(zh-CN|en-US|ja-JP|zh-TW)\/.+\.js$/)

function loadMessages(locale) {
  const messages = {}
  // common first (so it's visible when iterating), then every other scope.
  req.keys().forEach((key) => {
    // key like './zh-CN/workdetails.js'
    const m = key.match(/^\.\/(zh-CN|en-US|ja-JP|zh-TW)\/(.+)\.js$/)
    if (!m || m[1] !== locale) return
    const scope = m[2]
    if (scope === 'common') {
      messages.common = { ...(messages.common || {}), ...req(key).default }
    } else {
      messages[scope] = { ...(messages[scope] || {}), ...req(key).default }
    }
  })
  return messages
}

function buildAllMessages() {
  const all = {}
  for (const loc of SUPPORTED_LOCALES) {
    all[loc] = loadMessages(loc)
  }
  return all
}

/** Match navigator.language to a supported locale (exact, then prefix). */
function detectBrowserLocale() {
  if (typeof navigator === 'undefined') return FALLBACK_LOCALE
  const langs = [navigator.language, ...(navigator.languages || [])].filter(Boolean)
  for (const l of langs) {
    if (SUPPORTED_LOCALES.includes(l)) return l
    // Traditional variants (zh-Hant / zh-HK / zh-MO) → zh-TW; other zh → zh-CN.
    if (/^zh\b.*\b(hant|hk|mo|tw)\b/i.test(l.replace(/-/g, ' '))) return 'zh-TW'
    if (/^zh/i.test(l)) return 'zh-CN'
    if (/^ja/i.test(l)) return 'ja-JP'
    if (/^en/i.test(l)) return 'en-US'
  }
  return FALLBACK_LOCALE
}

export function getInitialLocale() {
  const stored = LocalStorage.getItem(STORAGE_KEY)
  if (stored && SUPPORTED_LOCALES.includes(stored)) return stored
  return detectBrowserLocale()
}

export function getCurrentLocale() {
  return currentLocale.value
}

export function setLocale(locale, i18n) {
  if (!SUPPORTED_LOCALES.includes(locale)) locale = FALLBACK_LOCALE
  currentLocale.value = locale
  if (i18n) i18n.global.locale.value = locale
  LocalStorage.set(STORAGE_KEY, locale)
}

/** The stored tag-locale preference, which may be the FOLLOW_UI sentinel. */
export function getTagLocalePref() {
  return tagLocalePref.value
}

const currentTagLocale = computed(() =>
  tagLocalePref.value === FOLLOW_UI ? currentLocale.value : tagLocalePref.value
)

/** The tag locale actually in effect (FOLLOW_UI resolved against the UI locale). */
export function getCurrentTagLocale() {
  return currentTagLocale.value
}

export function setTagLocale(locale) {
  if (!SUPPORTED_TAG_LOCALES.includes(locale)) locale = FOLLOW_UI
  tagLocalePref.value = locale
  LocalStorage.set(TAG_STORAGE_KEY, locale)
}

export function getInitialTagLocale() {
  const stored = LocalStorage.getItem(TAG_STORAGE_KEY)
  if (stored && SUPPORTED_TAG_LOCALES.includes(stored)) return stored
  return FOLLOW_UI
}

/** BCP-47 script code for the tag layer's per-element `lang` attribute. */
export function htmlLang(locale) {
  return HTML_LANG[locale] || 'en'
}

export function useTagTranslate() {
  return {
    tTag: (name) => translateTag(name, currentTagLocale.value),
    tagLang: computed(() => htmlLang(currentTagLocale.value)),
  }
}

const initialLocale = getInitialLocale()
currentLocale.value = initialLocale
tagLocalePref.value = getInitialTagLocale()

const i18n = createI18n({
  legacy: false,
  globalInjection: false,
  locale: initialLocale,
  fallbackLocale: FALLBACK_LOCALE,
  messages: buildAllMessages(),
})

export default i18n
export { STORAGE_KEY, TAG_STORAGE_KEY }