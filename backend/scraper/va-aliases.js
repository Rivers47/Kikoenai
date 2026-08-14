// Canonicalizes scraped VA names so a VA who registered under several
// spellings folds onto one t_va row instead of one row per spelling.
//
// Same mechanism as scraper/tag-aliases.js (see that file's header): label
// identity is nameToUUID(name), so 乙倉ゅい / 乙倉ゅい（乙倉由依）/ 乙倉ゅい(乙倉由依) /
// 乙倉ゆい each hash to a different UUID and split the works between them. This
// map redirects every variant to the canonical name at the single VA-resolve
// choke point (resolveVaLabel in queries.js), covering scan-insert,
// scan-update and admin-edit.
//
// The map is hand-maintained in va-aliases.json and loaded once at require
// time; restart the server to pick up edits. Existing split rows are merged by
// database/migrations/20260814000000_merge_va_aliases.js.

const path = require('path');
const fs = require('fs');

let aliases = {};
try {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'va-aliases.json'), 'utf8'));
  // Drop the _comment metadata key.
  for (const [k, v] of Object.entries(raw)) {
    if (k.startsWith('_')) continue;
    aliases[k] = v;
  }
} catch (err) {
  console.warn('Failed to load scraper/va-aliases.json:', err.message);
}

/**
 * Map a scraped VA name to its canonical name. Unmapped names return unchanged.
 * @param {string} name Scraped VA name.
 * @returns {string} Canonical name to store/resolve under.
 */
const canonicalizeVaName = (name) => (name != null && Object.prototype.hasOwnProperty.call(aliases, name))
  ? aliases[name]
  : name;

if (process.env.NODE_ENV !== 'production' && require.main === module) {
  const assert = require('assert');
  assert.strictEqual(canonicalizeVaName('乙倉ゅい（乙倉由依）'), '乙倉ゅい');
  assert.strictEqual(canonicalizeVaName('乙倉ゅい'), '乙倉ゅい');
  assert.strictEqual(canonicalizeVaName('未登録の声優'), '未登録の声優');
  assert.strictEqual(canonicalizeVaName(null), null);
  console.log('va-aliases self-check OK');
}

module.exports = { canonicalizeVaName, vaAliases: aliases };
