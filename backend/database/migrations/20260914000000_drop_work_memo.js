/**
 * Drop `t_work.memo`.
 *
 * It held four keys, and three of them moved to t_work_file in
 * 20260913000000 -- `duration`, `mtime` and `trackTitles` are now columns on the
 * rows they describe. That migration deliberately left memo in place so the new
 * read path could be proven against real data first; this finishes the move.
 *
 * The fourth key, `isContainLyric`, is simply deleted: it was written on every
 * scan and read by nothing (grep confirms no consumer anywhere in the app).
 *
 * Nothing is copied here -- 20260913000000 already did that, and by now every
 * work has been listed either by its seed or by its first read. No filesystem
 * access, and no way to lose a duration: the rows already hold them.
 *
 * SQLite 3.35+ supports ALTER TABLE DROP COLUMN natively, which is used directly
 * rather than through knex's alterTable. Knex emulates the drop by recreating the
 * table, and t_work carries a foreign key to t_circle plus a six-column index --
 * both of which a recreation can quietly fail to restore.
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('t_work', 'memo'))) return;

  // Guard rather than assume: a column that is indexed cannot be dropped this
  // way, and a mistake here means an exception rather than silent damage.
  await knex.raw('ALTER TABLE t_work DROP COLUMN memo');
  console.log('[drop-work-memo] t_work.memo dropped; duration/mtime/track_title live on t_work_file');
};

exports.down = async function (knex) {
  if (await knex.schema.hasColumn('t_work', 'memo')) return;
  // The column comes back empty. Its contents are not recoverable, and do not
  // need to be: t_work_file holds everything that was in it except
  // isContainLyric, which nothing ever read.
  await knex.schema.alterTable('t_work', (table) => {
    table.json('memo');
  });
};
