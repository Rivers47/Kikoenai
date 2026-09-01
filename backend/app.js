#!/usr/bin/env node
require('dotenv').config();
const path = require('path');
const express = require('express');

const compression = require('compression');
const cookieParser = require('cookie-parser');
const history = require('connect-history-api-fallback');
const http = require('http');
const https = require('https');
const fs = require('fs');

// Crash the process on "unhandled promise rejection" when NODE_ENV=test or CRASH_ON_UNHANDLED exists
if (process.env.NODE_ENV === 'test' || process.env.CRASH_ON_UNHANDLED) {
  process.on('unhandledRejection', (reason, promise) => {
    console.error(new Date().toJSON(), 'Kikoeru log: Unhandled rejection at ', promise, `reason: ${reason}`);
    console.error('Crashing the process because of NODE_ENV or CRASH_ON_UNHANDLED settings');
    process.exit(1);
  });
}

const { initApp }= require('./database/init');
const initSocket = require('./socket');
const { config } = require('./config');
const api = require('./api');
const { applyBasePath } = require('./base-path');
const { sweepExpired } = require('./auth/session');
const app = express();

// Initialize database if not exists 
// Init or migrate database and config
// Note: non-blocking
initApp()
  .then(() => {
    // Sweep expired sessions periodically, and once at startup.
    // unref() so the timer never keeps the process alive (matters for tests).
    const sweep = () => sweepExpired().catch(err => console.error('清理过期会话失败:', err));
    sweep();
    setInterval(sweep, 60 * 60 * 1000).unref();
  })
  .catch(err => console.error(err));

if (config.behindProxy) {
  // Only useful if you are using a reverse proxy e.g. nginx
  // This is used to detect correct remote IP address which will be used in express-brute and some routes
  // You MUST set a X-Forwarded-For header in your reverse proxy to make it work
  // By default, behindProxy is false
  app.set('trust proxy', 'loopback');
}

if (config.enableGzip) {
  app.use(compression());
}

// parse application/x-www-form-urlencoded
app.use(express.urlencoded({ extended: true }));
// parse application/json
app.use(express.json());
// Parse cookies -- the session id lives in an HttpOnly cookie
app.use(cookieParser());

// Reject requests whose Host header we don't recognize (DNS-rebinding defense).
//
// A rebinding attack works by pointing an attacker-controlled domain at this
// server's address; the browser sees it as a same-origin request to that
// attacker domain (only the DNS answer changed, not the hostname string), so
// it will attach this server's session cookie just like a legitimate request
// would. The Host header on such a request is the attacker's own domain, which
// will never appear in config.allowedHosts, so checking it here blocks the
// request before any route or session logic runs.
//
// Loopback/private-LAN Host headers are always allowed regardless of config --
// reaching this server from inside its own network is the normal case, not an
// attack, and doesn't need explicit opt-in. Enforcement for everything else is
// opt-in via config.allowedHosts (empty by default) so an upgrade never locks
// out an existing public hostname nobody has listed yet.
const PRIVATE_HOSTNAME_RE = /^(localhost|127\.\d+\.\d+\.\d+|::1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|f[cd][0-9a-f]{2}:|fe80:)/i;
const isTrustedHost = (hostHeader) => {
  if (!hostHeader) return false;
  // Strip the port; IPv6 literals arrive as "[::1]:8888".
  const hostname = hostHeader.startsWith('[')
    ? hostHeader.slice(1, hostHeader.indexOf(']'))
    : hostHeader.split(':')[0];
  return PRIVATE_HOSTNAME_RE.test(hostname) || config.allowedHosts.includes(hostname);
};
app.use((req, res, next) => {
  if (config.allowedHosts.length === 0 || isTrustedHost(req.headers.host)) {
    return next();
  }
  res.status(421).send({ error: `Unrecognized Host header "${req.headers.host}". Add it to allowedHosts in the server config if this is expected.` });
});

