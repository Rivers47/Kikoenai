import { LocalStorage } from 'quasar'

// Contrast tiers matching the classes generated in css/material-theme.scss.
// '' = follow the OS/browser preference (prefers-contrast media query).
export const CONTRAST_KEY = 'contrast_mode'
export const CONTRAST_MODES = ['', 'contrast-medium', 'contrast-high']

export function getContrastMode () {
  const saved = LocalStorage.getItem(CONTRAST_KEY)
  return CONTRAST_MODES.includes(saved) ? saved : ''
}

export function setContrastMode (mode) {
  document.body.classList.remove('contrast-medium', 'contrast-high')
  if (CONTRAST_MODES.includes(mode) && mode !== '') {
    document.body.classList.add(mode)
  }
  LocalStorage.set(CONTRAST_KEY, mode)
}
