// Canonicalizes scraped DLsite tag names so a DLsite rename folds onto the
// existing (old-name) t_tag row instead of creating a new one.
//
// Tag identity in the DB is nameToUUID(name) (scraper/utils.js). When DLsite
// renames a genre, the new name hashes to a new UUID and splits the tag into
// two rows. This map redirects the new name back to the canonical old name at
// the single tag-resolve choke point (resolveTagLabel in queries.js), so every
// tag write path (scan-insert, scan-update, admin-edit) normalizes uniformly.
//
// The map is hand-maintained in tag-aliases.json and loaded once at require
// time; restart the server to pick up edits. Fanza/free-form tags are not in
// the map and pass through unchanged (no stable id exists for them). Existing
// split rows are merged by
// database/migrations/20260825000000_merge_tag_aliases.js.
//
// ponytail: in-memory load, no watcher — edits need a restart. Acceptable for
// a rarely-changed hand-curated map; add a fs.watch if it ever becomes hot.

const path = require('path');
const fs = require('fs');

let aliases = {};
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'tag-aliases.json'), 'utf8'));
  // Drop the _comment / _format / _examples metadata keys.
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    aliases[k] = v;
  }
} catch (err) {
  console.warn('Failed to load scraper/tag-aliases.json:', err.message);
}

/**
 * Map a scraped tag name to its canonical name. Unmapped names return unchanged.
 * @param {string} name Scraped (current) Japanese tag name.
 * @returns {string} Canonical name to store/resolve under.
 */
const canonicalizeTagName = (name) => (name != null && Object.prototype.hasOwnProperty.call(aliases, name))
  ? aliases[name]
  : name;

if (process.env.NODE_ENV !== 'production' && require.main === module) {
  // ponytail: smallest self-check — unmapped→identity (the shipped stub is an
  // empty map; the mapped path is a one-liner aliases[name]). When you add a
  // real entry, also assert it here so the mapping stays correct.
  const assert = require('assert');
  // DLsite renamed the ロリ genre to つるぺた; the pre-existing katakana ツルペタ
  // genre is folded in too (see tag-aliases.json).
  assert.strictEqual(canonicalizeTagName('つるぺた'), 'ロリ');
  assert.strictEqual(canonicalizeTagName('ツルペタ'), 'ロリ');
  assert.strictEqual(canonicalizeTagName('ロリ'), 'ロリ');
  assert.strictEqual(canonicalizeTagName('未映射のタグ'), '未映射のタグ');
  assert.strictEqual(canonicalizeTagName(null), null);
  console.log('tag-aliases self-check OK');
}

module.exports = { canonicalizeTagName, tagAliases: aliases };