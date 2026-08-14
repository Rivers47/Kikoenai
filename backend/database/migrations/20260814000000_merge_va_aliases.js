// Merge t_va rows that are the same VA registered under several spellings.
//
// Label identity is nameToUUID(name), so a VA who registered as 乙倉ゅい,
// 乙倉ゅい（乙倉由依）, 乙倉ゅい(乙倉由依) and 乙倉ゆい ended up as four t_va rows with
// their works split between them. scraper/va-aliases.json maps each variant to
// the canonical name (resolveVaLabel keeps future scans folded); this migration
// repoints the rows already in the DB.

const { nameToUUID } = require('../../scraper/utils');
const { vaAliases } = require('../../scraper/va-aliases');

exports.up = async function(knex) {
  await knex.transaction(async (trx) => {
    for (const [variant, canonical] of Object.entries(vaAliases)) {
      const variantId = nameToUUID(variant);
      const canonicalId = nameToUUID(canonical);
      if (variantId === canonicalId) continue;

      const variantRow = await trx('t_va').first('id').where('id', variantId);
      if (!variantRow) continue;

      // The canonical row may not exist yet if only variants were ever scraped.
      await trx.raw('INSERT OR IGNORE INTO t_va(id, name) VALUES (?, ?)', [canonicalId, canonical]);
      // OR IGNORE: a work credited under both spellings already has the canonical link.
      await trx.raw(
        'INSERT OR IGNORE INTO r_va_work(va_id, work_id) SELECT ?, work_id FROM r_va_work WHERE va_id = ?',
        [canonicalId, variantId],
      );
      await trx('r_va_work').where('va_id', variantId).del();
      await trx('t_va').where('id', variantId).del();

      console.log(`  Merged VA "${variant}" into "${canonical}"`);
    }
  });
};

// Irreversible: which work belonged to which spelling is not recorded anywhere
// once the variant rows are gone. Re-scanning restores nothing either, since
// resolveVaLabel now canonicalizes on write.
exports.down = async function() {};
