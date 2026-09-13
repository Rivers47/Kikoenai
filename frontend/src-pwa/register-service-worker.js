import { register } from 'register-service-worker'
import { basePath } from '../src/base-path'

// The ready(), registered(), cached(), updatefound() and updated()
// events passes a ServiceWorkerRegistration instance in their arguments.
// ServiceWorkerRegistration: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration

 
// process.env.SERVICE_WORKER_FILE is build.publicPath + the worker's filename,
// so in production it carries the unresolved placeholder -- only the filename
// part of it is usable. A worker's scope can never be broader than its own URL,
// so both the URL and the scope have to name the deploy prefix, or an install
// under /kikoeru would register a worker that controls nothing.
const serviceWorkerFile = `${basePath}/${process.env.SERVICE_WORKER_FILE.split('/').pop()}`

// No service worker in dev, because `quasar dev -m pwa` emits a real Workbox one
// -- skipWaiting + clientsClaim, precaching index.html, the bundle, and the
// *.hot-update.* files. Hot Module Replacement depends on fetching those fresh:
// serve them from a cache and the patch does not apply, so webpack either falls
// back to a full reload or quietly runs stale code. "I edited the file and
// nothing changed" is the symptom, and it is a miserable one to chase.
//
// Unregister rather than merely skip: a worker left by an earlier dev session
// keeps controlling the origin on its own.
//
// This is NOT about the old infinite-reload loop. That had a different cause --
// an `updated()` Notify whose `onDismiss` called location.reload(), which fires
// on the dismiss *timeout* as well as on the action, so every recompile
// scheduled a reload ten seconds later. Deleting that Notify fixed it (17e3e6b);
// unregistering never addressed it. Do not remove this block on the grounds that
// the loop is gone.
//
// What this costs, now that startWorkDownload has a foreground path: whole-work
// downloads DO work in dev, because canBackgroundFetch() is false without a
// worker and Cache Storage does not need one. Offline *playback* still does not
// -- AudioElement requests /api/media/offline/... over the network and there is
// no worker to answer it from the cache. Use a production build for that.
if (process.env.DEV) {
  navigator.serviceWorker?.getRegistrations()
    .then(registrations => registrations.forEach(registration => registration.unregister()))
} else {
  register(serviceWorkerFile, {
    // The registrationOptions object will be passed as the second argument
    // to ServiceWorkerContainer.register()
    // https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerContainer/register#Parameter
    registrationOptions: { scope: `${basePath}/` },

    ready (/* registration */) {
      // console.log('Service worker is active.')
    },

    registered (/* registration */) {
      // console.log('Service worker has been registered.')
    },

    cached (/* registration */) {
      // console.log('Content has been cached for offline use.')
    },

    updatefound (/* registration */) {
      console.log('New content is downloading.')
    },

    updated (/* registration */) {
      // console.log('New content is available; please refresh.')
    },

    offline () {
      // console.log('No internet connection found. App is running in offline mode.')
    },

    // Not commented out like the others: everything offline depends on this
    // registration, and a silent failure is indistinguishable from a worker that
    // registered but has not claimed the page yet. Diagnosing that from
    // `navigator.serviceWorker.controller === null` alone is guesswork.
    error (err) {
      console.error('[kikoenai] service worker registration failed:', err)
    }
  })
}
