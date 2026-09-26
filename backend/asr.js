/*
 * Client for an external transcription (ASR) server: POST <base>/transcribe,
 * audio in, subtitle out. The query string is opaque so a server's own knobs
 * stay reachable; the response Content-Type says what came back.
 *
 * Env only, like the LLM settings: GET /api/config/admin strips only
 * md5secret/jwtsecret, so defaultConfig is readable by every admin.
 *
 *   KIKO_ASR_BASE_URL    e.g. http://127.0.0.1:8000
 *   KIKO_ASR_QUERY       query string (default `format=vtt`)
 *   KIKO_ASR_API_KEY     optional bearer token
 *   KIKO_ASR_TIMEOUT_MS  per track, default 30 min
 */

const fs = require('fs');
const path = require('path');
const { request } = require('undici');

/** A failure to show the user, as opposed to a bug. */
class AsrError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AsrError';
  }
}

/**
 * Allowed response Content-Types, and the extension each is saved as. The
 * check is what stops a forgotten `format=` writing JSON into a .srt.
 *
 * text/plain lands as .txt, which lyrics.js does not play: the reference
 * server sends it for both `format=lrc` and `format=txt`, so the header
 * cannot say which arrived.
 */
const SUBTITLE_TYPES = {
  'application/x-subrip': '.srt',
  'text/vtt': '.vtt',
  'text/plain': '.txt',
};

const asrConfig = () => ({
  baseUrl: process.env.KIKO_ASR_BASE_URL,
  // Defaulted because the reference server answers JSON otherwise, which is
  // unusable here. WebVTT over SubRip: only its `<v Name>` voice span can name
  // a speaker, which the frontend splits into per-speaker lyric streams
  // (frontend/AGENTS.md §2.9).
  query: process.env.KIKO_ASR_QUERY === undefined ? 'format=vtt' : process.env.KIKO_ASR_QUERY,
  apiKey: process.env.KIKO_ASR_API_KEY,
  // Per track, not per work.
  timeoutMs: parseInt(process.env.KIKO_ASR_TIMEOUT_MS, 10) || 1800000,
});

const isAsrConfigured = () => Boolean(process.env.KIKO_ASR_BASE_URL);

/**
 * Fold a per-run query string onto the configured one, key by key, so adding
 * `hotwords` for one work keeps `format=vtt`. A key in the override wins.
 */
const mergeQuery = (configured, override) => {
  if (!override) return configured;

  const merged = new URLSearchParams(configured);
  const extra = new URLSearchParams(override);
  for (const key of new Set(extra.keys())) merged.delete(key);
  for (const [key, value] of extra) merged.append(key, value);
  return merged.toString();
};

/**
 * Transcribe one audio file.
 *
 * @param {String} filePath absolute path to the audio
 * @param {AbortSignal} [signal] caller's cancel, combined with the timeout
 * @param {String} [query] per-run query, merged onto KIKO_ASR_QUERY (mergeQuery)
 * @returns {Promise<{ext: String, body: String}|null>} null for a silent
 *   track; an empty sidecar would look done and block a retry.
 */
async function transcribe(filePath, { signal, query } = {}) {
  const { baseUrl, query: configured, apiKey, timeoutMs } = asrConfig();

  const url = new URL(`${baseUrl.replace(/\/$/, '')}/transcribe`);
  url.search = mergeQuery(configured, query);

  const { size } = await fs.promises.stat(filePath);

  const headers = {
    'content-type': 'application/octet-stream',
    // Mandatory, and the reason for undici's request() over fetch(): a stream
    // body goes out chunked otherwise, which the reference server rejects, and
    // fetch() drops Content-Length as a forbidden header.
    'content-length': String(size),
    // Only the extension is read on the far side, for the temp file's suffix.
    'x-filename': `x${path.extname(filePath).toLowerCase()}`,
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  // Two reasons to stop, one signal.
  const timeout = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const stream = fs.createReadStream(filePath);
  let res;
  try {
    res = await request(url.href, {
      method: 'POST',
      headers,
      body: stream,
      // Both undici timers off, leaving `abort` as the only ceiling. The 300s
      // headersTimeout default is fatal here: no headers arrive until the
      // whole file is transcribed. Same trap as llmAgent in track-titles.js.
      headersTimeout: 0,
      bodyTimeout: 0,
      signal: abort,
    });
  } catch (err) {
    stream.destroy();
    if (timeout.aborted) {
      throw new AsrError(
        `ASR server did not answer within ${Math.round(timeoutMs / 1000)}s. `
        + 'Raise KIKO_ASR_TIMEOUT_MS (milliseconds) or use a faster model.',
      );
    }
    if (err.name === 'AbortError') throw err;
    // undici puts the real reason on `cause`.
    const cause = err.cause;
    throw new AsrError(`ASR request failed: ${cause ? `${cause.code || cause.name}: ${cause.message}` : err.message}`);
  }

  const body = await res.body.text();

  if (res.statusCode !== 200) {
    throw new AsrError(`ASR ${res.statusCode}: ${body.slice(0, 200)}`);
  }

  const mediaType = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  const ext = SUBTITLE_TYPES[mediaType];
  if (!ext) {
    throw new AsrError(
      `ASR server returned ${mediaType || 'no content type'}, which is not a subtitle. `
      + 'Expected one of: ' + Object.keys(SUBTITLE_TYPES).join(', ')
      + '. If it answered with JSON, ask it for a subtitle instead — KIKO_ASR_QUERY=format=vtt.',
    );
  }

  return body.trim() ? { ext, body } : null;
}

module.exports = { AsrError, isAsrConfigured, asrConfig, transcribe, mergeQuery, SUBTITLE_TYPES };
