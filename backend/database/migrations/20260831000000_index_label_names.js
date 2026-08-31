// Every label link is now a filter term matched by name (see search-query.js),
// so `t_tag.name` and friends are read on ordinary navigation rather than only
// when someone types a search. None of them was indexed — each term meant a
// scan of the label table.
const LABEL_TABLES = [
  't_circle', 't_tag', 't_va', 't_illustrator', 't_script_writer', 't_series', 't_author',
];

const indexName = (table) => `${table}_name_index`;

// createSchema() declares these indexes too, so a database built from it and
// then stamped by skipMigrations() already has them.
const hasIndex = async (knex, name) => {
  const row = await knex('sqlite_master').select('name').where({ type: 'index', name }).first();
  return Boolean(row);
};

exports.up = async function (knex) {
  for (const table of LABEL_TABLES) {
    if (!await knex.schema.hasTable(table)) continue;
    if (await hasIndex(knex, indexName(table))) continue;
    await knex.schema.alterTable(table, (t) => t.index(['name'], indexName(table)));
  }
};

exports.down = async function (knex) {
  for (const table of LABEL_TABLES) {
    if (!await knex.schema.hasTable(table)) continue;
    if (!await hasIndex(knex, indexName(table))) continue;
    await knex.schema.alterTable(table, (t) => t.dropIndex(['name'], indexName(table)));
  }
};
