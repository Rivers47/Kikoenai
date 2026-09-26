/*
 * Transcribe a work's audio into subtitle sidecars. Orchestration only; the
 * HTTP client is asr.js. Same split as suggest-track-titles.js over
 * track-titles.js, and on Socket.IO for the same reason: a work runs for
 * minutes to hours.
 *
 * One track at a time -- the reference server transcribes serially anyway and
 * returns 503 past its queue depth.
 */

const fs = require('fs');
const path = require('path');

const db = require('./database/db');
const { config } = require('./config');
const { listWorkTracks, indexWorkFiles, overlayDir } = require('./filesystem/workFiles');
const { supportedMediaExtList } = require('./filesystem/utils');
const { findLyricTracks } = require('./routes/utils/lyrics');
const { WORK_ID_RE, normalizeWorkId } = require('./routes/utils/validate');
const { AsrError, isAsrConfigured, transcribe } = require('./asr');

// Wider than what the player renders, so a .txt from an earlier run still
// counts as done (see asr.js on text/plain).
const SIDECAR_EXT = ['.lrc', '.srt', '.vtt', '.txt'];

// A read-only mount gives EROFS; a folder owned by someone else EACCES, or
// EPERM on some platforms and network shares.
const UNWRITABLE = ['EROFS', 'EACCES', 'EPERM'];

/**
 * Write `body` to `filePath` via a temp file and a rename, so a crash cannot
 * leave a truncated sidecar that the next listing reads as a good lyric file.
 */
async function writeAtomic(filePath, body) {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const temp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.tmp`);
  try {
    await fs.promises.writeFile(temp, body, 'utf8');
    await fs.promises.rename(temp, filePath);
  } catch (err) {
    await fs.promises.unlink(temp).catch(() => {});
    throw err;
  }
}

const sidecarPath = (track, ext) => (
  [track.subtitle, `${track.title.replace(/\.[^.]+$/, '')}${ext}`].filter(Boolean).join('/')
);

/**
 * Next to the audio if the library takes it, in the overlay if not. Attempted
 * rather than probed: fs.access(W_OK) is a TOCTOU, and root passes it on a
 * directory it still cannot write.
 *
 * @returns {Promise<{relPath: String, overlay: Boolean}>}
 */
async function writeSidecar(workId, workDir, track, ext, body) {
  const relPath = sidecarPath(track, ext);

  try {
    await writeAtomic(path.join(workDir, relPath), body);
    return { relPath, overlay: false };
  } catch (err) {
    if (!UNWRITABLE.includes(err.code)) throw err;
  }

  // A copy in the unwritable work folder would shadow whatever lands in the
  // overlay (routes/utils/track.js), so the write would be a silent no-op.
  if (fs.existsSync(path.join(workDir, relPath))) {
    throw new AsrError(`"${relPath}" already exists in the work folder, which cannot be written to. Delete it there to replace it.`);
  }

  await writeAtomic(path.join(overlayDir(workId), relPath), body);
  return { relPath, overlay: true };
}

/**
 * @param {String} rawWorkId checked here -- a socket handler has no
 *   express-validator chain in front of it.
 * @param {Function} [onProgress] {relPath, status} per track; status is
 *   'running', 'written', 'skipped', 'empty' or 'failed'.
 * @param {AbortSignal} [signal] cancels between tracks and during one
 * @param {String[]} [only] relPaths to limit the run to, matched against the
 *   work's listing and never joined onto a path. Empty means all.
 * @param {String} [query] merged onto KIKO_ASR_QUERY for this run
 * @param {Boolean} [overwrite] transcribe tracks that already have a subtitle.
 *   Off by default so a re-run costs nothing for the tracks already done.
 * @param {Object} [dbApi] injected database, as in filesystem/workFiles.js
 * @returns {Promise<{written: Number, skipped: Number, failed: Number,
 *   empty: Number, overlay: Number, cancelled: Boolean}>}
 */
async function transcribeWork(rawWorkId, { onProgress = () => {}, signal, only, query, overwrite = false, dbApi = db } = {}) {
  if (!isAsrConfigured()) {
    throw new AsrError('No transcription server is configured (KIKO_ASR_BASE_URL).');
  }
  if (typeof rawWorkId !== 'string' || !WORK_ID_RE.test(rawWorkId)) {
    throw new AsrError(`"${rawWorkId}" is not a valid work id.`);
  }
  const workId = normalizeWorkId(rawWorkId);

  const work = await dbApi.knex('t_work')
    .select('root_folder', 'dir', 'files_indexed_at')
    .where('id', workId)
    .first();
  if (!work) {
    throw new AsrError(`No work with id "${workId}".`);
  }

  const rootFolder = config.rootFolders.find(rf => rf.name === work.root_folder);
  if (!rootFolder) {
    throw new AsrError(`Root folder "${work.root_folder}" not found. Check the library paths in settings.`);
  }

  const workDir = path.join(rootFolder.path, work.dir);
  const tracks = await listWorkTracks(workId, workDir, { indexedAt: work.files_indexed_at, dbApi });
  const allAudio = tracks.filter(track => supportedMediaExtList.includes(track.ext));
  if (!allAudio.length) {
    throw new AsrError(`Work ${workId} has no audio files.`);
  }

  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  const audio = wanted ? allAudio.filter(track => wanted.has(track.shortFilePath)) : allAudio;
  // Distinct from "no audio files": a stale dialog naming renamed files.
  if (!audio.length) {
    throw new AsrError(`None of the selected tracks exist in work ${workId} any more. Reopen the dialog to refresh the list.`);
  }

  const tally = { written: 0, skipped: 0, failed: 0, empty: 0, overlay: 0, cancelled: false };
  let wroteAnything = false;

  for (const track of audio) {
    if (signal && signal.aborted) {
      tally.cancelled = true;
      break;
    }

    // The listing already holds both the work folder and the overlay.
    if (!overwrite && findLyricTracks(track, tracks, SIDECAR_EXT).length) {
      tally.skipped += 1;
      onProgress({ relPath: track.shortFilePath, status: 'skipped' });
      continue;
    }

    onProgress({ relPath: track.shortFilePath, status: 'running' });

    try {
      const result = await transcribe(path.join(workDir, track.shortFilePath), { signal, query });

      if (!result) {
        tally.empty += 1;
        onProgress({ relPath: track.shortFilePath, status: 'empty' });
        continue;
      }

      const { overlay } = await writeSidecar(workId, workDir, track, result.ext, result.body);
      wroteAnything = true;
      tally.written += 1;
      if (overlay) tally.overlay += 1;
      onProgress({ relPath: track.shortFilePath, status: 'written', overlay });
    } catch (err) {
      // A cancel unwinds as an AbortError: the user stopping, not a failure.
      if (err.name === 'AbortError' || (signal && signal.aborted)) {
        tally.cancelled = true;
        break;
      }
      // An AsrError is for the admin; anything else is a bug worth a stack.
      if (!(err instanceof AsrError)) console.error(err);
      tally.failed += 1;
      onProgress({ relPath: track.shortFilePath, status: 'failed', error: err.message });
    }
  }

  // Once at the end, not per track: this is what makes the new files visible
  // to the listing. A cancelled run still indexes what it wrote.
  if (wroteAnything) {
    await indexWorkFiles(workId, workDir, undefined, dbApi);
  }

  return tally;
}

module.exports = { transcribeWork, writeSidecar, AsrError };
