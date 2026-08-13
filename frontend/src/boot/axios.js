import { boot } from 'quasar/wrappers'
import axios from 'axios'
import { LocalStorage } from 'quasar'
import { apiUrl } from '../base-path'
import i18n from '../i18n'
import { enqueue, isQueueable, requestSync } from '../utils/outbox'

axios.defaults.headers['Content-Type'] = "application/json"
// The session id lives in an HttpOnly cookie, attached by the browser automatically
axios.defaults.withCredentials = true

// Without a timeout a throttled radio -- a locked phone playing in the
// background -- leaves the request hanging indefinitely and no handler ever
// runs, so the write is lost with nothing to catch. A timeout turns that into
// ECONNABORTED, which reaches the response interceptor below like any other
// transport failure.
//
// Scoped to the writes the outbox can replay rather than set as a default:
// admin operations such as POST /api/backfill/progress run the whole library
// synchronously and legitimately take minutes.
const WRITE_TIMEOUT_MS = 10000

// Both concerns live in one interceptor so their order is explicit rather than
// resting on axios running request interceptors last-registered-first: the
// queueable check must see the raw /api/... URL, because that is the form
// isQueueable() matches, and the deploy prefix goes on afterwards.
//
// Every request this app makes is a root-relative /api path, and when the
// server is configured to live under a sub-path that prefix has to go in front
// of all of them. Doing it here rather than at each of the ~40 call sites means
// a newly added request cannot silently forget it -- and, since the prefix is
// empty for a root-served install, this is a no-op for everyone else.
//
// Not axios.defaults.baseURL: that would apply a second time to the handful of
// URLs already passed through apiUrl() by hand. apiUrl() is idempotent.
axios.interceptors.request.use((config) => {
  if ((config.method || 'get').toLowerCase() !== 'get' && isQueueable(axios.getUri(config))) {
    config.timeout = config.timeout || WRITE_TIMEOUT_MS
  }
  config.url = apiUrl(config.url)
  return config
})

// After the move to cookie sessions the old JWT is useless and cannot be revoked;
// clear it so it does not linger in LocalStorage
LocalStorage.remove('jwt-token')

// A same-origin XHR can still fail at the transport layer, with no HTTP response
// at all -- axios surfaces that as a bare "Network Error" (code ERR_NETWORK),
// which is indistinguishable from the server being down even though the very
// next request succeeds.
//
// The confirmed trigger for this app is Firefox's Local Network Access check,
// which every self-hosted install behind a public hostname resolving to a LAN
// address will hit. During the check Firefox opens several HTTP/2 connections at
// page load, keeps one, and abandons the rest -- silently killing the requests
// already dispatched on the losers. It re-dispatches some of them but not all,
// and the dropped ones surface here as a bare "Network Error".
//
// Diagnosed from the reverse proxy's access log: the failed requests arrive with
// status 0, zero bytes, ~80us duration and no upstream headers -- the proxy
// accepted the stream and the client vanished before the backend was dialed.
// Success/failure tracks the client port (i.e. which connection the request
// landed on), never the endpoint. Nothing server-side can prevent it; adding
// the domain to Firefox's network.lna.skip-domains does, but that is per-browser
// and not something a self-hosted app can ship.
//
// So retrying is the only fix available to us, and it is both safe and
// sufficient: the retry lands on the surviving connection. Restricted to GET so
// a state-changing request can never be replayed, and capped so a genuinely
// unreachable server still fails fast.
const MAX_RETRIES = 2
const RETRY_DELAY_MS = 300

// A playback-state write that never reached the server goes to the outbox and
// is reported to the caller as a success, so no call site needs a "queued" code
// path -- every one of them only reads response.data.message and notifies.
// Returns null when the request is not one we are willing to replay later.
async function queueWrite (config) {
  if (!config || (config.method || 'get').toLowerCase() === 'get') return null
  // sendOrQueue already owns this request's row; let it see the failure.
  if (config.__outboxed) return null

  const url = axios.getUri(config)
  if (!isQueueable(url)) return null

  let body = {}
  try { body = config.data ? JSON.parse(config.data) : {} } catch { return null }

  try {
    await enqueue({ method: config.method.toUpperCase(), url, body })
    await requestSync()
  } catch (err) {
    console.error('outbox enqueue failed:', err)
    return null
  }

  return {
    data: { message: i18n.global.t('common.success') },
    status: 200,
    statusText: 'OK',
    headers: {},
    config,
  }
}

axios.interceptors.response.use(null, async (err) => {
  const config = err.config

  // An HTTP error (4xx/5xx) has err.response and must reach the caller
  // untouched; only a missing response means the request never completed.
  const isTransportError = !err.response && err.code !== 'ERR_CANCELED'
  const isIdempotent = config && (config.method || 'get').toLowerCase() === 'get'
  if (!isTransportError || !isIdempotent) {
    if (isTransportError) {
      const queued = await queueWrite(config)
      if (queued) return queued
    }
    return Promise.reject(err)
  }

  config.retryCount = config.retryCount || 0
  if (config.retryCount >= MAX_RETRIES) {
    return Promise.reject(err)
  }
  config.retryCount += 1

  await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS * config.retryCount))
  return axios(config)
})

export default boot(({ app }) => {
  app.config.globalProperties.$axios = axios
})
