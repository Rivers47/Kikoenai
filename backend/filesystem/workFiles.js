/*
 * A work's file listing, read from the database rather than the disk.
 */

const fs = require('fs');
const path = require('path');
const { orderBy } = require('natural-orderby');
const db = require('../database/db');
const { config } = require('../config');
const { getTrackList, probeAudioDurations, supportedMediaExtList } = require('./utils');

/**
 * Where a work's generated subtitles live when they could not be written next
 * to the audio -- a read-only library mount, or a folder the server cannot
 * write. Mirrors the work folder's own layout, so one relPath addresses a file
 * in either place.
 */
const overlayDir = (workId) => path.join(config.lyricFolderDir, String(workId));

/**
 * Fold the overlay's files into a walk of the work folder.
 *
 * Merged here, at index time, rather than checked per request: the whole point
 * of t_work_file is that serving a work never walks a directory. Once the rows
 * are written the overlay is invisible to every reader except the one place
 * that turns a row back into a path (routes/utils/track.js).
 *
 * A file present in both places collapses to the library's copy. rel_path is
 * the primary key so it has to collapse to something, and the library is the
 * right winner: a hand-made sidecar the user dropped in should always beat a
 * generated one left over from when the mount was read-only.
 */
const mergeOverlay = async (workId, walked) => {
  const dir = overlayDir(workId);
  if (!fs.existsSync(dir)) return walked;

  const overlaid = await getTrackList(workId, dir);
  const inLibrary = new Set(walked.map((track) => track.shortFilePath));
  return walked.concat(overlaid.filter((track) => !inLibrary.has(track.shortFilePath)));
};

/**
 * Shape stored rows exactly the way getTrackList shapes a walk, including the
 * sort.
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

  // The same comparator getTrackList uses.
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
 * titles for files that are still there.
 * @returns {Promise<Array>} the shaped track list, as listWorkTracks returns.
 */
async function indexWorkFiles (workId, workDir, tracks, dbApi = db) {
  const walked = await mergeOverlay(workId, tracks || await getTrackList(workId, workDir));
  const existing = await dbApi.getWorkFiles(workId);
  const byRelPath = new Map(existing.map((row) => [row.rel_path, row]));

  const rows = walked.map((track) => {
    const kept = byRelPath.get(track.shortFilePath);
    return {
      work_id: String(workId),
      rel_path: track.shortFilePath,
      // A plain walk carries no duration -- only a scan probes -- so keep what the
      // row already had. Losing it would mean an ffprobe per file to get it back.
      duration: track.duration ?? kept?.duration ?? null,
      mtime: track.mtime ?? kept?.mtime ?? null,
      track_title: track.trackTitle ?? kept?.track_title ?? null,
    };
  });

  await dbApi.replaceWorkFiles(workId, rows);
  return shapeRows(workId, workDir, rows);
}

/**
 * A work's tracks, from the database.
 */
async function listWorkTracks (workId, workDir, { indexedAt, dbApi = db } = {}) {
  if (indexedAt === undefined) {
    const work = await dbApi.knex('t_work').select('files_indexed_at').where('id', workId).first();
    indexedAt = work ? work.files_indexed_at : null;
  }
  if (!indexedAt) {
    // One walk, no probing: ffprobe belongs to the scan paths, not to a request.
    // Durations already in the rows are carried forward by indexWorkFiles.
    return indexWorkFiles(workId, workDir, undefined, dbApi);
  }
  return shapeRows(workId, workDir, await dbApi.getWorkFiles(workId));
}

/**
 * @returns {Promise<Array>} the shaped track list
 */
async function rescanWorkFiles (workId, workDir, dbApi = db) {
  const existing = await dbApi.getWorkFiles(workId);
  const known = new Map(existing.map((row) => [
    row.rel_path,
    { duration: row.duration ?? undefined, mtime: row.mtime ?? undefined },
  ]));

  const tracks = await getTrackList(workId, workDir);
  await probeAudioDurations(workId, tracks, known);
  return indexWorkFiles(workId, workDir, tracks, dbApi);
}

module.exports = { listWorkTracks, indexWorkFiles, rescanWorkFiles, shapeRows, overlayDir };
