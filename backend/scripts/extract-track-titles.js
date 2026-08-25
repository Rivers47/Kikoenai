/*
 * Fill in memo.trackTitles for works whose audio files are named "01.mp3",
 * "#2.wav" and the like, by extracting the track list out of the scraped
 * DLsite description.
 *
 * Deliberately a standalone script, not a server feature: it needs an LLM
 * endpoint, which most deployments will not have, and it is only useful for the
 * small minority of works whose filenames carry no titles. Nothing in the
 * server imports it. The server side is just the storage contract --
 * memo.trackTitles = { relPath: title } -- which getTrackList reads and the
 * work tree renders as `trackTitle || title`.
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
 *
 * Handles exactly one work per run. Track-title extraction is a judgement call
 * you want to eyeball before it lands in the database, and the works that need
 * it are a handful of circles rather than a sweep of the library -- so this is
 * a per-work tool, not a batch job. Loop it from a shell if you really want to.
 *
 * Usage:
 *   node scripts/extract-track-titles.js RJ01234567 --dry-run  # inspect only
 *   node scripts/extract-track-titles.js 01234567              # same work, bare id
 *   node scripts/extract-track-titles.js d_215444 --force      # overwrite existing
 */

const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const db = require('../database/db');
const { config } = require('../config');
const { getTrackList, formatID } = require('../filesystem/utils');

const argv = yargs(hideBin(process.argv))
  .usage('$0 <workId> [options]')
  .command('$0 <workId>', 'Extract track titles for one work', y => y.positional('workId', {
    type: 'string',
    description: "Work id: RJ01234567, 01234567, or Fanza d_215444",
  }))
  .option('dry-run', { type: 'boolean', description: 'Print, do not write' })
  .option('force', { type: 'boolean', description: 'Overwrite titles this work already has' })
  .demandCommand(0)
  .strict()
  .argv;

const BASE_URL = process.env.KIKO_LLM_BASE_URL;
const API_KEY = process.env.KIKO_LLM_API_KEY;
const MODEL = process.env.KIKO_LLM_MODEL;
// Provider-specific knobs, merged into the request body. There is no portable
// way to switch reasoning off across OpenAI-compatible servers, so rather than
// guess, pass whatever yours wants:
//   vLLM / SGLang (Qwen3):  {"chat_template_kwargs":{"enable_thinking":false}}
//   Ollama:                 {"think":false}
//   OpenRouter:             {"reasoning":{"exclude":true}}
const EXTRA_BODY = process.env.KIKO_LLM_EXTRA_BODY ? JSON.parse(process.env.KIKO_LLM_EXTRA_BODY) : {};
// Generous on purpose. This is a per-work tool you run and watch, so the
// timeout exists to stop an endpoint stalling forever, not to enforce speed --
// a local model on CPU can take many minutes for one work, especially with
// reasoning still switched on.
const TIMEOUT_MS = parseInt(process.env.KIKO_LLM_TIMEOUT_MS, 10) || 600000;

const AUDIO_EXT = ['.mp3', '.wav', '.flac', '.m4a', '.ogg', '.opus'];

