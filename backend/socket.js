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
  // The outcome of the last run, kept after the child is gone. A scan can
  // easily outlive a socket -- a laptop sleeps, a phone backgrounds the tab,
  // a reverse proxy times the connection out -- and Socket.IO then reconnects
  // with a fresh socket that missed SCAN_FINISHED entirely. Without this the
  // page sits on 'running' forever, with a kill button for a process that
  // exited hours ago. ON_SCANNER_PAGE replays it instead.
  let lastScanEvent = null;

  const startScanner = (script, args = []) => {
    if (scanner) return; // one at a time; see backend/AGENTS.md §3

    lastScanEvent = null;
    scanner = child_process.fork(path.join(__dirname, script), args, { silent: false }); // 子进程

    scanner.on('exit', (code) => {
      scanner = null;
      if (code) {
        lastScanEvent = { event: 'SCAN_ERROR', payload: undefined };
        io.emit('SCAN_ERROR');
      } else if (!lastScanEvent) {
        // A clean exit whose SCAN_FINISHED never made it out (see LOG.finish in
        // scannerModules.js). The page still has to leave 'running'.
        lastScanEvent = { event: 'SCAN_FINISHED', payload: { message: '扫描进程已结束.' } };
        io.emit(lastScanEvent.event, lastScanEvent.payload);
      }
    });

    scanner.on('message', (m) => {
      if (m.event) {
        if (m.event === 'SCAN_FINISHED') lastScanEvent = { event: m.event, payload: m.payload };
        io.emit(m.event, m.payload);
      }
    });
  };

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

    // Sent on mount *and* on every reconnect, so this is the resync point.
    socket.on('ON_SCANNER_PAGE', () => {
      if (scanner) {
        // 防止用户在扫描过程中刷新页面
        scanner.send({
          emit: 'SCAN_INIT_STATE'
        });
      } else if (lastScanEvent) {
        socket.emit(lastScanEvent.event, lastScanEvent.payload);
      }
    });

    socket.on('PERFORM_SCAN', () => startScanner('./filesystem/scanner.js'));

    socket.on('PERFORM_UPDATE', () => startScanner('./filesystem/updater.js', ['--refreshAll']));

    socket.on('PERFORM_WORK_FILE_SCAN', () => startScanner('./filesystem/workFileScanner.js'));

    socket.on('KILL_SCAN_PROCESS', () => {
      // The button is drawn from client-side state, which can outlive the
      // process -- a stale page clicking it used to throw on null and take the
      // whole server down with an unhandled 'error' event.
      if (scanner) {
        scanner.send({ exit: 1 });
      } else {
        socket.emit('SCAN_FINISHED', { message: '扫描进程已结束.' });
      }
    });

    // 发生错误时触发
    socket.on('error', (err) => {
      console.error(err);
    });
  });
};

module.exports = initSocket;