// vue-i18n instance + locale resolution. Auto-discovers per-scope partial
// catalogs under src/i18n/parts/<locale>/ so parallel agents can add files
// without touching this index.
//
// Locales seeded: zh-CN (base/fallback), en-US, ja-JP, zh-TW — all complete.
//
// Two independent locales live here: the UI locale (vue-i18n catalog) and the
// tag display locale (translateTag). The tag locale defaults to FOLLOW_UI, so
// it tracks the UI locale until the user pins it to something else.

import { createI18n } from 'vue-i18n'
import { LocalStorage } from 'quasar'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'zh-TW']
const STORAGE_KEY = 'app_language'
const TAG_STORAGE_KEY = 'tag_language'
const FALLBACK_LOCALE = 'zh-CN'

/** Sentinel tag-locale value meaning "whatever the UI locale is". */
export const FOLLOW_UI = 'follow'
export const SUPPORTED_TAG_LOCALES = [FOLLOW_UI, ...SUPPORTED_LOCALES]

// BCP-47 codes for the HTML `lang` attribute. Browsers pick the CJK font
// fallback from this, which is what keeps Han characters out of the wrong
// glyph variants (Japanese kanji drawn with Simplified-Chinese shapes).
const HTML_LANG = {
  'zh-CN': 'zh-Hans',
  'zh-TW': 'zh-Hant',
  'ja-JP': 'ja',
  'en-US': 'en',
}

// Current locales, readable by non-Vue code (translateTag). Plain variables,
// not refs: $tTag has no reactive dependency on them, so a switch does not
// repaint anything already on screen. That is safe only because both switchers
// live in Settings.vue under DashboardLayout, and reaching it unmounts
// MainLayout — and with it the <keep-alive> holding Works/Favourites — so every
// tag is re-rendered from scratch on the way back. Move a switcher into
// MainLayout (a drawer item, a dialog) and this stops being true: make these
// refs then, or the chips go stale.
let currentLocale = FALLBACK_LOCALE
let tagLocalePref = FOLLOW_UI

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
  return currentLocale
}

export function setLocale(locale, i18n) {
  if (!SUPPORTED_LOCALES.includes(locale)) locale = FALLBACK_LOCALE
  currentLocale = locale
  if (i18n) i18n.global.locale = locale
  LocalStorage.set(STORAGE_KEY, locale)
}

/** The stored tag-locale preference, which may be the FOLLOW_UI sentinel. */
export function getTagLocalePref() {
  return tagLocalePref
}

/** The tag locale actually in effect (FOLLOW_UI resolved against the UI locale). */
export function getCurrentTagLocale() {
  return tagLocalePref === FOLLOW_UI ? currentLocale : tagLocalePref
}

export function setTagLocale(locale) {
  if (!SUPPORTED_TAG_LOCALES.includes(locale)) locale = FOLLOW_UI
  tagLocalePref = locale
  LocalStorage.set(TAG_STORAGE_KEY, locale)
}

export function getInitialTagLocale() {
  const stored = LocalStorage.getItem(TAG_STORAGE_KEY)
  if (stored && SUPPORTED_TAG_LOCALES.includes(stored)) return stored
  return FOLLOW_UI
}

/** BCP-47 code for a locale, for use in an HTML `lang` attribute. */
export function htmlLang(locale) {
  return HTML_LANG[locale] || 'en'
}

const initialLocale = getInitialLocale()
currentLocale = initialLocale
tagLocalePref = getInitialTagLocale()

const i18n = createI18n({
  legacy: true, // Options API: this.$t
  locale: initialLocale,
  fallbackLocale: FALLBACK_LOCALE,
  messages: buildAllMessages(),
})

export default i18n
export { STORAGE_KEY, TAG_STORAGE_KEY }