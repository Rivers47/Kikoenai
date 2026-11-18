// Cover generation for custom works: the user supplies one image, the server
// writes the same three sizes a downloaded work gets.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const { config } = require('../config');
const { coverFileName } = require('./utils');

/** Source file names, in priority order; matched case-insensitively. */
const COVER_SOURCE_NAMES = ['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp'];

/** Resize rules per cover type. `main` keeps the source resolution. */
const COVER_FILTERS = {
  main: null,
  sam: 'scale=640:-2',
  '240x240': 'scale=240:240:force_original_aspect_ratio=increase,crop=240:240',
};

const COVER_QUALITY = {
  main: '2',
  sam: '3',
  '240x240': '3',
};

/**
 * The image this folder offers as a cover, if any.
 * @param {String} dirPath Absolute path of the work folder.
 * @returns {String|null} Absolute path of the source image.
 */
function findCoverSource(dirPath) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return null;
  }

  const byLowerName = new Map(entries.map(name => [name.toLowerCase(), name]));
  for (const candidate of COVER_SOURCE_NAMES) {
    const actual = byLowerName.get(candidate);
    if (actual) return path.join(dirPath, actual);
  }
  return null;
}

/**
 * ffmpeg arguments for one cover type.
 * @param {String} sourcePath Source image.
 * @param {String} outputPath Destination `.jpg`.
 * @param {String} type One of `COVER_FILTERS`' keys.
 * @returns {Array<String>}
 */
function buildCoverArgs(sourcePath, outputPath, type) {
  const filter = COVER_FILTERS[type];
  return [
    '-y',
    '-i', sourcePath,
    ...(filter ? ['-vf', filter] : []),
    '-q:v', COVER_QUALITY[type],
    outputPath,
  ];
}

/**
 * Write the given cover types from the folder's source image.
 *
 * Types whose source is missing are simply not written: callers pass only the
 * types they found missing on disk, so nothing existing is overwritten.
 *
 * @param {String} id Work id, custom or not; the file name comes from coverFileName.
 * @param {String} dirPath Absolute path of the work folder.
 * @param {Array<String>} types Cover types to write.
 * @returns {Promise<{written: Array<String>, failed: Array<{type: String, message: String}>, source: String|null}>}
 *          Never throws: a cover is decoration, so a failure is the caller's to log.
 */
async function saveCustomCovers(id, dirPath, types = ['main', 'sam', '240x240']) {
  const source = findCoverSource(dirPath);
  if (!source) return { written: [], failed: [], source: null };

  fs.mkdirSync(config.coverFolderDir, { recursive: true });

  const written = [];
  const failed = [];

  for (const type of types) {
    const outputPath = path.join(config.coverFolderDir, coverFileName(id, type));
    try {
      await execFileAsync('ffmpeg', buildCoverArgs(source, outputPath, type), { timeout: 60000 });
      written.push(type);
    } catch (err) {
      failed.push({ type, message: err.message });
      // ffmpeg may leave a truncated file behind; a half-written cover would be
      // served as if it were complete.
      try {
        fs.unlinkSync(outputPath);
      } catch { /* nothing was written */ }
    }
  }

  return { written, failed, source };
}

module.exports = {
  COVER_SOURCE_NAMES,
  COVER_FILTERS,
  buildCoverArgs,
  findCoverSource,
  saveCustomCovers,
};
