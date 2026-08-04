exports.up = async function(knex) {
  // Idempotent: only rename if the old table still exists (fresh DBs already
  // have t_play_history via createSchema, so this is a no-op for them).
  const exists = await knex.schema.hasTable('t_play_histroy');
  if (exists) {
    await knex.raw('ALTER TABLE t_play_histroy RENAME TO t_play_history;');
  }
};

exports.down = async function(knex) {
  const exists = await knex.schema.hasTable('t_play_history');
  if (exists) {
    await knex.raw('ALTER TABLE t_play_history RENAME TO t_play_histroy;');
  }
};