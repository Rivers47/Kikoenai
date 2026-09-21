const path = require('path');
const socket = require('socket.io');
const cookie = require('cookie');
const child_process = require('child_process'); // 子进程
const { config } = require('./config');
const { SESSION_COOKIE, getSession } = require('./auth/session');
const { suggestTrackTitles, SuggestError } = require('./suggest-track-titles');

const initSocket = (server) => {
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

    // Propose a track list for one work from its scraped description.
    //
    // Over the socket rather than a route because a local model regularly runs
    // past what a reverse proxy will hold a request open for; see
    // suggest-track-titles.js. Unlike the scan events there is no global guard
    // and no forked child -- this is per-work, per-admin and in-process, so the
    // answer goes back to the asking socket with `socket.emit`. Using io.emit
    // here would drop one admin's suggestion into another's dialog.
    //
    // `workId` is echoed on both replies so a dialog can ignore an answer to a
    // request it no longer cares about.
    socket.on('SUGGEST_TRACK_TITLES', async (payload) => {
      const workId = payload && payload.workId;
      try {
        const result = await suggestTrackTitles(workId);
        socket.emit('SUGGEST_TRACK_TITLES_RESULT', { workId, ...result });
      } catch (err) {
        // A SuggestError is a precondition the admin can act on. Anything else
        // is the model endpoint failing or a real bug, so it gets logged.
        if (!(err instanceof SuggestError)) console.error(err);
        socket.emit('SUGGEST_TRACK_TITLES_ERROR', { workId, error: err.message });
      }
    });

    // 发生错误时触发
    socket.on('error', (err) => {
      console.error(err);
    });
  });
};

module.exports = initSocket;