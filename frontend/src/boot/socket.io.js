import { boot } from 'quasar/wrappers'
import { io } from 'socket.io-client'

// Auth rides the same-origin session cookie, sent with the handshake automatically
const socket = io('', {
  autoConnect: false
})

export default boot(({ app }) => {
  app.config.globalProperties.$socket = socket
})

export { socket }