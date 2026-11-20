// Custom works: a folder declared by a sidecar file (nfo.js) rather than by a
// DLsite/Fanza id. Everything that turns such a folder into a database row lives
// here, so the scanner and the refresh route share one implementation.
const fs = require('fs');
const path = require('path');

const db = require('../database/db');
const { config } = require('../config');
const { readNfoMetadata, NfoError } = require('./nfo');
const { saveCustomCovers } = require('./customCovers');
const { coverFileName } = require('./utils');

const COVER_TYPES = ['main', 'sam', '240x240'];

const silentLogger = { info() {}, warn() {}, error() {}, log() {} };

/** A refresh the caller can act on, with the HTTP status it maps to. */
class CustomWorkError extends Error {
  constructor(message, status = 400, reason = null) {
    super(message);
    this.name = 'CustomWorkError';
    this.status = status;
    this.reason = reason;
  }
}

const pad = n => String(n).padStart(2, '0');

/** Local calendar date, `YYYY-MM-DD`, for a sidecar that omits `release`. */
const localDate = (now = new Date()) =>
  `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

// Accepts bare names (from a sidecar) and `{id, name}` rows (from an existing work).
const toLabels = names => (names || []).map(item => ({
  name: typeof item === 'string' ? item : item.name,
}));

/**
 * Sidecar fields → the shape `insertWorkMetadata` / `editWorkMetadata` take.
 *
 * Omitted keys fall back to the current row (a refresh keeps what the database
 * already has) and only then to a default (a first import: title from the folder
 * name, `nsfw: false`, release = today).
 *
 * @param {Object} metadata From `readNfoMetadata`.
 * @param {Object} opts
 * @param {String} opts.folderName Folder basename, the title of last resort.
 * @param {Object} [opts.current] Existing row + labels, for a refresh.
 * @returns {Object}
 */
function customWorkFields(metadata, { folderName, current = null }) {
  const keep = current || {};
  const circleName = name => (name && typeof name === 'object' ? name.name : name) || '';

  return {
    title: metadata.title ?? keep.title ?? folderName,
    nsfw: metadata.nsfw ?? keep.nsfw ?? false,
    release: metadata.release ?? keep.release ?? localDate(),
    circle: metadata.circle !== undefined
      ? { name: metadata.circle }
      : (circleName(keep.circle) ? { name: circleName(keep.circle) } : null),
    series: metadata.series !== undefined
      ? { name: metadata.series }
      : (circleName(keep.series) ? { name: circleName(keep.series) } : null),
    description: metadata.description !== undefined
      ? metadata.description
      : (keep.description ?? null),
    tags: toLabels(metadata.tags ?? keep.tags),
    vas: toLabels(metadata.vas ?? keep.vas),
    illustrators: toLabels(metadata.illustrators ?? keep.illustrators),
    scriptWriters: toLabels(metadata.scriptwriters ?? keep.scriptWriters),
  };
}

/**
 * Insert one work from the sidecar the scan already parsed.
 * @param {Object} folder Folder object from `getFolderList` (has `nfoMetadata`).
 * @param {Object} [logger] LOG.task-compatible logger.
 * @returns {Promise<void>} Rejects on a database error; the caller decides the result.
 */
async function insertCustomWork(folder, logger = silentLogger) {
  const fields = customWorkFields(folder.nfoMetadata || {}, { folderName: path.basename(folder.absolutePath) });

  await db.insertWorkMetadata({
    id: folder.id,
    rootFolderName: folder.rootFolderName,
    dir: folder.relativePath,
    ...fields,
    // Scraper-owned columns: a custom work has none of them.
    dl_count: null,
    price: null,
    review_count: null,
    rate_count: null,
    rate_average_2dp: null,
    rate_count_detail: null,
    rank: null,
    descriptionParts: null,
    sampleImages: null,
  });

  logger.info(folder.id, '元数据成功添加到数据库.');
}

/**
 * Write the missing cover sizes from the folder's `cover.jpg`.
 * @returns {Promise<'added'|'skipped'>} `skipped` when the folder has no source image.
 */
async function generateCovers(id, absDir, types, logger = silentLogger) {
  const { written, failed, source } = await saveCustomCovers(id, absDir, types);

  if (!source) {
    logger.info(id, '文件夹里没有 cover.jpg，使用占位封面.');
    return 'skipped';
  }

  for (const failure of failed) {
    logger.warn(id, `封面 ${failure.type} 生成失败: ${failure.message}`);
  }
  if (written.length) {
    logger.info(id, `封面 ${written.join(', ')} 生成成功.`);
  }
  return written.length ? 'added' : 'skipped';
}

/** Cover types this work is missing on disk. */
function missingCoverTypes(id) {
  return COVER_TYPES.filter(type => !fs.existsSync(path.join(config.coverFolderDir, coverFileName(id, type))));
}

/**
 * Re-read a custom work's sidecar and apply it, then fill in missing covers.
 *
 * The database is authoritative between refreshes: deleting the sidecar only
 * means there is nothing left to refresh, never that the work should change.
 *
 * @param {String} workId Custom work id.
 * @param {Object} [logger] LOG.task-compatible logger.
 * @returns {Promise<void>}
 * @throws {CustomWorkError} 404 when the work or its folder is gone, 400 when the
 *         sidecar is missing or unusable (`reason: 'no-nfo'` for the missing case).
 */
async function refreshCustomWork(workId, logger = silentLogger) {
  const row = await db.knex('t_work')
    .select('id', 'root_folder', 'dir', 'description')
    .where('id', workId)
    .first();

  if (!row) throw new CustomWorkError(`没有 id 为 "${workId}" 的作品`, 404);

  const rootFolder = config.rootFolders.find(candidate => candidate.name === row.root_folder);
  const absDir = rootFolder ? path.join(rootFolder.path, row.dir) : null;
  if (!absDir || !fs.existsSync(absDir)) {
    throw new CustomWorkError(`作品文件夹不存在: ${row.root_folder}/${row.dir}`, 404);
  }

  let metadata;
  try {
    metadata = readNfoMetadata(absDir);
  } catch (err) {
    if (err instanceof NfoError) {
      const reason = /kikoenai\.nfo/.test(err.message) ? 'no-nfo' : 'bad-nfo';
      throw new CustomWorkError(err.message, 400, reason);
    }
    throw err;
  }

  const [current] = await db.getWorkMetadata(workId, 'admin');
  const fields = customWorkFields(metadata, {
    folderName: path.basename(absDir),
    current: { ...(current || {}), description: row.description },
  });

  await db.editWorkMetadata(workId, fields);

  const lost = missingCoverTypes(workId);
  if (lost.length) {
    logger.info(workId, '封面图片缺失，重新生成封面图片...');
    await generateCovers(workId, absDir, lost, logger);
  }

  logger.info(workId, '自定义作品元数据已更新.');
}

module.exports = {
  COVER_TYPES,
  CustomWorkError,
  customWorkFields,
  insertCustomWork,
  generateCovers,
  missingCoverTypes,
  refreshCustomWork,
  localDate,
};
