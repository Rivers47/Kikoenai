import { register } from 'register-service-worker'
import { Notify } from 'quasar'
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
    console.log('New content is available; please refresh.')
    Notify.create({
      message: '版本已更新',
      color: 'primary',
      textColor: 'white',
      icon: 'cached',
      actions: [
        { label: '刷新', color: 'white' }
      ],
      timeout: 10000,
      onDismiss () {
        location.reload(true)
      }
    })
  },

  offline () {
    // console.log('No internet connection found. App is running in offline mode.')
  },

  error (/* err */) {
    // console.error('Error during service worker registration:', err)
  }
})
