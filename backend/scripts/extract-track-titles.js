/*
 * Fill in t_work_file.track_title for works whose audio files are named "01.mp3",
 * "#2.wav" and the like, by extracting the track list out of the scraped
 * DLsite description.
 *
 * The extraction itself lives in ../track-titles.js, shared with
 * POST /api/work/:id/track-titles/suggest. What is here is the CLI around it:
 * argument parsing, the loud precondition failures, and the write.
 *
 * This stays a script as well as a route because it writes straight to the
 * database with no review step, which is the right shape for a terminal and the
 * wrong one for a web request -- the dialog proposes, this applies.
 *
 * Configuration is env only, never config.json -- see ../track-titles.js:
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
 *   node scripts/extract-track-titles.js RJ01234567 --dry-run  # inspect, then confirm
 *   node scripts/extract-track-titles.js 01234567              # same work, bare id
 *   node scripts/extract-track-titles.js d215444 --force       # overwrite existing
 */

const path = require('path');
const readline = require('readline/promises');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');

const db = require('../database/db');
const { config } = require('../config');
const { formatID } = require('../filesystem/utils');
const { listWorkTracks } = require('../filesystem/workFiles');
const { isFanzaId, canonicalizeWorkId } = require('../work-id');
const {
  AUDIO_EXT,
  isLlmConfigured,
  isUninformative,
  htmlToText,
  structuredTitles,
  distinctTrackNames,
  buildHaystack,
  buildPrompt,
  callModel,
  validate,
} = require('../track-titles');

const argv = yargs(hideBin(process.argv))
  .usage('$0 <workId> [options]')
  .command('$0 <workId>', 'Extract track titles for one work', y => y.positional('workId', {
    type: 'string',
    description: "Work id: RJ01234567, 01234567, or Fanza d215444",
  }))
  .option('dry-run', { type: 'boolean', description: 'Print, then ask before writing' })
  .option('force', { type: 'boolean', description: 'Overwrite titles this work already has' })
  .demandCommand(0)
  .strict()
  .argv;

/**
 * Accept the id in whatever shape it was copied from -- a DLsite URL, the work
 * page, or the database.
 *
 * t_work.id stores DLsite ids RJ-padded but *without* the RJ prefix ('415278',
 * '01479926'); a Fanza id is stored underscore-free ('d215444'), so a cid
 * copied off DMM ('d_215444') is canonicalized here. formatID does the
 * 6/8-digit padding, so an unpadded paste resolves too.
 * @param {String} raw
 * @returns {String|null} id as stored in t_work, or null if unparseable
 */
const normalizeWorkId = (raw) => {
  const trimmed = String(raw).trim();
  if (isFanzaId(trimmed)) return canonicalizeWorkId(trimmed.toLowerCase());

  const digits = trimmed.replace(/^RJ/i, '');
  if (!/^\d{1,8}$/.test(digits)) return null;
  return formatID(parseInt(digits, 10));
};

// Without a terminal there is no one to answer, so a piped run stays a dry run.
async function confirm(question) {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(question)).trim());
  } finally {
    rl.close();
  }
}