// Browsers gate any request that crosses into a more-private IP address space
// (e.g. a public hostname resolving to a LAN IP, as with most self-hosted
// setups) behind a Local Network Access / Private Network Access preflight,
// even when the request is otherwise same-origin. Without an explicit allow,
// the request fails outright. This only answers that preflight; the app's own
// CORS/CSRF model stays same-origin-only -- the actual GET/POST responses below
// still carry no Access-Control-Allow-Origin header.
//
// Scope note, measured rather than assumed: Chromium sends this preflight, but
// Firefox (153) does not -- it resolves LNA with an internal permission check
// and reports `prompt action: auto_allow` without ever hitting the network.
// Access logs from a Firefox + Caddy deployment contain zero OPTIONS requests,
// so this middleware is Chromium-only in practice. Kept for those clients.
//
// This was originally added (87c32c6) to fix intermittent "Network Error" on the
// GETs fired right after page load, and it did not, because that bug is not a
// preflight failure: Firefox tears down and re-establishes its HTTP/2 connection
// while resolving the LNA permission, silently cancelling requests already
// dispatched on the discarded connection. No server response can prevent that --
// the mitigation lives in the frontend, as a retry in src/boot/axios.js.
//
// The Origin check below is load-bearing, not cosmetic: this preflight fires
// for ANY cross-origin request aimed at this host, not just requests from our
// own frontend -- our public hostname resolves to a private IP for every
// visitor, not just legitimate ones. Reflecting an arbitrary Origin here
// (as an earlier version of this middleware did) would let any third-party
// site pass this preflight and then fire a credentialed cross-site request
// (CSRF) using the victim's real session cookie. Only grant it when Origin
// is genuinely this same host, so a real cross-origin request still falls
// through to the default-deny behavior below (no CORS headers at all).
app.use((req, res, next) => {
  if (req.method === 'OPTIONS' && req.headers['access-control-request-private-network']) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    const isSameOrigin = origin && host && (origin === `https://${host}` || origin === `http://${host}`);
    if (isSameOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
      const requestedMethod = req.headers['access-control-request-method'];
      if (requestedMethod) res.setHeader('Access-Control-Allow-Methods', requestedMethod);
      const requestedHeaders = req.headers['access-control-request-headers'];
      if (requestedHeaders) res.setHeader('Access-Control-Allow-Headers', requestedHeaders);
    }
    return res.sendStatus(204);
  }
  next();
});

// Everything the browser addresses -- the WebApp, /api and the dev-only media
// directories -- hangs off one router so config.basePath can move the whole lot
// under a prefix in a single place. Socket.IO is mounted on the raw HTTP server
// rather than on Express, so it applies the prefix itself (see socket.js).
//
// The Host and Local-Network-Access middleware above stay on `app`: they are
// about the connection, not about where in the URL space the app lives.
const site = express.Router();

// For dev purpose only
if (process.env.NODE_ENV === 'development') {
  // eslint-disable-next-line n/no-unpublished-require
  site.use('/media/stream/VoiceWork', express.static('VoiceWork', { dotfiles: 'allow' /* Express 5: preserve v4 behavior */ }), require('serve-index')('VoiceWork', {'icons': true}));
  // eslint-disable-next-line n/no-unpublished-require
  site.use('/media/download/VoiceWork', express.static('VoiceWork', { dotfiles: 'allow' /* Express 5: preserve v4 behavior */ }), require('serve-index')('VoiceWork', {'icons': true}));
}

// connect-history-api-fallback 中间件后所有的 GET 请求都会变成 index (default: './index.html').
site.use(history({
  // 将所有带 api 的 GET 请求都代理到 parsedUrl.path, 其实就是原来的路径
  rewrites: [
    {
      from: /^\/api\/.*$/,
      to: context => context.parsedUrl.path
    }
  ]
}));
// Built assets whose *contents* name the URL prefix, and the content type to
// send them back as. Everything else in dist/ is prefix-agnostic and goes
// straight through express.static.
const DIST_DIR = path.join(__dirname, './dist');
const PREFIXED_ASSETS = {
  '/index.html': 'text/html; charset=utf-8',
  '/sw.js': 'text/javascript; charset=utf-8',
  '/manifest.json': 'application/manifest+json; charset=utf-8',
};

// The rewrite is the same on every request, so do it once. Skipped outside
// production so a rebuilt dist/ shows up without restarting the server.
const prefixedAssetCache = new Map();

/**
 * Tell the frontend where it is being served from.
 *
 * The asset URLs in index.html get their prefix from the token swap, but the
 * URLs the app builds at runtime -- API calls, the router base, the Socket.IO
 * path -- have no build-time representation to rewrite. They read this global
 * instead. It is absent under `quasar dev`, where the app is always at the
 * root, and src/base-path.js falls back to '' accordingly.
 */
const injectBaseGlobal = (html, basePath) => html.replace(
  /<head(\s[^>]*)?>/i,
  (headTag) => `${headTag}<script>window.__KIKO_BASE__=${JSON.stringify(basePath)}</script>`
);

const buildPrefixedAsset = (assetPath) => {
  const raw = fs.readFileSync(path.join(DIST_DIR, assetPath), 'utf-8');
  const rewritten = applyBasePath(raw, config.basePath);
  return assetPath === '/index.html' ? injectBaseGlobal(rewritten, config.basePath) : rewritten;
};

