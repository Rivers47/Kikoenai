import { boot } from 'quasar/wrappers'
import { createStore } from 'vuex'

import AudioPlayer from '../store/module-AudioPlayer'
import User from '../store/module-User'

export default boot(({ app }) => {
  const store = createStore({
    modules: {
      AudioPlayer,
      User
    },
     
    strict: process.env.DEV
  })

  app.use(store)
})