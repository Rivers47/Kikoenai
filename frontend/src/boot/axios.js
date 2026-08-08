import { boot } from 'quasar/wrappers'
import axios from 'axios'
import { LocalStorage } from 'quasar'

axios.defaults.headers['Content-Type'] = "application/json"
// 会话 id 保存在 HttpOnly cookie 中，由浏览器自动携带
axios.defaults.withCredentials = true

// 迁移到 cookie 会话后，旧的 JWT 已无用且无法撤销，清除它以避免长期残留在 LocalStorage 中
LocalStorage.remove('jwt-token')

export default boot(({ app }) => {
  app.config.globalProperties.$axios = axios
})
