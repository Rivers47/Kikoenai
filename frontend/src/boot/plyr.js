import { boot } from 'quasar/wrappers'
import Plyr from 'plyr'
import 'plyr/dist/plyr.css'

// Make Plyr available globally
export default boot(({ app }) => {
  app.config.globalProperties.$Plyr = Plyr
})