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

/** True for a Fanza work id in either spelling. DLsite ids are digits only. */
const isFanzaId = id => /^d_?\d+$/i.test(String(id));

/** True for a DLsite books-floor id — the 成年コミック/出版社 floor. */
const isBooksId = id => /^bj\d+$/i.test(String(id));

/** `d_215444` → `d215444`, `bj635795` → `BJ635795`. Others pass through. */
const canonicalizeWorkId = id => String(id)
  .replace(/^d_(\d+)$/i, 'd$1')
  .replace(/^bj(\d+)$/i, 'BJ$1');

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
  return `RJ${canonical}`;
};

module.exports = { isFanzaId, isBooksId, canonicalizeWorkId, fanzaCid, workno };
