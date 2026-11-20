// Sidecar files that declare a folder as a work of its own, for media with no
// DLsite/Fanza id. The file is read when the work is imported and when it is
// refreshed; after that the database is authoritative and the file may go.
const fs = require('fs');
const path = require('path');
const { parse: parseToml } = require('smol-toml');

/** Recognised file names, in priority order. Bare `.nfo` is never read. */
const NFO_FILENAMES = ['kikoenai.nfo', '.kikoenai.nfo'];

const STRING_LIST_KEYS = ['tags', 'vas', 'illustrators', 'scriptwriters'];

/** A sidecar that cannot be read or does not fit the format. */
class NfoError extends Error {
  constructor(message, filePath, key) {
    super(message);
    this.name = 'NfoError';
    this.filePath = filePath;
    this.key = key;
  }
}

/**
 * Ambiguous folder layout: the same files would belong to two works.
 * Carries every path involved so the scan log can name them all.
 */
class NfoConflictError extends Error {
  constructor(message, paths) {
    super(message);
    this.name = 'NfoConflictError';
    this.paths = paths;
  }
}

const baseName = entry => (typeof entry === 'string' ? entry : entry.name);

/**
 * The sidecar this folder declares, if any.
 * @param {Array<import('fs').Dirent|String>} entries Directory entries.
 * @returns {String|null} File name to read, `kikoenai.nfo` before `.kikoenai.nfo`.
 */
function findNfoEntry(entries) {
  const names = (entries || []).map(baseName).map(name => String(name).toLowerCase());
  for (const candidate of NFO_FILENAMES) {
    if (names.includes(candidate)) {
      const index = names.indexOf(candidate);
      return baseName(entries[index]);
    }
  }
  return null;
}

const fail = (message, filePath, key) => {
  throw new NfoError(message, filePath, key);
};

/**
 * `YYYY-MM-DD`, or a TOML date literal, which smol-toml hands back as a Date.
 * @returns {String|undefined} Normalised date, or undefined when absent.
 */
function readRelease(value, filePath, key) {
  if (value === undefined) return undefined;

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) fail(`无法解析日期: ${key}`, filePath, key);
    return value.toISOString().slice(0, 10);
  }

  if (typeof value !== 'string') fail(`字段 ${key} 必须是 YYYY-MM-DD 字符串`, filePath, key);

  const text = value.trim();
  if (!text) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail(`字段 ${key} 必须是 YYYY-MM-DD: "${text}"`, filePath, key);

  const [year, month, day] = text.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    fail(`字段 ${key} 不是有效日期: "${text}"`, filePath, key);
  }
  return text;
}

/**
 * One string field: trimmed, with '' treated as absent so an emptied key reads
 * the same as a missing one.
 */
function readString(table, key, filePath) {
  const value = table[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(`字段 ${key} 必须是字符串`, filePath, key);
  const text = value.trim();
  return text === '' ? undefined : text;
}

/**
 * A list of names: trimmed, empties dropped, deduplicated in order.
 *
 * Absent stays `undefined` (not `[]`), so a refresh can tell "the file no longer
 * says" from "the file says none".
 */
function readStringList(table, key, filePath) {
  const value = table[key];
  if (value === undefined) return undefined;

  if (!Array.isArray(value)) fail(`字段 ${key} 必须是字符串数组`, filePath, key);

  const seen = new Set();
  const names = [];
  for (const item of value) {
    if (typeof item !== 'string') fail(`字段 ${key} 的每一项都必须是字符串`, filePath, key);
    const name = item.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * Parse and validate one sidecar into the fields the database takes.
 *
 * Omitted fields come back undefined; defaults (title from the folder name,
 * `nsfw: false`, release = today) are the caller's to apply. Unknown keys are
 * ignored, so a newer file does not break an older server.
 *
 * @param {String} dirPath Absolute path of the work folder.
 * @param {String} [fileName] Sidecar to read; defaults to the first that exists.
 * @returns {Object} `{ title?, nsfw?, release?, circle?, tags?, vas?, illustrators?, scriptwriters?, series?, description? }`
 * @throws {NfoError}
 */
function readNfoMetadata(dirPath, fileName = null) {
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    throw new NfoError(`无法读取作品文件夹: ${err.message}`, dirPath);
  }

  const name = fileName || findNfoEntry(entries);
  if (!name) throw new NfoError('该文件夹没有 kikoenai.nfo 或 .kikoenai.nfo', dirPath);

  const filePath = path.join(dirPath, name);

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new NfoError(`无法读取文件: ${err.message}`, filePath);
  }

  let table;
  try {
    table = parseToml(raw);
  } catch (err) {
    throw new NfoError(`TOML 格式错误: ${err.message.split('\n')[0]}`, filePath);
  }

  const metadata = {
    title: readString(table, 'title', filePath),
    circle: readString(table, 'circle', filePath),
    series: readString(table, 'series', filePath),
    description: readString(table, 'description', filePath),
    release: readRelease(table.release, filePath, 'release'),
  };

  if (table.nsfw !== undefined) {
    if (typeof table.nsfw !== 'boolean') fail('字段 nsfw 必须是布尔值', filePath, 'nsfw');
    metadata.nsfw = table.nsfw;
  }

  for (const key of STRING_LIST_KEYS) {
    metadata[key] = readStringList(table, key, filePath);
  }

  return metadata;
}

module.exports = {
  NFO_FILENAMES,
  NfoError,
  NfoConflictError,
  findNfoEntry,
  readNfoMetadata,
};
