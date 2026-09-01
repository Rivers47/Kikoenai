import { boot } from 'quasar/wrappers'
import { io } from 'socket.io-client'
import { basePath } from '../base-path'

// Auth rides the same-origin session cookie, sent with the handshake automatically.
// `path` mirrors backend/socket.js: Socket.IO hangs off the HTTP server rather
// than the Express router carrying config.basePath, so both ends have to apply
// the prefix themselves. Empty prefix gives '/socket.io', the library default.
const socket = io('', {
  path: `${basePath}/socket.io`,
  autoConnect: false
})

export default boot(({ app }) => {
  app.config.globalProperties.$socket = socket
})

export { socket }