const servePrefixedAssets = (req, res, next) => {
  // `history` above has already rewritten WebApp routes to /index.html, so a
  // GET usually arrives here as the real file name. A bare '/' still has to be
  // handled: connect-history-api-fallback only rewrites GETs, and it declines
  // any request that does not accept HTML -- either of which would otherwise
  // fall through to express.static and be answered with the raw, still
  // tokenized dist/index.html as a directory index.
  const assetPath = req.path === '/' ? '/index.html' : req.path;
  const contentType = PREFIXED_ASSETS[assetPath];
  if (!contentType || (req.method !== 'GET' && req.method !== 'HEAD')) {
    return next();
  }

  try {
    let body = prefixedAssetCache.get(assetPath);
    if (body === undefined) {
      body = buildPrefixedAsset(assetPath);
      if (config.production) {
        prefixedAssetCache.set(assetPath, body);
      }
    }
    // express.static would have sent `public, max-age=0` here. Say it
    // explicitly, because res.send() sets no Cache-Control at all and a
    // response with only an ETag is free to be heuristically cached -- which
    // for the SPA shell means a stale app, and for sw.js means a stale service
    // worker that outlives the deploy that replaced it.
    res.setHeader('Cache-Control', 'no-cache');
    res.type(contentType).send(body);
  } catch (err) {
    // No frontend build in dist/ -- let express.static produce the 404 it
    // always did rather than turning a missing build into a 500.
    if (err.code === 'ENOENT') return next();
    next(err);
  }
};

// Expose API routes
api(site);

// Serve WebApp routes.
//
// Three built assets carry the deploy-time URL prefix in their contents rather
// than only in their name, so they are rewritten on the way out instead of
// being handed to express.static: index.html (script/link hrefs, plus the
// window.__KIKO_BASE__ the frontend reads), sw.js (the precache manifest) and
// manifest.json (start_url/scope). See base-path.js.
site.use(servePrefixedAssets);
// `index: false` so dist/index.html has exactly one way out of this server --
// the rewriting middleware above. Left on, express.static would answer a
// directory request with the raw file, deploy-path placeholder and all.
site.use(express.static(DIST_DIR, {
  index: false,
  dotfiles: 'allow' /* Express 5: preserve v4 behavior */
}));

app.use(config.basePath || '/', site);

// 返回错误响应
 
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') { 
    // 验证错误
    res.set("WWW-Authenticate", "Bearer realm=\"Authorization Required\"");
    res.status(401).send({ error: err.message });
  } else if (err.code === 'SQLITE_ERROR') {
    if (err.message.indexOf('no such table') !== -1) {
      res.status(500).send({ error: '数据库结构尚未建立，请先执行扫描.'});
    }
  } else {
    console.error(new Date().toJSON(), 'Kikoeru log:', err);
    if (process.env.NODE_ENV === 'production' || config.production) {
      // Do not send excess error messages to the client on production mode
      res.status(500).send({ error: '服务器错误' });
    } else {
      res.status(500).send({ error: err.message || err });
    }
  }
});

// Create HTTP and HTTPS server
const server = http.createServer(app);

// Keep idle keep-alive connections open longer than whoever is reusing them --
// Node's default of 5s is far too short and makes the peer race us to the close,
// which surfaces in the browser as "Network Error" (NS_ERROR_NET_RESET).
//
// The value has to sit ABOVE the idle timeout of the peer that owns the
// connection pool, so that side always closes first and never hands a request
// to a socket we just tore down. Two peers matter:
//   - a browser talking to us directly (Firefox idles at 115s, Chrome at 300s)
//   - a reverse proxy's upstream pool (Caddy's reverse_proxy defaults to 2m,
//     nginx keepalive to 60s)
// 300s was previously 120s, which exactly matched Caddy's 2m default -- both
// ends expiring the same idle socket at the same instant is the very race this
// is meant to remove. headersTimeout must stay greater than keepAliveTimeout.
server.keepAliveTimeout = 300000; // 300s
server.headersTimeout = 305000;   // 305s

let httpsServer = null;
let httpsSuccess = false;
if (config.httpsEnabled) {
  try {
    httpsServer = https.createServer({
      key: fs.readFileSync(config.httpsPrivateKey),
      cert: fs.readFileSync(config.httpsCert),
    },app);
    httpsServer.keepAliveTimeout = 300000;
    httpsServer.headersTimeout = 305000;
    httpsSuccess = true;
  } catch (err) {
    console.error('HTTPS服务器启动失败，请检查证书位置以及是否文件可读');
    console.error(err);
  }
}

// websocket 握手依赖 http 服务
initSocket(server);
if (config.httpsEnabled) {
  initSocket(httpsServer);
}

const listenPort = process.env.PORT || config.listenPort || 6789;
const localOnly = config.blockRemoteConnection;

// Note: for some unknown reasons, :: does not always work 
localOnly ? server.listen(listenPort, 'localhost') : server.listen(listenPort);
if (config.httpsEnabled && httpsSuccess) {
  localOnly ? httpsServer.listen(config.httpsPort, 'localhost') : httpsServer.listen(config.httpsPort);
}

server.on('listening', () => {
  console.log('Express server started on port %s at %s', server.address().port, server.address().address);
});

if (config.httpsEnabled && httpsSuccess) {
  httpsServer.on('listening', () => {
    console.log('Express server started on port %s at %s', httpsServer.address().port, httpsServer.address().address);
  });
}
