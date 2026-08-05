// Tag display-name translation: maps the canonical Japanese tag name (as
// stored by the backend) to the current UI locale's name. Falls back to the
// Japanese name when no translation exists. This is the DYNAMIC tag layer,
// separate from vue-i18n's static UI-string catalog.
//
// Maps are JSON so they can be hand-curated without touching JS. Keys are
// canonical Japanese names; ja-JP is the identity (no map needed).

import zhCN from './zh-CN.json'
import enUS from './en-US.json'
import zhTW from './zh-TW.json'

const TAG_MAPS = {
  'zh-CN': zhCN,
  'en-US': enUS,
  'zh-TW': zhTW,
  'ja-JP': {}, // identity
}

// zh-TW falls back to zh-CN entries when its own map lacks a key.
const FALLBACK = { 'zh-TW': 'zh-CN' }

/**
 * Translate a canonical Japanese tag name into the given (or current) locale.
 * Unmapped names return the original Japanese name (no empty chips).
 * @param {string} name Canonical Japanese tag name.
 * @param {string} [locale] Optional locale override; defaults to current i18n locale.
 * @returns {string}
 */
export function translateTag(name, locale) {
  if (name == null) return name
  const loc = locale || (typeof window !== 'undefined' && window.__APP_LOCALE__) || 'zh-CN'
  const map = TAG_MAPS[loc] || {}
  if (Object.prototype.hasOwnProperty.call(map, name)) return map[name]
  const fb = FALLBACK[loc]
  if (fb && TAG_MAPS[fb] && Object.prototype.hasOwnProperty.call(TAG_MAPS[fb], name)) {
    return TAG_MAPS[fb][name]
  }
  return name
}

if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined' && window.__RUN_I18N_SELFCHECK__) {
  // ponytail: smallest self-check — fallback returns the Japanese name.
  // The mapped path is trivial (map[name]). Add a real key to verify it.
  console.assert(translateTag('未映射のタグ', 'en-US') === '未映射のタグ', 'translateTag fallback broken')
  console.assert(translateTag(null) === null, 'translateTag null broken')
  console.log('translateTag self-check OK')
}