import { boot } from 'quasar/wrappers'
import { getContrastMode, setContrastMode } from 'src/utils/contrast'

// Restore the saved contrast tier before the app mounts
export default boot(() => {
  setContrastMode(getContrastMode())
})
