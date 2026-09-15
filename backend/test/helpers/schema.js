/*
 * Fixture schema for the t_work_file listing.
 *
 * Several tests hand-roll a minimal schema rather than running migrations, and
 * anything reaching listWorkTracks now needs this table. With files_indexed_at
 * left NULL the first read indexes the work from disk and persists it -- exactly
 * what production does on a work migrated before the table existed -- so a
 * fixture that lays down real files needs nothing else.
 *
 * No foreign key: fixtures create t_work with whatever columns they need, and
 * SQLite only enforces FKs with the pragma on anyway.
 */
async function addWorkFileSchema (knex) {
  if (await knex.schema.hasTable('t_work')) {
    if (!(await knex.schema.hasColumn('t_work', 'files_indexed_at'))) {
      await knex.schema.alterTable('t_work', (t) => { t.datetime('files_indexed_at'); });
    }
    // The first index of a work reads memo to carry durations and track titles
    // onto the rows rather than writing NULLs over them, so a fixture needs the
    // column even when the test does not populate it. Goes away when memo does.
    if (!(await knex.schema.hasColumn('t_work', 'memo'))) {
      await knex.schema.alterTable('t_work', (t) => { t.text('memo'); });
    }
  }
  if (!(await knex.schema.hasTable('t_work_file'))) {
    await knex.schema.createTable('t_work_file', (t) => {
      t.string('work_id').notNullable();
      t.string('rel_path').notNullable();
      t.float('duration');
      t.integer('mtime');
      t.string('track_title');
      t.primary(['work_id', 'rel_path']);
    });
  }
}

module.exports = { addWorkFileSchema };
