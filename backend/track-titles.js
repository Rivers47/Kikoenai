/*
 * Pulling a work's track list out of its scraped DLsite description.
 *
 * Shared by scripts/extract-track-titles.js (one work, from a terminal) and
 * the SUGGEST_TRACK_TITLES socket event (one work, from the editor dialog).
 * Neither owns the logic: the two differ only in how they are invoked and what
 * they do with the answer, so a fix here has to land on both.
 *
 * Configuration is env only, never config.json: routes/config.js strips just
 * md5secret/jwtsecret from GET /api/config/admin, so anything added to
 * defaultConfig is readable by admin and lands in config backups.
 *
 *   KIKO_LLM_BASE_URL   OpenAI-compatible base, e.g. http://localhost:11434/v1
 *                       or https://openrouter.ai/api/v1
 *   KIKO_LLM_API_KEY    optional for local servers
 *   KIKO_LLM_MODEL      e.g. qwen3:8b
 *
 * DLsite works only: scraper/fanza.js extracts no description, so a d_ work has
 * nothing to work from.
 */

const cheerio = require('cheerio');
const { fetch: undiciFetch, Agent } = require('undici');

/**
 * The HTTP client for the model call, with both of undici's own timeouts off.
 *
 * `undici` is required explicitly rather than using the global `fetch` for two
 * reasons. Its defaults are the problem: `headersTimeout` and `bodyTimeout`
 * are both 300s, and the second one applies to the gap *before the first
 * token* -- which is prompt evaluation. A large `num_ctx` on CPU can spend
 * longer than that encoding the prompt before emitting anything, so the
 * request died while the model was working fine. Streaming alone does not fix
 * that; it only moves the deadline from one 300s timer to the other.
 *
 * And the dispatcher has to come from the same copy of undici as the fetch
 * using it: the global `fetch` is Node's *bundled* undici, a different module
 * instance from this package, so pairing them relies on duck typing that has
 * broken across versions.
 *
 * Zero means "no timer" (`client-h1.js`: `if (delay)`), leaving
 * AbortSignal.timeout(KIKO_LLM_TIMEOUT_MS) as the single ceiling -- which is
 * what that variable has always claimed to be.
 */
const llmAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

const AUDIO_EXT = ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.opus'];

