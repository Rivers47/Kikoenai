import { boot } from 'quasar/wrappers'
import { getThemeMode, setThemeMode } from 'src/utils/theme'

// Restore the saved theme before the app mounts, so a pinned scheme never
// paints the wrong one first
export default boot(() => {
  setThemeMode(getThemeMode())
})
