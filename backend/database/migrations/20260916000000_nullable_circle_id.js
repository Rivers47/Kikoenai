/**
 * Make `t_work.circle_id` nullable.
 *
 * A custom work (a folder declared by `kikoenai.nfo`) has no circle, and a
 * placeholder label would put junk in the circles list. SQLite cannot drop
 * NOT NULL in place, so this rebuilds the table the same way
 * 20260915000000_restore_work_circle_fk.js does.
 */

const defineWork = (table) => {
  table.string('id').notNullable();
  table.timestamps(true, true);
  table.string('root_folder').notNullable();
  table.string('dir').notNullable();
  table.string('title').notNullable();
  table.string('circle_id'); // nullable: custom works have no circle
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
  const rows = await knex.raw(`SELECT name, "notnull" FROM pragma_table_info('${tableName}')`);
  return rows;
};

exports.up = async function (knex) {
  const existing = await columnsOf(knex, 't_work');
  if (!existing.length) return;

  const circle = existing.find((column) => column.name === 'circle_id');
  if (circle && !circle.notnull) {
    console.log('[nullable-circle-id] t_work.circle_id is already nullable; nothing to do');
    return;
  }

  const names = existing.map((column) => column.name);

  // Outside the transaction: the pragma does nothing inside one, and the drop
  // below needs enforcement off because other tables point at t_work.
  await knex.raw('PRAGMA foreign_keys = OFF');
  try {
    await knex.transaction(async (trx) => {
      await trx.schema.dropTableIfExists('t_work_circle_tmp');
      await trx.schema.createTable('t_work_circle_tmp', defineWork);

      // Only what both tables have, so an older database missing a column still
      // migrates instead of failing on a select of something that is not there.
      const wanted = (await columnsOf(trx, 't_work_circle_tmp')).map((column) => column.name);
      const shared = wanted.filter((name) => names.includes(name));
      const list = shared.map((name) => `\`${name}\``).join(', ');
      await trx.raw(`INSERT INTO t_work_circle_tmp (${list}) SELECT ${list} FROM t_work`);

      const before = await trx('t_work').count({ n: '*' });
      const after = await trx('t_work_circle_tmp').count({ n: '*' });
      if (before[0].n !== after[0].n) {
        throw new Error(`row count changed: ${before[0].n} -> ${after[0].n}`);
      }

      await trx.schema.dropTable('t_work');
      await trx.schema.renameTable('t_work_circle_tmp', 't_work');
      // Indexes do not survive the rebuild; the name matters, createSchema uses it.
      await trx.schema.alterTable('t_work', (table) => {
        table.index(INDEX_COLUMNS, 't_work_index');
      });

      const violations = await trx.raw('PRAGMA foreign_key_check');
      if (violations.length) {
        throw new Error(`foreign key check failed on ${violations.length} row(s)`);
      }
      console.log(`[nullable-circle-id] rebuilt t_work with a nullable circle_id, ${after[0].n} works`);
    });
  } finally {
    await knex.raw('PRAGMA foreign_keys = ON');
  }
};

exports.down = async function () {
  // Not reversible without deciding what to do with custom works that have no
  // circle; restore a database backup instead.
  throw new Error('20260916000000_nullable_circle_id is not reversible; restore a database backup');
};
