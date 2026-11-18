/* eslint-disable n/no-unpublished-require */
// Migration 20260916000000: t_work.circle_id becomes nullable, and nothing else
// about the table moves.
//
// Runs on a database of its own: this fixture's schema is deliberately older
// than the shared test schema, and the migration only needs a knex handle.
process.env.FREEZE_CONFIG_FILE = '1';
process.env.NODE_ENV = 'test';

const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const makeKnex = require('knex');

const migration = require('../database/migrations/20260916000000_nullable_circle_id');

describe('migration 20260916000000 (nullable circle_id)', function () {
  this.timeout(20000);

  let knex;
  let dir;
  const circleId = 'aaaaaaaa-1111-4111-8111-111111111111';

  before('Build a pre-migration t_work', async function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-migration-'));
    knex = makeKnex({
      client: 'sqlite3',
      useNullAsDefault: true,
      connection: { filename: path.join(dir, 'db.sqlite3') },
      pool: {
        afterCreate: (conn, done) => conn.run('PRAGMA foreign_keys = ON;', done),
      },
    });

    await knex.schema.createTable('t_circle', (table) => {
      table.string('id').notNullable();
      table.string('name').notNullable();
      table.primary('id');
    });

    await knex.schema.createTable('t_work', (table) => {
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
    });
    await knex.schema.alterTable('t_work', (table) => {
      table.index(['circle_id', 'release', 'dl_count', 'review_count', 'price', 'rate_average_2dp'], 't_work_index');
    });

    // A dependent table, to prove the rebuild leaves other tables' keys intact.
    await knex.schema.createTable('r_tag_work', (table) => {
      table.string('tag_id');
      table.string('work_id');
      table.foreign('work_id').references('id').inTable('t_work').onDelete('CASCADE');
    });

    await knex('t_circle').insert({ id: circleId, name: '社团' });
    await knex('t_work').insert([
      { id: '123456', root_folder: 'lib', dir: 'a', title: 'A', circle_id: circleId, description: '<p>a</p>' },
      { id: '654321', root_folder: 'lib', dir: 'b', title: 'B', circle_id: circleId, files_indexed_at: '2026-01-01 00:00:00' },
    ]);
    await knex('r_tag_work').insert({ tag_id: 'tag', work_id: '123456' });
  });

  after('Close and remove the database', async function () {
    await knex.destroy();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps every row and its values', async () => {
    await migration.up(knex);

    const rows = await knex('t_work').orderBy('id');
    expect(rows.map(row => row.id)).to.deep.equal(['123456', '654321']);
    expect(rows[0].title).to.equal('A');
    expect(rows[0].description).to.equal('<p>a</p>');
    expect(rows[1].files_indexed_at).to.equal('2026-01-01 00:00:00');
  });

  it('makes circle_id nullable and keeps the foreign key', async () => {
    const columns = await knex.raw("SELECT name, \"notnull\" FROM pragma_table_info('t_work')");
    const circle = columns.find(column => column.name === 'circle_id');
    expect(circle.notnull).to.equal(0);

    const keys = await knex.raw("SELECT * FROM pragma_foreign_key_list('t_work')");
    expect(keys.map(key => key.from)).to.include('circle_id');
  });

  it('recreates the index', async () => {
    const indexes = (await knex.raw("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 't_work'"))
      .map(index => index.name);
    expect(indexes).to.include('t_work_index');
  });

  it('accepts a work with no circle', async () => {
    await knex('t_work').insert({
      id: '999999', root_folder: 'lib', dir: 'c', title: 'C', circle_id: null,
    });

    const row = await knex('t_work').where('id', '999999').first();
    expect(row.circle_id).to.equal(null);
  });

  it('leaves dependent rows alone', async () => {
    const relations = await knex('r_tag_work');
    expect(relations).to.have.length(1);
    expect(relations[0].work_id).to.equal('123456');
  });

  it('is a no-op when run against an already-migrated table', async () => {
    await migration.up(knex);

    const columns = await knex.raw("SELECT name, \"notnull\" FROM pragma_table_info('t_work')");
    const circle = columns.find(column => column.name === 'circle_id');
    expect(circle.notnull).to.equal(0);
    expect(await knex('t_work').count({ n: '*' })).to.deep.equal([{ n: 3 }]);
  });
});
