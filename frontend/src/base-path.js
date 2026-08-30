/*
 * Where this app is being served from.
 *
 * The backend can be told (config.basePath) to serve everything -- WebApp,
 * /api and /socket.io -- under a prefix such as /kikoeru, so that it can share
 * a hostname with other self-hosted services instead of needing a subdomain.
 * One build has to work at any prefix, which takes two mechanisms:
 *
 *   - URLs baked in at build time (script/link tags, the service worker's
 *     precache manifest, the web app manifest) carry a placeholder that the
 *     backend swaps for the real prefix as it serves those files. See
 *     backend/base-path.js and quasar.config.js -> build.publicPath.
 *   - URLs the app builds at runtime -- API calls, the router base, the
 *     Socket.IO path, the service worker registration -- have no build-time
 *     text to rewrite, so they read the prefix from here.
 *
 * `window.__KIKO_BASE__` is injected into index.html by the backend. It is
 * absent under `quasar dev`, which always serves from the root, so the
 * fallback is the empty string -- and an empty prefix reproduces exactly the
 * URLs this app used before any of this existed.
 */

/** '' (served from the root) or '/prefix' -- never with a trailing slash. */
export const basePath = typeof window !== 'undefined' && typeof window.__KIKO_BASE__ === 'string'
  ? window.__KIKO_BASE__
  : ''

/**
 * Put the deploy prefix in front of a root-relative `/api/...` path.
 *
 * Idempotent: passing a path that already carries the prefix returns it
 * unchanged. That matters because most requests reach the server through the
 * axios interceptor in boot/axios.js, which calls this on every URL -- so a
 * call site that prefixes by hand (the ones building <img>/<audio> sources,
 * which never touch axios) cannot end up with /prefix/prefix/api/....
 *
 * @param {String} url A path beginning with '/api'.
 * @returns {String}
 */
export function apiUrl (url) {
  if (!basePath || typeof url !== 'string') return url
  // Keyed on '/api' rather than on the prefix alone so that a deployment whose
  // prefix is literally '/api' still gets /api/api/... rather than being
  // mistaken for an already-prefixed URL.
  if (!url.startsWith('/api') || url.startsWith(`${basePath}/api`)) return url
  return basePath + url
}
