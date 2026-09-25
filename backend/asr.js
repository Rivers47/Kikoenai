/*
 * Client for an external transcription (ASR) server.
 *
 * The contract is deliberately tiny so the model behind it can be swapped --
 * transcription, translation, anything that turns audio into timed text. One
 * endpoint is required, `POST <base>/transcribe`: audio in, subtitle out. What
 * came back is identified by its Content-Type; the query string is opaque to
 * this app, which passes it through untouched so a server's own knobs
 * (hotwords, beam size, ...) stay available without this file knowing them.
 *
 * Configuration is env only, never config.json, for the same reason as the LLM
 * settings: routes/config.js strips only md5secret/jwtsecret from
 * GET /api/config/admin, so anything added to defaultConfig is readable by
 * every admin and lands in config backups.
 *
 *   KIKO_ASR_BASE_URL    e.g. http://127.0.0.1:8000
 *   KIKO_ASR_QUERY       raw query string, passed through as-is
 *                        (default `format=vtt`; set it empty to send none)
 *   KIKO_ASR_API_KEY     optional; sent as a bearer token
 *   KIKO_ASR_TIMEOUT_MS  per track, default 30 min
 */

const fs = require('fs');
const path = require('path');
const { request } = require('undici');

/**
 * A failure the caller is expected to show the user, as opposed to a bug.
 */
class AsrError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AsrError';
  }
}

/**
 * What the response Content-Type is allowed to be, and the extension each one
 * is saved as.
 *
 * Trusting the header rather than sniffing the body keeps this honest about
 * whose job it is: a server that returns something has to say what it is. The
 * check is still load-bearing -- without it a forgotten `format=` writes a
 * JSON document into a .srt, which fails much later and much less clearly.
 *
 * `.txt` is not a lyric extension (routes/utils/lyrics.js plays .lrc/.srt/.vtt
 * only), so a text/plain answer is saved but will not be picked up as lyrics.
 * That is the accurate reading of the header: the reference server sends
 * text/plain for both `format=lrc` and `format=txt`, so it cannot be told
 * which one this is. A server wanting its LRC recognised has to send a
 * distinct type.
 */
const SUBTITLE_TYPES = {
  'application/x-subrip': '.srt',
  'text/vtt': '.vtt',
  'text/plain': '.txt',
};

const asrConfig = () => ({
  baseUrl: process.env.KIKO_ASR_BASE_URL,
  // Defaulted rather than left empty: a server that defaults to JSON (the
  // reference one does) would otherwise fail on first run for everybody. An
  // unknown query parameter is ignored by anything else it might be pointed
  // at, so the default costs nothing. An explicit empty value sends none.
  //
  // WebVTT over SubRip because it is the only subtitle format here with
  // anywhere to name a speaker -- the `<v Name>` voice span, which the
  // frontend already splits into one lyric stream per speaker (see
  // frontend/AGENTS.md §2.9). Nothing emits those today, but a diarising or
  // translating model dropped in behind this endpoint could, and the default
  // should not be the format that throws that away. Both carry end times;
  // both are played identically otherwise.
  query: process.env.KIKO_ASR_QUERY === undefined ? 'format=vtt' : process.env.KIKO_ASR_QUERY,
  apiKey: process.env.KIKO_ASR_API_KEY,
  // Per track, not per work. A long track on CPU is genuinely slow, and the
  // work loop applies this to each one separately.
  timeoutMs: parseInt(process.env.KIKO_ASR_TIMEOUT_MS, 10) || 1800000,
});

const isAsrConfigured = () => Boolean(process.env.KIKO_ASR_BASE_URL);

/**
 * Fold a per-run query string onto the configured one, key by key.
 *
 * Merged rather than replaced because of what the field is actually for:
 * adding `hotwords` to one work. Replacing would drop `format=vtt` along with
 * it, the server would answer with its default JSON, and every track would
 * fail on the content-type check -- for a field the admin filled in correctly.
 * A key given in the override still wins outright, so `format` stays
 * changeable.
 *
 * URLSearchParams does the escaping, which is the other half of accepting this
 * from a human: non-ASCII becomes UTF-8 percent-escapes (so `hotwords=柚姫` is
 * typed literally), and `#` becomes %23 rather than truncating everything
 * after it into a fragment that never leaves the client. `&` and `=` stay
 * structural -- this is wire syntax, so a value needing a literal one escapes
 * it, exactly as in KIKO_ASR_QUERY. Assigning the result to `url.search` does
 * not re-encode it.
 *
 * Duplicate keys survive in the override (`a=1&a=2`), so a server taking a
 * repeated parameter is not quietly reduced to its last value.
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
 * @param {String} [query] per-run query, merged onto KIKO_ASR_QUERY key by key
 *   (see mergeQuery). Empty or absent leaves the configured value alone.
 * @returns {Promise<{ext: String, body: String}|null>} null when the server
 *   answered with nothing -- a silent track. Writing an empty sidecar would
 *   only make the track look done and block a later retry.
 */
async function transcribe(filePath, { signal, query } = {}) {
  const { baseUrl, query: configured, apiKey, timeoutMs } = asrConfig();

  const url = new URL(`${baseUrl.replace(/\/$/, '')}/transcribe`);
  url.search = mergeQuery(configured, query);

  const { size } = await fs.promises.stat(filePath);

  const headers = {
    'content-type': 'application/octet-stream',
    // Mandatory, and the reason this goes through undici's request() rather
    // than fetch(): a stream body is otherwise sent chunked, and the reference
    // server rejects an upload with no Content-Length outright. fetch() treats
    // Content-Length as a forbidden header and would drop it silently.
    'content-length': String(size),
    // Only the extension is read on the far side, to give the temp file a
    // suffix the decoder can recognise. Sending the real name would put
    // non-ASCII bytes in a header for no gain.
    'x-filename': `x${path.extname(filePath).toLowerCase()}`,
  };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;

  // Two reasons to stop, one signal. AbortSignal.any keeps the caller's cancel
  // responsive during a transcription that is still within its timeout.
  const timeout = AbortSignal.timeout(timeoutMs);
  const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;

  const stream = fs.createReadStream(filePath);
  let res;
  try {
    res = await request(url.href, {
      method: 'POST',
      headers,
      body: stream,
      // Both of undici's own timers off, leaving `abort` as the single
      // ceiling. The 300s headersTimeout default is fatal here: this endpoint
      // sends no headers at all until the whole file has been transcribed, so
      // any track taking longer than that to decode was killed while the
      // server was working perfectly. Same trap callModel hit from the other
      // direction; see the llmAgent comment in track-titles.js.
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
    // undici reports transport failures with the real reason on `cause` when
    // it has one; without it the message alone says nothing useful.
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
