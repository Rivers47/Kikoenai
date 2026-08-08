import { boot } from 'quasar/wrappers'
import { io } from 'socket.io-client'

// 鉴权走同源的会话 cookie，握手时由浏览器自动携带
const socket = io('', {
  autoConnect: false
})

export default boot(({ app }) => {
  app.config.globalProperties.$socket = socket
})

export { socket }