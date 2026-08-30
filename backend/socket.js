const path = require('path');
const socket = require('socket.io');
const cookie = require('cookie');
const child_process = require('child_process'); // 子进程
const { config } = require('./config');
const { SESSION_COOKIE, getSession } = require('./auth/session');

const initSocket = (server) => {
  // Socket.IO attaches to the HTTP server, not to Express, so it never sees the
  // router config.basePath is mounted on -- it has to be told the prefix. The
  // client mirrors this in src/boot/socket.io.js. Empty basePath gives
  // '/socket.io', which is the library default and what every existing install
  // is already talking to.
  const io = socket(server, { path: `${config.basePath}/socket.io` });
  if (config.auth) {
    io.use((socket, next) => {
      // The session id is in an HttpOnly cookie, which the browser attaches
      // to the same-origin handshake automatically.
      const cookies = cookie.parse(socket.handshake.headers.cookie || '');
      const secret = cookies[SESSION_COOKIE];

      if (!secret) {
        return next(new Error('未登录'));
      }

      getSession(secret)
        .then((user) => {
          if (!user) {
            return next(new Error('认证失败: 登录状态已失效'));
          }

          if (user.name !== 'admin') {
            return next(new Error('只有 admin 账号能登录管理后台.'));
          }

          // 兼容代码中 socket.request.user 的引用
          socket.request.user = user;
          next();
        })
        .catch((err) => next(new Error('认证失败: ' + err.message)));
    });
  }

  let scanner = null;

  // 有新的客户端连接时触发
  io.on('connection', function (socket) {
    // console.log('connection');
    socket.emit('success', {
      message: '成功登录管理后台.',
      user: socket.request.user,
      auth: config.auth
    });

    // socket.on('disconnect', () => {
    //   console.log('disconnect');
    // });
    
    socket.on('ON_SCANNER_PAGE', () => {
      if (scanner) {
        // 防止用户在扫描过程中刷新页面
        scanner.send({
          emit: 'SCAN_INIT_STATE'
        });
      }
    });

    socket.on('PERFORM_SCAN', () => {
      if (!scanner) {
        scanner = child_process.fork(path.join(__dirname, './filesystem/scanner.js'), { silent: false }); // 子进程
        scanner.on('exit', (code) => {
          scanner = null;
          if (code) {
            io.emit('SCAN_ERROR');
          }
        });
        
        scanner.on('message', (m) => {
          if (m.event) {
            io.emit(m.event, m.payload);
          }
        });
      }   
    });

    socket.on('PERFORM_UPDATE', () => {
      if (!scanner) {
        scanner = child_process.fork(path.join(__dirname, './filesystem/updater.js'), ['--refreshAll'], { silent: false }); // 子进程
        scanner.on('exit', (code) => {
          scanner = null;
          if (code) {
            io.emit('SCAN_ERROR');
          }
        });
        
        scanner.on('message', (m) => {
          if (m.event) {
            io.emit(m.event, m.payload);
          }
        });
      }   
    });

    socket.on('PERFORM_LYRIC_SCAN', () => {
      if (!scanner) {
        scanner = child_process.fork(path.join(__dirname, './filesystem/workFileScanner.js'), { silent: false }); // 子进程
        scanner.on('exit', (code) => {
          scanner = null;
          if (code) {
            io.emit('SCAN_ERROR');
          }
        });
        
        scanner.on('message', (m) => {
          if (m.event) {
            io.emit(m.event, m.payload);
          }
        });
      }   
    });

    socket.on('KILL_SCAN_PROCESS', () => {
      scanner.send({
        exit: 1
      });
    });

    // 发生错误时触发
    socket.on('error', (err) => {
      console.error(err);
    });
  });
};

module.exports = initSocket;