// A filename that already carries a title needs no help. Anything that is only
// digits, punctuation and a track-ish prefix does.
const UNINFORMATIVE = /^(?:track|trk|tr|no|#|＃)?[\s._\-–—]*[0-9０-９]{1,3}[\s._\-–—]*$/i;

/**
 * Accept the id in whatever shape it was copied from -- a DLsite URL, the work
 * page, or the database.
 *
 * t_work.id stores DLsite ids RJ-padded but *without* the RJ prefix ('415278',
 * '01479926'); Fanza ids keep their 'd_' prefix. formatID does the 6/8-digit
 * padding, so an unpadded paste resolves too.
 * @param {String} raw
 * @returns {String|null} id as stored in t_work, or null if unparseable
 */
const normalizeWorkId = (raw) => {
  const trimmed = String(raw).trim();
  if (/^d_\d+$/i.test(trimmed)) return trimmed.toLowerCase();

  const digits = trimmed.replace(/^RJ/i, '');
  if (!/^\d{1,8}$/.test(digits)) return null;
  return formatID(parseInt(digits, 10));
};

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
 * Text a title must appear in to count as "copied, not invented".
 *
 * Must include the structured track titles as well as the prose: the scraper
 * strips ul.work_tracklist out of `description` so the titles are not
 * duplicated there, so prose alone would reject every structured work.
 */
function buildHaystack(description, descriptionParts) {
  return [description || '', ...structuredTitles(descriptionParts)]
    .join('\n')
    .replace(/\s+/g, '');
}

const SYSTEM_PROMPT = `You extract track lists from Japanese DLsite work descriptions.

You are given a description and a list of audio filenames in disk order.
Return which description track title belongs to which filename.

Rules:
- Every "title" you output MUST be copied verbatim from the description. Never
  translate, summarise, reword or invent. Copy the exact characters.
- Copy the WHOLE line, including any leading track number or marker exactly as
  written ("Track1 ...", "01 ...", "\u2460 ...", "\u25c6 ..."). Do not strip it and do not
  renumber. The number is how a human spots a misaligned mapping.
- Do not include duration markers, "プレイ内容(...)" lines, campaign or credit
  text, or the total runtime line.
- The description may list a different number of tracks than there are files
  (bonus tracks, trial folders, duplicate mp3/wav copies). Only map a filename
  when you are confident. Leave it out otherwise.
- If the description contains no track list at all, return {"tracks": []}.

Respond with JSON only, no prose:
{"tracks": [{"file": "<exact filename from the list>", "title": "<verbatim from description>"}]}`;

/**
 * The text handed to the model: the prose description, plus any structured
 * track titles, which live outside `description` (see buildHaystack).
 */
function buildPrompt(description, structured) {
  if (!structured.length) return description || '';
  return `${description || ''}\n\n# Track list\n${structured.join('\n')}`;
}

async function callModel(description, fileNames) {
  const body = {
    model: MODEL,
    // Deterministic: this is verbatim span extraction, so there is nothing to
    // be creative about, and a rerun should give the same answer.
    temperature: 0,
    ...EXTRA_BODY,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: `# Description\n${description}\n\n# Files (disk order)\n${fileNames.map((f, i) => `${i + 1}. ${f}`).join('\n')}`,
      },
    ],
    response_format: { type: 'json_object' },
  };

  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

  const url = `${BASE_URL.replace(/\/$/, '')}/chat/completions`;

  // Everything on the wire, untruncated. This is a one-work debugging tool and
  // guessing at what the model saw is the slowest way to work out why an
  // extraction went wrong.
  console.log(`\n----- REQUEST -> POST ${url}`);
  console.log(JSON.stringify({
    // The key is the one thing not echoed verbatim: this output gets pasted
    // into issues and chat windows.
    ...headers, ...(API_KEY ? { Authorization: 'Bearer <redacted>' } : {}),
  }, null, 2));
  console.log(JSON.stringify(body, null, 2));

  // Without a timeout a stalled endpoint hangs the script indefinitely -- the
  // same failure the review scraper had.
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new Error(
        `LLM did not answer within ${Math.round(TIMEOUT_MS / 1000)}s. `
        + 'Raise KIKO_LLM_TIMEOUT_MS (milliseconds), switch off reasoning via '
        + 'KIKO_LLM_EXTRA_BODY, or use a smaller model.',
      );
    }
    throw err;
  }

  // Read the body once, as text, so the raw bytes can be shown whether or not
  // the response was ok and whether or not it happens to be JSON.
  const raw = await res.text();
  console.log(`\n----- RESPONSE <- ${res.status} ${res.statusText} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  for (const [k, v] of res.headers) console.log(`${k}: ${v}`);
  console.log(raw);
  console.log('----- END\n');

  if (!res.ok) throw new Error(`LLM ${res.status}: ${raw.slice(0, 200)}`);

  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('LLM response was not JSON (see RESPONSE above).');
  }
  const content = json.choices && json.choices[0] && json.choices[0].message.content;
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
    if (!haystack.includes(title.replace(/\s+/g, ''))) {
      rejected.push([row.file, title, 'not verbatim in description']);
      continue;
    }
    if (Object.values(accepted).includes(title)) {
      rejected.push([row.file, title, 'duplicate title']);
      continue;
    }
    accepted[row.file] = title;
  }

  return { accepted, rejected };
}

async function run() {
  if (!BASE_URL || !MODEL) {
    console.error('Set KIKO_LLM_BASE_URL and KIKO_LLM_MODEL (KIKO_LLM_API_KEY if your endpoint needs one).');
    process.exit(1);
  }

  const workId = normalizeWorkId(argv.workId);
  if (!workId) {
    throw new Error(`"${argv.workId}" is not a work id. Expected RJ01234567, 01234567 or d_215444.`);
  }
  if (workId !== argv.workId) console.log(`(${argv.workId} -> ${workId})`);

  const work = await db.knex('t_work')
    .select('id', 'title', 'root_folder', 'dir', 'memo', 'description', 'description_parts')
    .where('id', workId)
    .first();

  // Every failure below is loud and exits non-zero. The caller named this work
  // explicitly, so silently doing nothing would be the wrong answer.
  if (!work) throw new Error(`No work with id ${workId} in the database.`);
  if (!work.description) {
    // Fanza is a dead end, not a "scrape it again" situation: scraper/fanza.js
    // extracts no description at all, so POST /api/refresh would change nothing.
    if (workId.startsWith('d_')) {
      throw new Error(`Work ${workId} is a Fanza work, and the Fanza scraper does not extract descriptions — there is nothing to extract titles from. DLsite works only.`);
    }
    throw new Error(`Work ${workId} has no stored description. Scrape it first: POST /api/refresh/${workId}`);
  }

  const memo = work.memo ? JSON.parse(work.memo) : {};
  const existing = Object.keys(memo.trackTitles || {}).length;
  if (existing && !argv.force) {
    throw new Error(`Work ${workId} already has ${existing} track titles. Pass --force to overwrite.`);
  }

  const rootFolder = config.rootFolders.find(rf => rf.name === work.root_folder);
  if (!rootFolder) throw new Error(`Root folder "${work.root_folder}" is not configured.`);

  // Third arg is the memo: getTrackList reads duration/contentHash/trackTitles off it.
  const tracks = await getTrackList(work.id, path.join(rootFolder.path, work.dir), memo);
  const audio = tracks.filter(t => AUDIO_EXT.includes(t.ext));
  if (!audio.length) throw new Error(`Work ${workId} has no audio files on disk.`);

  console.log(`[${work.id}] ${work.title}`);
  const blank = audio.filter(t => isUninformative(t.title));
  console.log(`  ${audio.length} audio files, ${blank.length} with uninformative names`);
  // Advisory, not a filter: the caller picked this work on purpose.
  if (!blank.length) {
    console.log('  note: every filename already carries a title — you may not need this');
  }

  const parts = work.description_parts ? JSON.parse(work.description_parts) : [];
  const structured = structuredTitles(parts);
  const fileNames = audio.map(t => t.title);
  const haystack = buildHaystack(work.description, parts);

  let accepted;
  let rejected = [];

  if (structured.length && structured.length === audio.length) {
    // DLsite published the list itself and it lines up one-for-one with the
    // files on disk. Nothing to infer -- pair them in disk order.
    console.log(`  ${structured.length} structured titles match ${audio.length} files, no LLM needed`);
    accepted = Object.fromEntries(fileNames.map((f, i) => [f, structured[i]]));
  } else {
    if (structured.length) {
      console.log(`  ${structured.length} structured titles vs ${audio.length} files, asking the model to align`);
    }
    const parsed = await callModel(buildPrompt(work.description, structured), fileNames);
    ({ accepted, rejected } = validate(parsed, haystack, fileNames));
  }

  for (const [file, title, why] of rejected) console.log(`  reject ${file}: ${title}  (${why})`);
  for (const [file, title] of Object.entries(accepted)) console.log(`  ok     ${file} -> ${title}`);

  if (!Object.keys(accepted).length) {
    console.log('  nothing accepted, leaving filenames as they are');
    return;
  }

  if (argv.dryRun) {
    console.log(`  dry run, not written (${Object.keys(accepted).length} titles)`);
    return;
  }

  // Key by relPath, matching memo.duration and memo.contentHash.
  const byRelPath = {};
  for (const t of audio) {
    if (accepted[t.title]) byRelPath[t.shortFilePath] = accepted[t.title];
  }
  memo.trackTitles = { ...(memo.trackTitles || {}), ...byRelPath };
  await db.setWorkMemo(work.id, memo);
  console.log(`  wrote ${Object.keys(byRelPath).length} titles`);
}

run()
  .then(() => db.knex.destroy())
  .catch(async (err) => {
    console.error(err.message);
    await db.knex.destroy();
    process.exit(1);
  });
