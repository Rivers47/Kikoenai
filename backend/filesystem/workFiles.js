/*
 * A work's file listing, read from the database rather than the disk.
 *
 * It used to be rebuilt by walking the work folder on every request:
 * `resolveTrack` calls `getTrackList`, so each stream, download, check-lrc and
 * track-progress write cost a directory walk. On a network mount that is
 * latency times file count, and works here run to hundreds of files.
 *
 * The listing now lives in t_work_file, written by the three scan paths
 * (scanWork, scanWorkFile, POST /api/scan/:id). `getTrackList` remains the
 * filesystem walker, but it is no longer on the request path -- only the scan
 * paths and the one-off indexing below call it.
 *
 * Shared by the routes and by the CLI scripts, and deliberately not part of
 * filesystem/utils.js: that module knows nothing about the database, and the
 * scanner-side IPC lives elsewhere again (see workExtras.js for the same split).
 *
 * Every entry point takes an optional `dbApi`, defaulting to the live database,
 * the same convention scripts/backfill-progress.js uses so tests can inject an
 * in-memory knex.
 */

const path = require('path');
const { orderBy } = require('natural-orderby');
const db = require('../database/db');
const { getTrackList, scrapeWorkMemo, supportedMediaExtList } = require('./utils');

/**
 * Shape stored rows exactly the way getTrackList shapes a walk, including the
 * sort. Ordering is the part that must not drift: it decides the order of every
 * file tree, and it used to come from natural-orderby over the walked list.
 * Rows carry rel_path only -- title/subtitle/ext all derive from it.
 */
const shapeRows = (workId, workDir, rows) => {
  const shaped = rows.map((row) => {
    const relPath = row.rel_path;
    const dirName = path.dirname(relPath);
    return {
      title: path.basename(relPath),
      subtitle: dirName === '.' ? null : dirName,
      ext: path.extname(relPath).toLowerCase(),
      shortFilePath: relPath,
      trackId: `${workId}/${relPath}`,
      duration: row.duration === null ? undefined : row.duration,
      trackTitle: row.track_title || undefined,
      mtime: row.mtime === null ? undefined : row.mtime,
      fullPath: path.join(workDir, relPath),
    };
  });

  // The same comparator getTrackList uses. Keep these in step.
  const sorted = orderBy(shaped, [v => v.subtitle, v => v.title, v => v.ext]);

  // getTrackList only attaches duration/trackTitle to audio, and callers read
  // `undefined` as "unknown". Mirror that rather than exposing them on a .jpg.
  for (const file of sorted) {
    if (!supportedMediaExtList.includes(file.ext)) {
      delete file.duration;
      delete file.trackTitle;
    }
    delete file.fullPath;
  }
  return sorted;
};

/**
 * Walk the work folder and replace its rows. Preserves durations and track
 * titles for files that are still there -- those cost an ffprobe and an LLM
 * call respectively, so losing them to a re-index would be expensive.
 * @returns {Promise<Array>} the shaped track list, as listWorkTracks returns.
 */
async function indexWorkFiles (workId, workDir, tracks, dbApi = db) {
  const walked = tracks || await getTrackList(workId, workDir, {});
  const existing = await dbApi.getWorkFiles(workId);
  const byRelPath = new Map(existing.map((row) => [row.rel_path, row]));

  const rows = walked.map((track) => {
    const kept = byRelPath.get(track.shortFilePath);
    return {
      work_id: String(workId),
      rel_path: track.shortFilePath,
      // A freshly walked track carries duration/trackTitle only when the caller
      // passed a scan's output; otherwise keep whatever the row already had.
      duration: track.duration ?? kept?.duration ?? null,
      mtime: track.mtime ?? kept?.mtime ?? null,
      track_title: track.trackTitle ?? kept?.track_title ?? null,
    };
  });

  await dbApi.replaceWorkFiles(workId, rows);
  return shapeRows(workId, workDir, rows);
}

/**
 * A work's tracks, from the database. Indexes the work once if it has never
 * been indexed -- one walk, which is what every read did before this existed.
 *
 * `files_indexed_at` rather than a row count, so a genuinely empty work is not
 * re-walked on every request.
 */
async function listWorkTracks (workId, workDir, { indexedAt, memo, dbApi = db } = {}) {
  if (indexedAt === undefined || memo === undefined) {
    const work = await dbApi.knex('t_work')
      .select('files_indexed_at', 'memo')
      .where('id', workId)
      .first();
    if (indexedAt === undefined) indexedAt = work ? work.files_indexed_at : null;
    if (memo === undefined) memo = work ? work.memo : null;
  }
  if (!indexedAt) {
    // Index through the memo, not a bare walk: durations cost an ffprobe each
    // and track titles cost a model call, and both are already sitting in memo
    // keyed by relPath. A bare walk would write NULLs over them and the next
    // scan would have to re-probe the whole work.
    let parsed = {};
    try {
      parsed = JSON.parse(memo || '{}') || {};
    } catch {
      parsed = {};
    }
    return indexWorkFilesFromMemo(workId, workDir, parsed, dbApi);
  }
  return shapeRows(workId, workDir, await dbApi.getWorkFiles(workId));
}

/**
 * Write the listing from a memo that has already been probed.
 *
 * `scanWork` needs this split out: it probes durations *before* the metadata
 * insert that creates the t_work row, and t_work_file has a foreign key to it --
 * so the probe and the row write cannot happen at the same moment.
 */
async function indexWorkFilesFromMemo (workId, workDir, memo, dbApi = db) {
  // The memo carries duration and trackTitles; getTrackList merges them onto the
  // walked list, and mtime comes off the memo directly.
  const tracks = await getTrackList(workId, workDir, memo);
  return indexWorkFiles(workId, workDir, tracks.map((track) => ({
    ...track,
    mtime: (memo.mtime || {})[track.shortFilePath],
  })), dbApi);
}

/**
 * Probe durations and rewrite the listing in one step, so a scan can never
 * refresh one and forget the other. For works that already exist; `scanWork`
 * uses the two halves separately (see above).
 *
 * Two walks -- scrapeWorkMemo's and getTrackList's -- which is deliberate. A
 * scan is dominated by ffprobe (one subprocess per audio file), so a second
 * readdir is noise, and sharing it would mean changing scrapeWorkMemo's
 * signature at every call site for no measurable gain.
 *
 * @returns {Promise<Object>} the memo, for the caller to persist.
 */
async function rescanWorkFiles (workId, workDir, oldMemo, dbApi = db) {
  const memo = await scrapeWorkMemo(workId, workDir, oldMemo);
  await indexWorkFilesFromMemo(workId, workDir, memo, dbApi);
  return memo;
}

module.exports = {
  listWorkTracks, indexWorkFiles, indexWorkFilesFromMemo, rescanWorkFiles, shapeRows,
};
