/*
 * Transcribe a work's audio into subtitle sidecars.
 *
 * Orchestration only: it pulls the work and its files together, hands each
 * track to the HTTP client in asr.js, and decides where the answer is written.
 * Same split as suggest-track-titles.js over track-titles.js, and the same
 * reason for living on Socket.IO rather than a route -- transcribing one work
 * runs for minutes to hours, far past what any reverse proxy will hold a
 * request open for.
 *
 * Tracks are done one at a time. The reference server transcribes serially
 * anyway (one CTranslate2 session, process-global) and returns 503 past its
 * queue depth, so firing a whole work at once would buy nothing and lose the
 * tracks that bounced. Sequential also makes progress and cancellation mean
 * something.
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

// What counts as "this track already has a sidecar, leave it alone". Wider
// than what the player renders, so a .txt written by an earlier run is not
// transcribed a second time; see asr.js on why text/plain lands as .txt.
const SIDECAR_EXT = ['.lrc', '.srt', '.vtt', '.txt'];

// Errors that mean "this filesystem will not take a write", as opposed to a
// bug. A read-only bind mount gives EROFS; a folder owned by someone else
// gives EACCES, or EPERM on some platforms and network shares.
const UNWRITABLE = ['EROFS', 'EACCES', 'EPERM'];

/**
 * Write `body` to `filePath`, creating its folder.
 *
 * Via a temp file in the same directory, then rename: a crash or a cancel
 * halfway through a write would otherwise leave a truncated sidecar, which the
 * next listing picks up as a perfectly good lyric file and the skip check then
 * treats as done.
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

/**
 * Put a subtitle next to its audio if the library will take it, and in the
 * overlay if it will not.
 *
 * Attempted rather than probed: fs.access(W_OK) is a TOCTOU, and it lies in
 * the ordinary container case, where root passes the permission check on a
 * directory it still cannot write. Trying the write *is* the test.
 *
 * @returns {Promise<{relPath: String, overlay: Boolean}>}
 */
async function writeSidecar(workId, workDir, track, ext, body) {
  const stem = track.title.replace(/\.[^.]+$/, '');
  const relPath = [track.subtitle, `${stem}${ext}`].filter(Boolean).join('/');

  try {
    await writeAtomic(path.join(workDir, relPath), body);
    return { relPath, overlay: false };
  } catch (err) {
    if (!UNWRITABLE.includes(err.code)) throw err;
  }

  await writeAtomic(path.join(overlayDir(workId), relPath), body);
  return { relPath, overlay: true };
}

/**
 * @param {String} rawWorkId straight from the client -- a socket handler has no
 *   express-validator chain in front of it, so it is checked here.
 * @param {Function} [onProgress] called with {relPath, status, ...} as each
 *   track starts and finishes. Statuses: 'running', 'written', 'skipped',
 *   'empty', 'failed'.
 * @param {AbortSignal} [signal] cancels between tracks and during one.
 * @param {String[]} [only] relPaths to limit the run to. Matched against the
 *   work's own file listing, never joined onto a path, so an unknown entry
 *   simply selects nothing. Omitted or empty means every audio track.
 * @returns {Promise<{written: Number, skipped: Number, failed: Number,
 *   empty: Number, overlay: Number, cancelled: Boolean}>}
 */
async function transcribeWork(rawWorkId, { onProgress = () => {}, signal, only, query, dbApi = db } = {}) {
  if (!isAsrConfigured()) {
    throw new AsrError('服务器未配置转录服务 (KIKO_ASR_BASE_URL).');
  }
  if (typeof rawWorkId !== 'string' || !WORK_ID_RE.test(rawWorkId)) {
    throw new AsrError(`"${rawWorkId}" 不是有效的作品 id.`);
  }
  const workId = normalizeWorkId(rawWorkId);

  const work = await dbApi.knex('t_work')
    .select('root_folder', 'dir', 'files_indexed_at')
    .where('id', workId)
    .first();
  if (!work) {
    throw new AsrError(`没有 id 为 "${workId}" 的作品`);
  }

  const rootFolder = config.rootFolders.find(rf => rf.name === work.root_folder);
  if (!rootFolder) {
    throw new AsrError(`找不到文件夹: "${work.root_folder}"`);
  }

  const workDir = path.join(rootFolder.path, work.dir);
  const tracks = await listWorkTracks(workId, workDir, { indexedAt: work.files_indexed_at, dbApi });
  const allAudio = tracks.filter(track => supportedMediaExtList.includes(track.ext));
  if (!allAudio.length) {
    throw new AsrError(`作品 ${workId} 没有音频文件.`);
  }

  const wanted = Array.isArray(only) && only.length ? new Set(only) : null;
  const audio = wanted ? allAudio.filter(track => wanted.has(track.shortFilePath)) : allAudio;
  // Distinct from "no audio files": the work has some, the selection matched
  // none of them -- a stale dialog listing files a rescan has since renamed.
  if (!audio.length) {
    throw new AsrError(`选中的音轨在作品 ${workId} 中不存在，请重新打开对话框.`);
  }

  const tally = { written: 0, skipped: 0, failed: 0, empty: 0, overlay: 0, cancelled: false };
  let wroteAnything = false;

  for (const track of audio) {
    if (signal && signal.aborted) {
      tally.cancelled = true;
      break;
    }

    // Against the listing read at the top, which already holds both the work
    // folder and the overlay. Nothing written by this loop can collide with a
    // later track: one audio file, one stem.
    if (findLyricTracks(track, tracks, SIDECAR_EXT).length) {
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
      // A cancel unwinds as an AbortError out of the in-flight request; it is
      // the user stopping, not a track that failed.
      if (err.name === 'AbortError' || (signal && signal.aborted)) {
        tally.cancelled = true;
        break;
      }
      // An AsrError is the server or the configuration talking, and its
      // message is meant for the admin. Anything else is a bug worth a stack.
      if (!(err instanceof AsrError)) console.error(err);
      tally.failed += 1;
      onProgress({ relPath: track.shortFilePath, status: 'failed', error: err.message });
    }
  }

  // One re-index at the end rather than per track: this is what makes the new
  // files visible to the track listing at all, and walking a work folder once
  // per track would be the expensive way to reach the same state. A cancelled
  // run still indexes what it managed to write.
  if (wroteAnything) {
    await indexWorkFiles(workId, workDir, undefined, dbApi);
  }

  return tally;
}

module.exports = { transcribeWork, writeSidecar, AsrError };