// A filename that already carries a title needs no help. Anything that is only
// digits, punctuation and a track-ish prefix does.
const UNINFORMATIVE = /^(?:track|trk|tr|no|#|＃)?[\s._\-–—]*[0-9０-９]{1,3}[\s._\-–—]*$/i;

// Provider-specific knobs, merged into the request body. There is no portable
// way to switch reasoning off across OpenAI-compatible servers, so rather than
// guess, pass whatever yours wants:
//   vLLM / SGLang (Qwen3):  {"chat_template_kwargs":{"enable_thinking":false}}
//   llama.cpp (--jinja):    {"chat_template_kwargs":{"enable_thinking":false}}
//   Ollama:                 {"think":false}
//   OpenRouter:             {"reasoning":{"exclude":true}}
// Context length is set on the server for every one of these except Ollama,
// which takes it per request as {"options":{"num_ctx":16384}}.
const llmConfig = () => ({
  baseUrl: process.env.KIKO_LLM_BASE_URL,
  apiKey: process.env.KIKO_LLM_API_KEY,
  model: process.env.KIKO_LLM_MODEL,
  extraBody: process.env.KIKO_LLM_EXTRA_BODY ? JSON.parse(process.env.KIKO_LLM_EXTRA_BODY) : {},
  // Generous on purpose: a local model on CPU can take many minutes for one
  // work, especially with reasoning still switched on. Behind the HTTP route
  // this is also what the browser waits on, so a reverse proxy with a shorter
  // read timeout will give up first.
  timeoutMs: parseInt(process.env.KIKO_LLM_TIMEOUT_MS, 10) || 600000,
});

const isLlmConfigured = () => Boolean(process.env.KIKO_LLM_BASE_URL && process.env.KIKO_LLM_MODEL);

const isUninformative = (fileName) => {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  return UNINFORMATIVE.test(stem);
};

/**
 * Flatten a title to one display line.
 *
 * Sellers wrap titles across lines in the prose, and asking for the whole line
 * brings the breaks along. The tree renders each track as a single-line label,
 * so a stored newline is only ever noise.
 *
 * Line breaks and tabs collapse to one space and runs of ASCII spaces collapse
 * to one; the ideographic space U+3000 is left alone, because in Japanese
 * titles it is deliberate typography rather than accidental whitespace.
 * @param {String} title
 * @returns {String}
 */
const cleanTitle = title => String(title)
  .replace(/[\r\n\t]+/g, ' ')
  .replace(/ {2,}/g, ' ')
  .trim();

/**
 * Plain text of scraped description markup, preserving the line structure the
 * markup implies.
 *
 * This is the only place the flattening happens. `t_work.description` holds the
 * seller's own markup (the work page renders it), but a model aligning titles to
 * filenames wants prose, and `.text()` alone drops <br> and runs block elements
 * together, turning a formatted blurb into one unreadable line.
 *
 * The <br> replacement is a sentinel, not a bare '\n': DLsite writes
 * "<br />\n", so a literal newline usually follows the tag in the source, and
 * turning the tag into a newline of its own would double every line break. The
 * sentinel swallows that following source newline, leaving "<br /><br />" as
 * the only way to get a blank line.
 *
 * The sentinel is U+E000 (private use), and it must not be U+0000: cheerio
 * parses an appended string as HTML, and the tokenizer drops NUL from
 * character data, so a NUL sentinel never reaches the tree at all. That was
 * the original bug here -- every block ran together exactly as this function
 * exists to prevent, and "<br />" without a trailing source newline lost the
 * break outright. A private-use codepoint survives the parse and cannot occur
 * in a seller's blurb; it is stripped from the input first regardless.
 * @param {String} html
 * @returns {String}
 */
function htmlToText(html) {
  if (!html) return '';
  const $ = cheerio.load(String(html).replace(/\ue000/g, ''), null, false);
  $('br').replaceWith('\ue000');
  $('p, div, li, tr, h1, h2, h3, h4, h5, h6').append('\ue000');
  return $.root().text()
    .replace(/\r/g, '')
    .replace(/[ \t]*\ue000[ \t]*\n?/g, '\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Track titles DLsite already published structurally, in a work_parts
 * type_tracklist block. About one work in six has these, and for those no model
 * is needed at all.
 */
function structuredTitles(descriptionParts) {
  const out = [];
  for (const part of descriptionParts || []) {
    for (const track of (part.tracks || [])) {
      if (track && track.title && track.title.trim()) out.push(cleanTitle(track.title));
    }
  }
  return out;
}

/**
 * The work's track list as the model should see it: one entry per distinct
 * filename, in disk order.
 *
 * A work usually ships the same tracks more than once -- a NO_SE folder, a wav
 * copy beside the mp3s -- under identical names. Those are one track, so they
 * are one entry here, and the title chosen for it fans back out to every file
 * carrying that name. Counting raw files instead doubles every total and stops
 * the structured fast-path from ever lining up, which is what this function
 * exists to prevent.
 *
 * The residual risk is two genuinely different tracks sharing a basename
 * (`ドラマ/01.mp3` vs `おまけ/01.mp3`); they collapse to one entry and take the
 * same title. Run with --dry-run on an unfamiliar layout.
 * @param {Array} audio tracks, already filtered to AUDIO_EXT
 * @returns {Array<String>} distinct file names, disk order preserved
 */
const distinctTrackNames = (audio) => [...new Set(audio.map(t => t.title))];

/**
 * Text a title must appear in to count as "copied, not invented".
 *
 * Includes the structured track titles as well as the prose, so a work whose
 * list DLsite published structurally is not rejected wholesale.
 */
function buildHaystack(description, descriptionParts) {
  return [description || '', ...structuredTitles(descriptionParts)]
    .join('\n')
    .replace(/\s+/g, '');
}

// The rules both callers share. Only the output shape differs, so the wording
// that actually governs quality lives in one place.
const SHARED_RULES = `Rules:
- Every title you output MUST be copied verbatim from the description. Never
  translate, summarise, reword or invent. Copy the exact characters.
- Copy the WHOLE line, including any leading track number or marker exactly as
  written ("Track1 ...", "01 ...", "\u2460 ...", "\u25c6 ..."). Do not strip it and do not
  renumber. The number is how a human spots a misaligned list.
- Do not include duration markers, "\u30d7\u30ec\u30a4\u5185\u5bb9(...)" lines, campaign or credit
  text, or the total runtime line.`;

/**
 * Two prompts, because the two callers want different things back.
 *
 * The CLI validates a per-file mapping, so it has to ask for one. The dialog
 * places titles positionally and `collectTitles` throws the mapping away
 * unread -- so asking for it there makes the model spend output tokens
 * re-emitting every filename for nothing. Measured at ~44% of everything it
 * generates, on a phase that is ~70% of the run.
 */
const SYSTEM_PROMPT_MAPPING = `You extract track lists from Japanese DLsite work descriptions.

You are given a description and a list of audio filenames in disk order.
Return which description track title belongs to which filename.

${SHARED_RULES}
- The description may list a different number of tracks than there are files
  (bonus tracks, trial folders, duplicate mp3/wav copies). Only map a filename
  when you are confident. Leave it out otherwise.
- If the description contains no track list at all, return {"tracks": []}.

Respond with JSON only, no prose:
{"tracks": [{"file": "<exact filename from the list>", "title": "<verbatim from description>"}]}`;

const SYSTEM_PROMPT_LIST = `You extract track lists from Japanese DLsite work descriptions.

You are given a description and a list of audio filenames in disk order.
Return the track titles the description lists, in the order it lists them.

${SHARED_RULES}
- Return one entry per track, in description order. Do NOT skip a track in the
  middle: the list is matched to the files by position, so a gap shifts every
  later title onto the wrong file.
- The filenames are context for how many tracks to expect. Do not echo them.
- If the description contains no track list at all, return {"titles": []}.

Respond with JSON only, no prose:
{"titles": ["<verbatim from description>"]}`;
/**
 * The text handed to the model: the prose description, plus any structured
 * track titles, which live outside `description` (see buildHaystack).
 */
function buildPrompt(description, structured) {
  if (!structured.length) return description || '';
  return `${description || ''}\n\n# Track list\n${structured.join('\n')}`;
}

/**
 * Assemble one answer out of an OpenAI-compatible SSE stream.
 *
 * The wire format is `data: {json}` lines separated by blank lines, ending
 * with `data: [DONE]`; each frame carries a `choices[0].delta.content`
 * fragment to concatenate. Frames that are keepalives, comments or unparseable
 * are skipped rather than fatal -- a stream is not worth failing over one bad
 * frame when the rest assembles.
 *
 * **A server that ignored `stream` is still handled.** Not every
 * OpenAI-compatible endpoint implements it, and one that replies with an
 * ordinary single JSON object would otherwise yield an empty string and look
 * like a refusal. So the raw text is kept, and if no frame produced anything
 * it is parsed as a non-streaming response instead.
 *
 * @returns {Promise<{content: String, firstTokenMs: Number|null}>}
 *   `firstTokenMs` is prompt-evaluation time -- null if nothing ever arrived.
 */
async function readModelStream(res) {
  const decoder = new TextDecoder();
  const started = Date.now();
  let firstTokenMs = null;
  let buffer = '';
  let raw = '';
  let content = '';

  for await (const chunk of res.body) {
    const text = decoder.decode(chunk, { stream: true });
    raw += text;
    buffer += text;

    let cut;
    while ((cut = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, cut).trim();
      buffer = buffer.slice(cut + 1);

      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;

      let frame;
      try {
        frame = JSON.parse(payload);
      } catch {
        continue;
      }

      const delta = frame.choices && frame.choices[0] && frame.choices[0].delta;
      if (delta && typeof delta.content === 'string' && delta.content) {
        if (firstTokenMs === null) firstTokenMs = Date.now() - started;
        content += delta.content;
      }
    }
  }

  if (!content) {
    try {
      const json = JSON.parse(raw);
      const message = json.choices && json.choices[0] && json.choices[0].message;
      if (message && typeof message.content === 'string') {
        return { content: message.content, firstTokenMs };
      }
    } catch {
      // Genuinely a stream that produced nothing; fall through.
    }
  }

  return { content, firstTokenMs };
}

/**
 * @param {Object} options `verbose` dumps the whole exchange to stdout -- the
 *   CLI wants that, a server route does not.
 */
async function callModel(description, fileNames, { verbose = false, mapping = true } = {}) {
  const { baseUrl, apiKey, model, extraBody, timeoutMs } = llmConfig();

  const body = {
    model,
    // Deterministic: this is verbatim span extraction, so there is nothing to
    // be creative about, and a rerun should give the same answer.
    temperature: 0,
    ...extraBody,
    messages: [
      { role: 'system', content: mapping ? SYSTEM_PROMPT_MAPPING : SYSTEM_PROMPT_LIST },
      {
        role: 'user',
        content: `# Description\n${description}\n\n# Files (disk order)\n${fileNames.map((f, i) => `${i + 1}. ${f}`).join('\n')}`,
      },
    ],
    response_format: { type: 'json_object' },
    // Streaming is not about showing progress here -- the whole answer is
    // still assembled before anything uses it. It is what keeps Node from
    // killing the request: undici gives up when response headers take longer
    // than 300s (its headersTimeout default, below our own ceiling), and a
    // non-streaming endpoint sends no headers until generation is completely
    // finished. A slow local model therefore blew up at five minutes while
    // still running, whatever KIKO_LLM_TIMEOUT_MS said. Streaming sends
    // headers immediately, and each token resets the body timer after that,
    // so AbortSignal.timeout becomes the only real limit -- which is what the
    // variable promises. A server that ignores `stream` is still handled; see
    // readModelStream.
    stream: true,
  };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  // Everything on the wire, untruncated. This is a one-work debugging tool and
  // guessing at what the model saw is the slowest way to work out why an
  // extraction went wrong.
  if (verbose) {
    console.log(`\n----- REQUEST -> POST ${url}`);
    console.log(JSON.stringify({
      // The key is the one thing not echoed verbatim: this output gets pasted
      // into issues and chat windows.
      ...headers, ...(apiKey ? { Authorization: 'Bearer <redacted>' } : {}),
    }, null, 2));
    // Messages are printed as text, not JSON: stringify escapes every newline,
    // and the line structure is the part of the prompt worth reading. The rest
    // of the body is scalars, so it stringifies fine.
    const { messages, ...knobs } = body;
    console.log(JSON.stringify(knobs, null, 2));
    for (const m of messages) console.log(`--- ${m.role}\n${m.content}`);
  }

  // Without a timeout a stalled endpoint hangs indefinitely -- the same failure
  // the review scraper had.
  const started = Date.now();
  let res;
  try {
    res = await undiciFetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher: llmAgent,
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(
        `LLM did not answer within ${Math.round(timeoutMs / 1000)}s. `
        + 'Raise KIKO_LLM_TIMEOUT_MS (milliseconds), switch off reasoning via '
        + 'KIKO_LLM_EXTRA_BODY, or use a smaller model.',
      );
    }

    // `fetch` reports every transport failure as the same opaque
    // "TypeError: fetch failed"; the real reason is only ever on `cause`, so
    // rethrowing as-is leaves nothing to diagnose from.
    const cause = err.cause;

    // Should be unreachable now that llmAgent disables both of undici's
    // timers, but a stale dispatcher or a future default would bring it back,
    // and "fetch failed" alone took a long time to diagnose once already.
    if (cause && (cause.code === 'UND_ERR_HEADERS_TIMEOUT' || cause.code === 'UND_ERR_BODY_TIMEOUT')) {
      throw new Error(
        `LLM hit undici's own ${cause.code === 'UND_ERR_BODY_TIMEOUT' ? 'body' : 'headers'} timeout, `
        + 'which llmAgent is supposed to have disabled. KIKO_LLM_TIMEOUT_MS is not the '
        + 'limit being hit here — see the llmAgent comment in track-titles.js.',
      );
    }

    if (cause) {
      throw new Error(`LLM request failed: ${cause.code || cause.name}: ${cause.message}`);
    }
    throw err;
  }

  // Headers arrive before generation now, so a failure is readable at once
  // rather than after the model has finished. An error response is ordinary
  // JSON, never a stream.
  if (!res.ok) {
    const raw = await res.text();
    if (verbose) {
      console.log(`\n----- RESPONSE <- ${res.status} ${res.statusText}`);
      for (const [k, v] of res.headers) console.log(`${k}: ${v}`);
      console.log(raw);
      console.log('----- END\n');
    }
    throw new Error(`LLM ${res.status}: ${raw.slice(0, 200)}`);
  }

  if (verbose) {
    console.log(`\n----- RESPONSE <- ${res.status} ${res.statusText} (headers in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
    for (const [k, v] of res.headers) console.log(`${k}: ${v}`);
  }

  const { content, firstTokenMs } = await readModelStream(res);

  if (verbose) {
    // Time to first token is prompt-evaluation time, which is the number to
    // watch when sizing num_ctx: it grows with the prompt, while the rest is
    // generation.
    const ttft = firstTokenMs === null ? 'never' : `${(firstTokenMs / 1000).toFixed(1)}s`;
    console.log(`(first token after ${ttft}, complete in ${((Date.now() - started) / 1000).toFixed(1)}s)`);
    console.log(content);
    console.log('----- END\n');
  }

  if (!content) throw new Error('LLM returned no content');

  // Reasoning models emit their chain of thought inline in the content, and
  // response_format does not suppress it -- Qwen3 under Ollama defaults to
  // thinking on, so JSON.parse would fail on the leading <think> block. Strip
  // it, drop any code fence, then take the outermost {...} so trailing prose
  // cannot break the parse either.
  let cleaned = content.replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '').trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`LLM returned no JSON object: ${cleaned.slice(0, 200)}`);
  }
  return JSON.parse(cleaned.slice(start, end + 1));
}

/**
 * Drop anything the model did not copy out of the description.
 *
 * This is the guard that makes the whole thing safe to run unattended: the
 * dominant failure is a model paraphrasing Japanese rather than copying it, and
 * a paraphrased title is indistinguishable from a real one once it is in the
 * database. Comparing against the description catches it for free.
 *
 * It is also what makes a provider refusal harmless. A remote model that
 * declines the content returns prose, none of which appears in the
 * description, so everything is rejected and the caller gets nothing rather
 * than something invented.
 */
// A leading track marker, in the shapes sellers actually use. Stripped before
// the verbatim check because renumbering is the one thing models reliably get
// wrong: a local model reads "\u2460\u3000\u306f\u3058\u307e\u308a" and writes "1. \u306f\u3058\u307e\u308a", which is
// still a copy of the title, just not of the numbering.
const TRACK_MARKER = /^(?:track|trk|tr|no\.?|#|\uff03)?[\s.\u3001\uff0e:\uff1a_\-\u2013\u2014]*(?:[0-9\uff10-\uff19]{1,3}|[\u2460-\u2473\u2776-\u277f\u25c6\u25c7\u25a0\u25a1\u25cf\u25cb\u2605\u2606\u30fb])[\s.\u3001\uff0e:\uff1a_\-\u2013\u2014]*/i;

const squash = (text) => text.replace(/\s+/g, '');

/**
 * Did the model copy this out of the description, rather than invent it?
 *
 * Whitespace-insensitive, because titles wrap across lines in the prose. Also
 * marker-insensitive on a second pass: a title whose *body* is verbatim but
 * whose numbering was reformatted is still a copy, and rejecting it threw away
 * good answers from exactly the local models this feature is for. A stripped
 * title has to keep some substance, or a bare "01." would match anything.
 */
function isVerbatim(title, haystack) {
  if (haystack.includes(squash(title))) return true;
  const body = title.replace(TRACK_MARKER, '').trim();
  return squash(body).length >= 2 && haystack.includes(squash(body));
}

/**
 * Drop anything the model did not copy out of the description.
 *
 * Strict, and used by the CLI, which writes to the database with no review
 * step: the dominant failure is a model paraphrasing Japanese rather than
 * copying it, and a paraphrased title is indistinguishable from a real one
 * once it is stored.
 *
 * The UI path does not use this -- see collectTitles.
 */
function validate(parsed, haystack, fileNames) {
  const bySet = new Set(fileNames);
  const accepted = {};
  const rejected = [];

  for (const row of (parsed.tracks || [])) {
    if (!row || typeof row.file !== 'string' || typeof row.title !== 'string') continue;
    const title = cleanTitle(row.title);
    if (!title) continue;
    if (!bySet.has(row.file)) {
      rejected.push([row.file, title, 'no such file']);
      continue;
    }
    if (!isVerbatim(title, haystack)) {
      rejected.push([row.file, title, 'not verbatim in description']);
      continue;
    }
    accepted[row.file] = title;
  }

  return { accepted, rejected };
}

/**
 * The model's titles, in order, for the editor dialog.
 *
 * Deliberately lenient where validate() is strict, because the two have
 * different safety models: this one's output is a *proposal* that lands in a
 * textarea, next to the filenames, in front of an admin who has to press Save.
 * The human is the check, so a title that was reworded rather than copied is
 * worth showing -- dropping it leaves a gap, and a gap silently shifts every
 * later title onto the wrong file when the list is applied positionally.
 *
 * The model is not even asked for a file mapping (SYSTEM_PROMPT_LIST): it
 * would be thrown away unread here, and re-emitting every filename costs a
 * large share of the output tokens. Order is what matters, since the dialog
 * fills a folder from the top down.
 *
 * `unverified` counts titles not found in the description, so the caller can
 * say how much of this to distrust. A provider refusal lands here rather than
 * being silently swallowed, and shows up as unverified.
 *
 * @returns {{titles: String[], unverified: Number}}
 */
function collectTitles(parsed, haystack) {
  // SYSTEM_PROMPT_LIST asks for a bare array. A model that answers in the
  // mapping shape anyway is still readable, which matters because small local
  // models drift toward whatever schema they saw most.
  const raw = Array.isArray(parsed.titles)
    ? parsed.titles
    : (parsed.tracks || []).map(row => row && row.title);

  const titles = [];
  let unverified = 0;

  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const title = cleanTitle(entry);
    if (!title) continue;
    if (!isVerbatim(title, haystack)) unverified += 1;
    titles.push(title);
  }

  return { titles, unverified };
}

module.exports = {
  AUDIO_EXT,
  readModelStream,
  llmConfig,
  isLlmConfigured,
  isUninformative,
  cleanTitle,
  htmlToText,
  structuredTitles,
  distinctTrackNames,
  buildHaystack,
  buildPrompt,
  callModel,
  validate,
  collectTitles,
  isVerbatim,
};
