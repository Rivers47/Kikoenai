import { Dark, LocalStorage } from 'quasar'

// Theme preference. 'auto' follows the OS/browser preference through Quasar's
// `dark: 'auto'` config; the explicit modes pin one scheme.
export const THEME_KEY = 'theme_mode'
export const THEME_MODES = ['auto', 'light', 'dark']

export function getThemeMode () {
  const saved = LocalStorage.getItem(THEME_KEY)
  return THEME_MODES.includes(saved) ? saved : 'auto'
}

export function setThemeMode (mode) {
  const next = THEME_MODES.includes(mode) ? mode : 'auto'
  Dark.set(next === 'auto' ? 'auto' : next === 'dark')
  LocalStorage.set(THEME_KEY, next)
}
