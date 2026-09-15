/**
 * Drop `t_work.memo`, which has moved to t_work_file
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
