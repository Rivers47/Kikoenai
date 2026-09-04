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

// `quasar dev -m pwa` emits a real Workbox worker -- skipWaiting + clientsClaim,
// precaching index.html, the bundle, even the hot-update files. Every recompile
// ships a new worker that claims the live page and then answers from that stale
// snapshot, so the HMR client's hash never matches and the page reloads forever.
// Unregister rather than merely skip: a worker left behind by an earlier dev
// session keeps controlling localhost:8080 on its own.
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

    error (/* err */) {
      // console.error('Error during service worker registration:', err)
    }
  })
}
