const path = require('path');
const { config } = require('../../config');
const db = require('../../database/db');
const { listWorkTracks } = require('../../filesystem/workFiles');

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
 * @returns {Promise<{work, rootFolder, workDir, tracks, track}|null>}
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

  return { work, rootFolder, workDir, tracks, track };
};

module.exports = { resolveTrack, legacyIndex };
