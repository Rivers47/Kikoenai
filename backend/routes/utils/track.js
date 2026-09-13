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
 * data that cannot be refetched. See AGENTS.md §6.
 */
const legacyIndex = (segments) => (
  segments.length === 1 && /^\d+$/.test(segments[0]) ? Number(segments[0]) : null
);

/**
 * Resolve the `*path` of a media route to one track of a work.
 *
 * The candidate set is the directory walk the server did itself, and the match
 * is an equality test against it -- caller input is never joined onto a path,
 * so traversal cannot escape the work folder.
 *
 * Answers the request itself (404/500) and returns null when it cannot resolve,
 * so callers only handle the success case.
 * @returns {Promise<{work, rootFolder, workDir, tracks, track}|null>}
 */
const resolveTrack = async (req, res) => {
  const workId = req.params.id;
  const work = await db.knex('t_work')
    .select('root_folder', 'dir', 'files_indexed_at')
    .where('id', '=', workId)
    .first();
  if (!work) {
    res.status(404).send({ error: `没有 id 为 "${workId}" 的作品` });
    return null;
  }

  const rootFolder = config.rootFolders.find((folder) => folder.name === work.root_folder);
  if (!rootFolder) {
    res.status(500).send({ error: `找不到文件夹: "${work.root_folder}"，请尝试重启服务器或重新扫描.` });
    return null;
  }

  const workDir = path.join(rootFolder.path, work.dir);
  // From t_work_file, not the filesystem. This function serves every media
  // request -- stream, download, check-lrc, track-progress -- so it used to cost
  // one directory walk per request. files_indexed_at is passed through so the
  // listing does not need a second query to discover it has already been built.
  const tracks = await listWorkTracks(workId, workDir, { indexedAt: work.files_indexed_at });

  // Express 5 hands a `*path` back as an array of already-decoded segments.
  const segments = [].concat(req.params.path || []);
  const index = legacyIndex(segments);
  const track = index === null
    ? tracks.find((t) => t.shortFilePath === segments.join('/'))
    : tracks[index];
  if (!track) {
    res.status(404).send({ error: '没有找到对应的曲目' });
    return null;
  }

  return { work, rootFolder, workDir, tracks, track };
};

module.exports = { resolveTrack, legacyIndex };
