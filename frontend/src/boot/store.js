import { boot } from 'quasar/wrappers'
import createStore from '../store'

// @quasar/app-webpack v4 dropped Vuex support -- its store provider only ever
// auto-installs a Pinia store from src/stores/, so `hasStore` is false and
// src/store/index.js is never wired up by the framework. The store therefore
// has to be created and installed here.
//
// Register new Vuex modules in src/store/index.js, NOT in this file: keeping a
// second module list here is how the Downloads module ended up missing from
// the live store while looking registered.
export default boot(({ app }) => {
  app.use(createStore())
})
