//eslint-disable-next-line n/no-unpublished-require
const { expect } = require('chai');
const knexLib = require('knex');
const { makeQueries } = require('../database/queries');

// applyTrackProgressSeconds is internal; exercise it through getPlayHistory,
// which is the path /api/history actually uses.
describe('play history seconds come from t_track_progress', () => {
  let knex, queries;

  before(async () => {
    knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await knex.schema.createTable('t_circle', t => { t.string('id').primary(); t.string('name'); });
    await knex.schema.createTable('t_work', t => {
      t.string('id').primary(); t.string('title'); t.string('circle_id');
      t.boolean('nsfw'); t.string('release'); t.integer('dl_count'); t.integer('price');
      t.integer('review_count'); t.integer('rate_count'); t.float('rate_average_2dp');
      t.string('rate_count_detail'); t.integer('rank');
      t.timestamp('created_at'); t.timestamp('updated_at');
    });
    await knex.schema.createTable('t_play_history', t => {
      t.string('user_name'); t.string('work_id'); t.text('state'); t.timestamp('updated_at');
    });
    await knex.schema.createTable('t_review', t => {
      t.string('user_name'); t.string('work_id'); t.string('progress');
      t.integer('rating'); t.text('review_text'); t.timestamp('updated_at');
    });
    await knex.schema.createTable('t_track_progress', t => {
      t.string('user_name'); t.string('work_id'); t.string('track_key');
      t.float('seconds'); t.boolean('completed'); t.timestamp('updated_at');
    });
    for (const table of ['r_tag_work', 'r_va_work', 'r_illustrator_work', 'r_script_writer_work', 'r_series_work']) {
      await knex.schema.createTable(table, t => { t.string('work_id'); t.string(table.split('_').slice(1, -1).join('_') + '_id'); });
    }
    for (const table of ['t_tag', 't_va', 't_illustrator', 't_script_writer', 't_series']) {
      await knex.schema.createTable(table, t => { t.string('id').primary(); t.string('name'); });
    }

    await knex('t_circle').insert({ id: 'c1', name: 'circle' });
    await knex('t_work').insert([
      { id: '000001', title: 'fresh', circle_id: 'c1' },
      { id: '000002', title: 'legacy', circle_id: 'c1' },
    ]);
    await knex('t_play_history').insert([
      // seconds here is the stale value history last wrote
      { user_name: 'admin', work_id: '000001', state: JSON.stringify({ queue: [{ contentHash: 'aaa' }], index: 0, seconds: 12 }) },
      // no contentHash on the queue item -> nothing to look up, keep stored value
      { user_name: 'admin', work_id: '000002', state: JSON.stringify({ queue: [{ trackId: '000002/0' }], index: 0, seconds: 34 }) },
    ]);
    await knex('t_track_progress').insert({ user_name: 'admin', work_id: '000001', track_key: 'aaa', seconds: 999, completed: 0 });

    queries = makeQueries(knex);
  });

  after(async () => { await knex.destroy(); });

  it('overwrites the stale history seconds with the track-progress value', async () => {
    const { works } = await queries.getPlayHistory({ username: 'admin', excludeFinished: 'all' });
    const fresh = works.find(w => w.id === '000001');
    expect(JSON.parse(fresh.state).seconds).to.equal(999);
  });

  it('keeps the stored seconds when the queue item has no contentHash', async () => {
    const { works } = await queries.getPlayHistory({ username: 'admin', excludeFinished: 'all' });
    const legacy = works.find(w => w.id === '000002');
    expect(JSON.parse(legacy.state).seconds).to.equal(34);
  });
});
