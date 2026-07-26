import { boot } from 'quasar/wrappers'
import VueSlider from 'vue-slider-component'
import 'vue-slider-component/theme/default.css'

export default boot(({ app }) => {
  app.component('VueSlider', VueSlider)
})