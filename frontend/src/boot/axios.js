import { boot } from 'quasar/wrappers'
import axios from 'axios'
import { LocalStorage } from 'quasar'
import { apiUrl } from '../base-path'

axios.defaults.headers['Content-Type'] = "application/json"
// The session id lives in an HttpOnly cookie, attached by the browser automatically
axios.defaults.withCredentials = true

// Every request this app makes is a root-relative /api path, and when the
// server is configured to live under a sub-path that prefix has to go in front
// of all of them. Doing it here rather than at each of the ~40 call sites means
// a newly added request cannot silently forget it -- and, since the prefix is
// empty for a root-served install, this is a no-op for everyone else.
//
// Not axios.defaults.baseURL: that would apply a second time to the handful of
// URLs already passed through apiUrl() by hand. apiUrl() is idempotent.
axios.interceptors.request.use((config) => {
  config.url = apiUrl(config.url)
  return config
})

// After the move to cookie sessions the old JWT is useless and cannot be revoked;
// clear it so it does not linger in LocalStorage
LocalStorage.remove('jwt-token')

export default boot(({ app }) => {
  app.config.globalProperties.$axios = axios
})
