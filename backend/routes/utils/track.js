const fs = require('fs');
const path = require('path');
const { config } = require('../../config');
const db = require('../../database/db');
const { listWorkTracks, overlayDir } = require('../../filesystem/workFiles');
const { supportedSubtitleExtList } = require('../../filesystem/utils');

// Extensions a generated subtitle can carry, i.e. the only rows whose bytes
// might live in the overlay rather than the work folder. '.txt' is in the list
// because an ASR server answering text/plain is saved as one (see asr.js).
const OVERLAY_EXT = [...supportedSubtitleExtList, '.txt'];

/**
 * Where a track's bytes actually are.
 *
 * The work folder first, the overlay second -- which is both the common case
 * and the "library copy wins" rule, without either needing to be stated
 * anywhere else. Only subtitle rows can miss, so audio pays no extra stat.
 */
const trackPath = (workId, workDir, track) => {
  const inLibrary = path.join(workDir, track.shortFilePath);
  if (!OVERLAY_EXT.includes(track.ext) || fs.existsSync(inLibrary)) return inLibrary;
  return path.join(overlayDir(workId), track.shortFilePath);
};

/**
 * Legacy positional-index handle.
 *
 * A tracked file always carries a supported extension, so its relPath always
 * contains a '.'. A single path segment of pure digits therefore cannot be a
 * real relPath -- it is the positional index that play-history queues written
 * before migration 20260912000000 still carry, and those rows are stored user
 * data that cannot be refetched.
 */
const legacyIndex = (segments) => (
  segments.length === 1 && /^\d+$/.test(segments[0]) ? Number(segments[0]) : null
);

/**
 * Resolve the `*path` of a media route to one track of a work.
 *
 * @returns {Promise<{work, rootFolder, workDir, tracks, track, fullPath}|null>}
 */
const resolveTrack = async (req, res) => {
  const workId = req.params.id;
  const work = await db.knex('t_work')
    .select('root_folder', 'dir', 'files_indexed_at')
    .where('id', '=', workId)
    .first();
  if (!work) {
    res.status(404).send({ error: `"${workId}" does not exist.` });
    return null;
  }

  const rootFolder = config.rootFolders.find((folder) => folder.name === work.root_folder);
  if (!rootFolder) {
    res.status(500).send({ error: `Directory "${work.root_folder}" not found, please try restarting the server or rescanning.` });
    return null;
  }

  const workDir = path.join(rootFolder.path, work.dir);
  const tracks = await listWorkTracks(workId, workDir, { indexedAt: work.files_indexed_at });

  // Express 5 hands a `*path` back as an array of already-decoded segments.
  const segments = [].concat(req.params.path || []);
  const index = legacyIndex(segments);
  const track = index === null
    ? tracks.find((t) => t.shortFilePath === segments.join('/'))
    : tracks[index];
  if (!track) {
    res.status(404).send({ error: 'Track not found.' });
    return null;
  }

  return { work, rootFolder, workDir, tracks, track, fullPath: trackPath(workId, workDir, track) };
};

module.exports = { resolveTrack, legacyIndex };