async function run() {
  if (!isLlmConfigured()) {
    console.error('Set KIKO_LLM_BASE_URL and KIKO_LLM_MODEL (KIKO_LLM_API_KEY if your endpoint needs one).');
    process.exit(1);
  }

  const workId = normalizeWorkId(argv.workId);
  if (!workId) {
    throw new Error(`"${argv.workId}" is not a work id. Expected RJ01234567, 01234567 or d215444.`);
  }
  if (workId !== argv.workId) console.log(`(${argv.workId} -> ${workId})`);

  const work = await db.knex('t_work')
    .select('id', 'title', 'root_folder', 'dir', 'description', 'description_parts')
    .where('id', workId)
    .first();

  // Every failure below is loud and exits non-zero. The caller named this work
  // explicitly, so silently doing nothing would be the wrong answer.
  if (!work) throw new Error(`No work with id ${workId} in the database.`);

  // The column holds the seller's markup for anything scraped since the work
  // page started rendering it. Plain text -- an older row, or the JSON fallback
  // -- comes back out of htmlToText unchanged, so there is nothing to detect.
  const description = htmlToText(work.description);

  if (!description) {
    // Fanza is a dead end, not a "scrape it again" situation: scraper/fanza.js
    // extracts no description at all, so POST /api/refresh would change nothing.
    if (isFanzaId(workId)) {
      throw new Error(`Work ${workId} is a Fanza work, and the Fanza scraper does not extract descriptions — there is nothing to extract titles from. DLsite works only.`);
    }
    throw new Error(`Work ${workId} has no stored description. Scrape it first: POST /api/refresh/${workId}`);
  }

  const existing = (await db.getWorkFiles(work.id)).filter((row) => row.track_title).length;
  if (existing && !argv.force) {
    throw new Error(`Work ${workId} already has ${existing} track titles. Pass --force to overwrite.`);
  }

  const rootFolder = config.rootFolders.find(rf => rf.name === work.root_folder);
  if (!rootFolder) throw new Error(`Root folder "${work.root_folder}" is not configured.`);

  // From t_work_file, which already carries duration and any track titles.
  const tracks = await listWorkTracks(work.id, path.join(rootFolder.path, work.dir));
  const audio = tracks.filter(t => AUDIO_EXT.includes(t.ext));
  if (!audio.length) throw new Error(`Work ${workId} has no audio files on disk.`);

  // One entry per distinct file name, not per file: a NO_SE folder or a wav
  // copy repeats the same tracks under the same names, and counting the raw
  // files doubles every total below and stops the structured fast path from
  // ever lining up. The title chosen for a name fans back out to every file
  // carrying it, at the write step.
  const trackNames = distinctTrackNames(audio);

  console.log(`[${work.id}] ${work.title}`);
  const blank = trackNames.filter(isUninformative);
  const variants = audio.length === trackNames.length ? '' : ` across ${audio.length} files`;
  console.log(`  ${trackNames.length} tracks${variants}, ${blank.length} with uninformative names`);
  // Advisory, not a filter: the caller picked this work on purpose.
  if (!blank.length) {
    console.log('  note: every filename already carries a title — you may not need this');
  }

  const parts = work.description_parts ? JSON.parse(work.description_parts) : [];
  const structured = structuredTitles(parts);
  const haystack = buildHaystack(description, parts);

  let accepted;
  let rejected = [];

  if (structured.length && structured.length === trackNames.length) {
    // DLsite published the list itself and it lines up one-for-one with the
    // tracks on disk. Nothing to infer -- pair them in disk order.
    console.log(`  ${structured.length} structured titles match ${trackNames.length} tracks, no LLM needed`);
    accepted = Object.fromEntries(trackNames.map((name, i) => [name, structured[i]]));
  } else {
    if (structured.length) {
      console.log(`  ${structured.length} structured titles vs ${trackNames.length} tracks, asking the model to align`);
    }
    const parsed = await callModel(buildPrompt(description, structured), trackNames, { verbose: true });
    ({ accepted, rejected } = validate(parsed, haystack, trackNames));
  }

  for (const [file, title, why] of rejected) console.log(`  reject ${file}: ${title}  (${why})`);
  for (const [file, title] of Object.entries(accepted)) console.log(`  ok     ${file} -> ${title}`);

  if (!Object.keys(accepted).length) {
    console.log('  nothing accepted, leaving filenames as they are');
    return;
  }

  const count = Object.keys(accepted).length;
  if (argv.dryRun && !(await confirm(`  write ${count} titles? [y/N] `))) {
    console.log(`  dry run, not written (${count} titles)`);
    return;
  }

  // Keyed by relPath, which is what t_work_file rows key on. This is where one
  // title per name becomes one title per file, so every variant folder gets it.
  const byRelPath = {};
  for (const t of audio) {
    if (accepted[t.title]) byRelPath[t.shortFilePath] = accepted[t.title];
  }
  const written = await db.setTrackTitles(work.id, byRelPath);
  console.log(`  wrote ${written} titles`);
}

run()
  .then(() => db.knex.destroy())
  .catch(async (err) => {
    console.error(err.message);
    await db.knex.destroy();
    process.exit(1);
  });
