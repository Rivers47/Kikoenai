/**
 * Restore `t_work`'s foreign key to `t_circle`.
 *
 * `database/schema.js` has always declared it, so a **fresh** install has it. A
 * *migrated* one does not: `20260802000000` rebuilt `t_work` as `t_work_tmp` to
 * change `id` from INTEGER to TEXT, and its `createTable` never re-declared the
 * constraint -- while the same migration carefully re-declared foreign keys for
 * the `r_*` join tables and `t_play_history`. An omission in one table, not a
 * systemic one: every other table in a real database still has its keys.
 *
 * Consequence: constraint behaviour depended on how the database came to exist,
 * which is exactly what keeping `createSchema` in step with the migrations is
 * supposed to prevent. `db.js` sets `PRAGMA foreign_keys = ON`, so the constraint
 * *would* be enforced -- nothing was enforcing circle integrity on `t_work`.
 *
 * No data was harmed by the gap (measured on a real 1814-work library: zero works
 * with a `circle_id` missing from `t_circle`, zero NULLs), because `resolveLabel`
 * always creates the circle row before inserting the work.
 *
 * SQLite cannot add a constraint in place, so this is the documented
 * twelve-step table rebuild. Two details it is easy to get wrong:
 *
 *  - `PRAGMA foreign_keys` is a no-op inside a transaction, so it is toggled
 *    outside one. Other tables carry keys pointing *at* `t_work`, and dropping it
 *    with enforcement on would fail or cascade.
 *  - Columns are copied by intersecting the new table's list with what the old one
 *    actually has, rather than being hardcoded. That way the migration is correct
 *    whether or not `memo` is still present (it is dropped by 20260914000000) and
 *    cannot fail on a database carrying some other unexpected drift.
 */

// The canonical shape, matching createSchema. Keep in step with database/schema.js.
const defineWork = (table) => {
  table.string('id').notNullable();
  table.timestamps(true, true);
  table.string('root_folder').notNullable();
  table.string('dir').notNullable();
  table.string('title').notNullable();
  table.string('circle_id').notNullable();
  table.boolean('nsfw');
  table.string('release');
  table.integer('dl_count');
  table.integer('price');
  table.integer('review_count');
  table.integer('rate_count');
  table.float('rate_average_2dp');
  table.text('rate_count_detail');
  table.text('rank');
  table.text('description');
  table.text('description_parts');
  table.text('sample_images');
  table.datetime('files_indexed_at');

  table.primary('id');
  table.foreign('circle_id').references('id').inTable('t_circle');
};

const INDEX_COLUMNS = ['circle_id', 'release', 'dl_count', 'review_count', 'price', 'rate_average_2dp'];

const columnsOf = async (knex, tableName) => {
  const rows = await knex.raw(`SELECT name FROM pragma_table_info('${tableName}')`);
  return rows.map((row) => row.name);
};

exports.up = async function (knex) {
  const existing = await columnsOf(knex, 't_work');
  if (!existing.length) return;

  const fks = await knex.raw("SELECT count(*) AS n FROM pragma_foreign_key_list('t_work')");
  if (fks[0].n > 0) {
    console.log('[restore-work-circle-fk] t_work already has a foreign key; nothing to do');
    return;
  }

  // Outside the transaction: this pragma does nothing inside one, and the drop
  // below needs enforcement off because other tables point at t_work.
  await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.transaction(async (trx) => {
      await trx.schema.dropTableIfExists('t_work_fk_tmp');
      await trx.schema.createTable('t_work_fk_tmp', defineWork);

      // Only what both tables have. `memo` is deliberately not carried over.
      const wanted = await columnsOf(trx, 't_work_fk_tmp');
      const shared = wanted.filter((name) => existing.includes(name));
      const list = shared.map((name) => `\`${name}\``).join(', ');
      await trx.raw(`INSERT INTO t_work_fk_tmp (${list}) SELECT ${list} FROM t_work`);

      const before = await trx('t_work').count({ n: '*' });
      const after = await trx('t_work_fk_tmp').count({ n: '*' });
      if (before[0].n !== after[0].n) {
        throw new Error(`row count changed: ${before[0].n} -> ${after[0].n}`);
      }

      await trx.schema.dropTable('t_work');
      await trx.schema.renameTable('t_work_fk_tmp', 't_work');
      // Indexes do not survive the rebuild; the name matters, createSchema uses it.
      await trx.schema.alterTable('t_work', (table) => {
        table.index(INDEX_COLUMNS, 't_work_index');
      });

      const violations = await trx.raw('PRAGMA foreign_key_check');
      if (violations.length) {
        throw new Error(`foreign key check failed on ${violations.length} row(s)`);
      }
      console.log(`[restore-work-circle-fk] rebuilt t_work with its t_circle key, ${after[0].n} works, 0 violations`);
    });
  } finally {
    await knex.raw('PRAGMA foreign_keys = ON');
  }
};

exports.down = async function () {
  // Deliberately not reversible. Going back means rebuilding the table again to
  // *remove* a constraint that schema.js declares and a fresh install has -- i.e.
  // recreating the drift this exists to fix. Restore a backup instead.
  throw new Error('20260915000000_restore_work_circle_fk is not reversible; restore a database backup');
};
