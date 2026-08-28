// vue-i18n instance + locale resolution. Auto-discovers per-scope partial
// catalogs under src/i18n/parts/<locale>/ so parallel agents can add files
// without touching this index.
//
// Locales seeded: zh-CN (base/fallback), en-US, ja-JP, zh-TW — all complete.

import { createI18n } from 'vue-i18n'
import { LocalStorage } from 'quasar'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'zh-TW']
const STORAGE_KEY = 'app_language'
const FALLBACK_LOCALE = 'zh-CN'

// Current locale, readable by non-Vue code (translateTag). Updated by setLocale.
let currentLocale = FALLBACK_LOCALE

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

const initialLocale = getInitialLocale()
currentLocale = initialLocale

const i18n = createI18n({
  legacy: true, // Options API: this.$t
  locale: initialLocale,
  fallbackLocale: FALLBACK_LOCALE,
  messages: buildAllMessages(),
})

export default i18n
export { STORAGE_KEY }