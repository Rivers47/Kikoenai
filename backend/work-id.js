/**
 * Work-id helpers.
 *
 * **Canonical form** (database, API, URLs, everything in the app): a DLsite id
 * is zero-padded digits (`'123456'` / `'01134567'`), a Fanza id is `d` +
 * digits (`'d215444'`) — no underscore, because an unquoted `_` stands for a
 * space in the search syntax (see `database/search-query.js`).
 *
 * The underscore form `d_215444` is Fanza's own content id. It survives at
 * three boundaries and nowhere else: work folder names on disk, cover/image
 * file names, and DMM URLs. `fanzaCid()` produces it, `canonicalizeWorkId()`
 * absorbs it (old bookmarks, stale PWA caches, pre-migration rows, and folders
 * named after the cid).
 */

/** True for a Fanza work id in either spelling. DLsite ids are digits only. */
const isFanzaId = id => /^d_?\d+$/i.test(String(id));

/** `d_215444` → `d215444`. Any other id passes through untouched. */
const canonicalizeWorkId = id => String(id).replace(/^d_(\d+)$/i, 'd$1');

/** `d215444` → `d_215444`, the form Fanza itself uses. */
const fanzaCid = id => String(id).replace(/^d(\d+)$/i, 'd_$1');

module.exports = { isFanzaId, canonicalizeWorkId, fanzaCid };
