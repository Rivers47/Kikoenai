/**
 * Work-id helpers.
 *
 * **Canonical form** (database, API, URLs, everything in the app): a DLsite
 * doujin id is zero-padded digits (`'123456'` / `'01134567'`), a DLsite books
 * id keeps its `BJ` prefix (`'BJ635795'`), a Fanza id is `d` + digits
 * (`'d215444'`) — no underscore, because an unquoted `_` stands for a space in
 * the search syntax (see `database/search-query.js`).
 *
 * `RJ` is implicit on a bare-digit id, so it is stripped; `BJ` is not, and
 * dropping it would collide `BJ635795` with `RJ635795`.
 *
 * The underscore form `d_215444` is Fanza's own content id. It survives at
 * three boundaries and nowhere else: work folder names on disk, cover/image
 * file names, and DMM URLs. `fanzaCid()` produces it, `canonicalizeWorkId()`
 * absorbs it (old bookmarks, stale PWA caches, pre-migration rows, and folders
 * named after the cid).
 */

const { v5: uuidv5 } = require('uuid');

/** True for a Fanza work id in either spelling. DLsite ids are digits only. */
const isFanzaId = id => /^d_?\d+$/i.test(String(id));

/** True for a DLsite books-floor id — the 成年コミック/出版社 floor. */
const isBooksId = id => /^bj\d+$/i.test(String(id));

/**
 * Custom (sidecar-declared) work ids: a UUID v5, see `customWorkId`.
 *
 * The bare pattern is exported so route validators can compose it into their
 * own anchored regex instead of keeping a copy that would drift.
 */
const CUSTOM_WORK_ID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const CUSTOM_WORK_ID_RE = new RegExp(`^${CUSTOM_WORK_ID_PATTERN}$`, 'i');

/** True for a work id derived from a work folder with no DLsite/Fanza id. */
const isCustomWorkId = id => CUSTOM_WORK_ID_RE.test(String(id));

/**
 * Namespace for custom-work ids. Fixed forever: changing it re-imports every
 * custom work under a new id. Distinct from the label namespace in scraper/utils.
 */
const CUSTOM_WORK_NAMESPACE = '2f8a1c4e-9b3d-5e6f-8a71-4c0d5b2e9f13';

/** Windows separators become `/`, so an id hashes the same on every platform. */
const toPosixPath = p => String(p).replace(/\\/g, '/');

/**
 * Stable id for a work declared by a sidecar file.
 *
 * Derived from the root folder *alias* (not its absolute path, so moving a
 * library keeps ids) plus the work-relative path. Renaming the folder yields a
 * new work; editing the sidecar's title does not.
 *
 * @param {String} rootFolderName Root folder alias.
 * @param {String} relativePath Work folder path relative to that root.
 * @returns {String} UUID v5.
 */
const customWorkId = (rootFolderName, relativePath) => {
  const alias = String(rootFolderName);
  // Length-prefixed so no pair of alias/path can spell another pair's key.
  const key = `${alias.length}\u0000${alias}\u0000${toPosixPath(relativePath).normalize('NFC')}`;
  return uuidv5(key, CUSTOM_WORK_NAMESPACE);
};

/**
 * `d_215444` → `d215444`, `bj635795` → `BJ635795`, `A3F5…` → `a3f5…`.
 * Others pass through.
 */
const canonicalizeWorkId = id => String(id)
  .replace(/^d_(\d+)$/i, 'd$1')
  .replace(/^bj(\d+)$/i, 'BJ$1')
  .replace(CUSTOM_WORK_ID_RE, m => m.toLowerCase());

/** `d215444` → `d_215444`, the form Fanza itself uses. */
const fanzaCid = id => String(id).replace(/^d(\d+)$/i, 'd_$1');

/**
 * The prefixed spelling DLsite and Fanza use in URLs and asset file names:
 * `'635795'` → `'RJ635795'`, `'BJ635795'` → `'BJ635795'`, `'d215444'` →
 * `'d_215444'`.
 */
const workno = (id) => {
  const canonical = canonicalizeWorkId(id);
  if (isFanzaId(canonical)) return fanzaCid(canonical);
  if (isBooksId(canonical)) return canonical;
  // A custom work has no store code: the id itself is the file-name prefix.
  if (isCustomWorkId(canonical)) return canonical;
  return `RJ${canonical}`;
};

module.exports = {
  isFanzaId, isBooksId, isCustomWorkId, CUSTOM_WORK_ID_PATTERN, CUSTOM_WORK_ID_RE,
  CUSTOM_WORK_NAMESPACE, customWorkId, canonicalizeWorkId, fanzaCid, workno,
};
