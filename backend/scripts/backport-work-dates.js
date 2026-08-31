/**
 * Restore "date added to library" from a kikoeru-project era database.
 *
 * The old fork recorded when a work was first scanned in as `t_work.insert_time`;
 * this fork uses `t_work.created_at`, which is set when *this* installation
 * first saw the folder. For a library carried over from the old fork that is
 * the day of the initial scan, so hundreds of works collapse onto one
 * timestamp and "sort by date added" (an `order` option in
 * routes/metadata.js, shown as works.createdAt in Works.vue) becomes useless
 * for everything acquired before the switch.
 *
 * Ids are matched with formatID, the same way import-legacy-history.js does it:
 * old rows store bare integers, this schema stores them zero-padded.
 *
 * The only rule is **never move a date forward**. A work whose current
 * created_at is already earlier than the legacy insert_time was added to this
 * installation before the old database last recorded it, so the current value
 * is the truer one and is left alone. That also makes the script idempotent.
 *
 * `updated_at` is deliberately untouched: on t_work it means "metadata last
 * refreshed", which has nothing to do with acquisition.
 *
 * Usage:
 *   node ./scripts/backport-work-dates.js ../old_sqlite/db.sqlite3 --dry-run
 *   node ./scripts/backport-work-dates.js ../old_sqlite/db.sqlite3
 */

const path = require('path');
const Knex = require('knex');
const db = require(path.join(__dirname, '..', 'database', 'db'));
const { formatID } = require(path.join(__dirname, '..', 'filesystem', 'utils'));

async function runBackport({
  oldDbPath,
  dryRun = false,
  log = (m) => console.log(m),
  dbApi = db,
} = {}) {
  // Read-only would be nicer, but knex's sqlite3 dialect ORs its own
  // OPEN_READWRITE | OPEN_CREATE into whatever `flags` you pass, and adding
  // OPEN_READONLY makes an illegal combination. Only SELECTs are issued here.
  const oldKnex = Knex({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: { filename: oldDbPath },
  });

  const summary = { legacyRows: 0, missing: 0, alreadyEarlier: 0, updated: 0, dryRun };

  try {
    log(`[backport-work-dates] Reading ${oldDbPath}${dryRun ? ' (DRY RUN)' : ''}`);

    const legacy = await oldKnex('t_work').select('id', 'insert_time').whereNotNull('insert_time');
    summary.legacyRows = legacy.length;

    const current = new Map(
      (await dbApi.knex('t_work').select('id', 'created_at')).map(w => [w.id, w.created_at]));

    const updates = [];
    for (const row of legacy) {
      const workId = formatID(parseInt(String(row.id), 10));
      const currentDate = current.get(workId);
      if (currentDate === undefined) {
        summary.missing++;
        continue;
      }
      // Both are 'YYYY-MM-DD HH:MM:SS' text, so a plain string compare orders
      // them correctly. (Do NOT compare against a bare year literal in SQL --
      // the column is declared `datetime`, which carries NUMERIC affinity, so
      // SQLite would coerce the literal to an integer and sort it below all
      // text values.)
      if (String(currentDate) <= String(row.insert_time)) {
        summary.alreadyEarlier++;
        continue;
      }
      updates.push({ workId, from: currentDate, to: row.insert_time });
    }

    for (const u of updates) {
      if (dryRun) {
        log(`  [DRY] ${u.workId}  ${u.from} -> ${u.to}`);
      } else {
        await dbApi.knex('t_work').where('id', u.workId).update({ created_at: u.to });
      }
      summary.updated++;
    }

    log('');
    log('[backport-work-dates] Done.');
    log(`  Legacy rows with insert_time: ${summary.legacyRows}`);
    log(`    not in this library:        ${summary.missing}`);
    log(`    current date already older: ${summary.alreadyEarlier}`);
    log(`    created_at moved back:      ${summary.updated}`);
    if (dryRun) log('  (dry run -- no writes performed)');

    return summary;
  } finally {
    await oldKnex.destroy();
  }
}

module.exports = { runBackport };

if (require.main === module) {
  const args = process.argv.slice(2);
  const oldDbPath = args.find(a => !a.startsWith('--'));
  if (!oldDbPath) {
    console.error('Usage: node ./scripts/backport-work-dates.js <old-db.sqlite3> [--dry-run]');
    process.exit(1);
  }
  runBackport({ oldDbPath: path.resolve(oldDbPath), dryRun: args.includes('--dry-run') })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[backport-work-dates] Fatal error:', err);
      process.exit(1);
    });
}
