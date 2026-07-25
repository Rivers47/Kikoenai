const path = require('path');
const socket = require('socket.io');
const jwt = require('jsonwebtoken'); // 用于 JWT 验证
const child_process = require('child_process'); // 子进程
const { config } = require('./config');

const initSocket = (server) => {
  const io = socket(server);
  if (config.auth) {
    io.use((socket, next) => {
      // socket.io-client v4 通过 auth 发送 token，同时也支持 query 方式以兼容旧客户端
      const token = socket.handshake.auth && socket.handshake.auth.auth_token
        || socket.handshake.query && socket.handshake.query.auth_token;

      if (!token) {
        return next(new Error('No auth token'));
      }

      jwt.verify(token, config.jwtsecret, (err, payload) => {
        if (err) {
          return next(new Error('认证失败: ' + err.message));
        }

        const user = {
          name: payload.name,
          group: payload.group
        };

        if (user.name !== 'admin') {
          return next(new Error('只有 admin 账号能登录管理后台.'));
        }

        // 兼容代码中 socket.request.user 的引用
        socket.request.user = user;
        next();
      });
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