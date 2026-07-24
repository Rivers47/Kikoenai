import { boot } from 'quasar/wrappers'
import { io } from 'socket.io-client'

const socket = io('', {
  autoConnect: false,
  query: {
    auth_token: ''
  }
})

export default boot(({ app }) => {
  app.config.globalProperties.$socket = socket
})

export { socket }