import { register } from 'register-service-worker'
import { basePath } from '../src/base-path'

// The ready(), registered(), cached(), updatefound() and updated()
// events passes a ServiceWorkerRegistration instance in their arguments.
// ServiceWorkerRegistration: https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration

const serviceWorkerFile = `${basePath}/${process.env.SERVICE_WORKER_FILE.split('/').pop()}`

// No service worker in dev, because HMR depends on fetching those fresh.
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

    error (err) {
      console.error('[kikoenai] service worker registration failed:', err)
    }
  })
}
