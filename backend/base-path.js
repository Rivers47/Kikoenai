/*
 * Serving Kikoenai from somewhere other than the root of a hostname.
 *
 * `config.basePath` ("/kikoeru") moves the whole app -- WebApp, /api and
 * /socket.io -- under a prefix, so it can share a hostname with other services
 * instead of needing a subdomain of its own.
 *
 * The frontend is built once and deployed at any prefix. That works because the
 * build bakes PUBLIC_PATH_TOKEN into every URL it emits (quasar.config.js sets
 * `build.publicPath` to it) instead of a real path, and this server swaps the
 * token for the configured prefix in the three text assets that carry it --
 * index.html, sw.js and manifest.json. Everything the frontend builds at
 * runtime (API calls, router base, Socket.IO path) reads the prefix from
 * `window.__KIKO_BASE__`, which is injected into index.html by the same pass.
 *
 * Nothing here runs when basePath is empty: the token becomes "/" again, which
 * is exactly what a root-served build looked like before this existed.
 */

// Must stay in sync with frontend/quasar.config.js, which requires it from here.
const PUBLIC_PATH_TOKEN = '/__KIKO_BASE__/';

// A URL path, and nothing else. Anything outside this set is either a mistake
// (a full URL, a Windows path) or an attempt to break out of the string when
// the prefix is written into index.html as a JS literal.
const SAFE_SEGMENT = /^[A-Za-z0-9._~%-]+$/;

/**
 * Turn whatever is in config.json into a prefix this codebase can concatenate:
 * either the empty string (serve from the root) or "/one/or/more/segments"
 * with a leading slash and no trailing one.
 *
 * Invalid values are reported and treated as "serve from the root" rather than
 * throwing -- a typo in an optional setting should not stop the server from
 * booting.
 *
 * @param {String} value Raw config.basePath.
 * @returns {String} '' or '/prefix'.
 */
const normalizeBasePath = (value) => {
  if (typeof value !== 'string') return '';

  const raw = value.trim();
  if (!raw || raw === '/') return '';

  const reject = (reason) => {
    console.warn(`basePath ${reason}，已忽略: "${value}"`);
    console.warn(`basePath ${reason} -- ignoring "${value}" and serving from the root.`);
    return '';
  };

  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(raw)) {
    return reject('必须是路径而不是完整 URL / must be a path, not a full URL');
  }

  const segments = raw.split('/').filter(segment => segment !== '');
  if (!segments.every(segment => SAFE_SEGMENT.test(segment))) {
    return reject('只能包含 URL 路径字符 / may only contain URL path characters');
  }
  // '.' and '..' pass the character check but are not a location.
  if (segments.some(segment => segment === '.' || segment === '..')) {
    return reject('不能包含相对路径片段 / must not contain relative path segments');
  }

  // Nothing but slashes ("//") is the root spelled oddly, not a one-segment
  // prefix -- returning '/' here would make every concatenation double up.
  if (segments.length === 0) return '';

  return `/${segments.join('/')}`;
};

/**
 * Rewrite a built asset for the configured prefix.
 *
 * A plain string swap, not a regex over markup: the build emits the token in
 * every place that needs the prefix (script/link hrefs, the precache manifest
 * inside sw.js, the manifest's own URLs), so there is nothing to parse.
 *
 * @param {String} text Contents of a built asset.
 * @param {String} basePath Normalized prefix ('' or '/prefix').
 * @returns {String}
 */
const applyBasePath = (text, basePath) => text.split(PUBLIC_PATH_TOKEN).join(`${basePath}/`);

module.exports = { PUBLIC_PATH_TOKEN, normalizeBasePath, applyBasePath };
