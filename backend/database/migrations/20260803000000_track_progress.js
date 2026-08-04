exports.up = async function(knex) {
  const exists = await knex.schema.hasTable('t_track_progress');
  if (!exists) {
    await knex.schema.createTable('t_track_progress', (table) => {
      table.string('user_name').notNullable();
      table.string('work_id').notNullable();
      table.string('track_key').notNullable(); // SHA-256 hex
      table.float('seconds').notNullable().defaultTo(0);
      table.boolean('completed').notNullable().defaultTo(false);
      table.timestamps(true, true);

      table.foreign('user_name').references('name').inTable('t_user').onDelete('CASCADE');
      table.foreign('work_id').references('id').inTable('t_work').onDelete('CASCADE');
      table.primary(['user_name', 'work_id', 'track_key']);
    });
  }
};

exports.down = async function(knex) {
  await knex.schema.dropTableIfExists('t_track_progress');
};