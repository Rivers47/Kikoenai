//index the name columns to speed up search queries
const LABEL_TABLES = [
  't_circle', 't_tag', 't_va', 't_illustrator', 't_script_writer', 't_series', 't_author',
];

const indexName = (table) => `${table}_name_index`;

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
