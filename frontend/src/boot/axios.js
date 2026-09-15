import { boot } from 'quasar/wrappers'
import axios from 'axios'
import { LocalStorage } from 'quasar'
import { apiUrl } from '../base-path'
import i18n from '../i18n'
import { canSync, enqueue, isQueueable, requestSync } from '../utils/outbox'

axios.defaults.headers['Content-Type'] = "application/json"
// The session id lives in an HttpOnly cookie, attached by the browser automatically
axios.defaults.withCredentials = true

const WRITE_TIMEOUT_MS = 10000

axios.interceptors.request.use((config) => {
  if ((config.method || 'get').toLowerCase() !== 'get' && isQueueable(axios.getUri(config))) {
    config.timeout = config.timeout || WRITE_TIMEOUT_MS
  }
  config.url = apiUrl(config.url)
  return config
})

// After the move to cookie sessions clear the old JWT
LocalStorage.remove('jwt-token')

async function queueWrite (config) {
  if (!config || (config.method || 'get').toLowerCase() === 'get') return null
  // sendOrQueue already owns this request's row; let it see the failure.
  if (config.__outboxed) return null
  // Nothing would ever drain the row, so reporting success would be a lie --
  // reject as before and let the call site show its error. See canSync().
  if (!canSync()) return null

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
  const isTransportError = !err.response && err.code !== 'ERR_CANCELED'
  if (isTransportError) {
    const queued = await queueWrite(config)
    if (queued) return queued
  }
  return Promise.reject(err)
})

export default boot(({ app }) => {
  app.config.globalProperties.$axios = axios
})
