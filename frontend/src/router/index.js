import { createRouter, createWebHistory } from 'vue-router'

import routes from './routes'
import { basePath } from '../base-path'

/*
 * If not building with SSR mode, you can
 * directly export the Router instantiation;
 *
 * The function below can be async too; either use
 * async/await or return a Promise which resolves
 * with the Router instance.
 */

export default function (/* { store, ssrContext } */) {
  // Prevent the browser from auto-restoring scroll on popstate — that conflicts
  // with Vue Router's scrollBehavior (especially with keep-alive components).
  if (typeof window !== 'undefined') {
    window.history.scrollRestoration = 'manual'
  }

  const Router = createRouter({
    scrollBehavior(to, from, savedPosition) {
      if (savedPosition) {
        return savedPosition
      }
      // Walking the work tree navigates to #work-tree; keep the list in view
      // instead of jumping back up to the work details on every folder click.
      if (to.hash && typeof document !== 'undefined' && document.querySelector(to.hash)) {
        return { el: to.hash }
      }
      return { x: 0, y: 0 }
    },
    routes,

    // Not process.env.VUE_ROUTER_BASE: Quasar derives that from
    // build.publicPath, which in production is the placeholder the backend
    // rewrites only inside index.html. The prefix the router needs is the
    // resolved one the server injected. quasar.conf.js -> build -> vueRouterMode
    // still owns the history/hash choice.
    history: createWebHistory(`${basePath}/`)
  })

  return Router
}