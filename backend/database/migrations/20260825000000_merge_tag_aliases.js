// Merge t_tag rows split apart by a DLsite genre rename.
//
// Tag identity is nameToUUID(name), so when DLsite renames a genre the new name
// hashes to a new UUID and the works split across two rows. scraper/tag-aliases.json
// maps each renamed name back to the canonical old name (resolveTagLabel keeps
// future scans folded); this migration repoints the rows already in the DB.
//
// Same shape as 20260814000000_merge_va_aliases.js. The map has no chains (no
// value is also a key), so one pass is enough.
//
// Note this also folds the katakana ツルペタ genre into ロリ. DLsite kept it as a
// separate genre id from the つるぺた it renamed ロリ to, so works could carry
// both; here they are deliberately treated as one tag.

const { nameToUUID } = require('../../scraper/utils');
const { tagAliases } = require('../../scraper/tag-aliases');

exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    for (const [variant, canonical] of Object.entries(tagAliases)) {
      const variantId = nameToUUID(variant);
      const canonicalId = nameToUUID(canonical);
      if (variantId === canonicalId) continue;

      const variantRow = await trx('t_tag').first('id').where('id', variantId);
      if (!variantRow) continue;

      // The canonical row may not exist yet if only the new name was ever scraped.
      await trx.raw('INSERT OR IGNORE INTO t_tag(id, name) VALUES (?, ?)', [canonicalId, canonical]);
      // OR IGNORE: a work tagged under both names already has the canonical link.
      await trx.raw(
        'INSERT OR IGNORE INTO r_tag_work(tag_id, work_id) SELECT ?, work_id FROM r_tag_work WHERE tag_id = ?',
        [canonicalId, variantId],
      );
      await trx('r_tag_work').where('tag_id', variantId).del();
      await trx('t_tag').where('id', variantId).del();

      console.log(`  Merged tag "${variant}" into "${canonical}"`);
    }
  });
};

// Irreversible: which work was tagged with which name is not recorded anywhere
// once the variant rows are gone. Re-scanning restores nothing either, since
// resolveTagLabel now canonicalizes on write.
exports.down = async function() {};
