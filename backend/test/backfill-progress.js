// Requiring the backfill script pulls in config + database/db; freeze the
// config file so the test run never writes one, as edit-metadata.js does.
process.env.FREEZE_CONFIG_FILE = true;

//eslint-disable-next-line n/no-unpublished-require
const { expect } = require('chai');
const knexLib = require('knex');
const { makeQueries } = require('../database/queries');
const { runBackfill } = require('../scripts/backfill-progress');

// History rows written since the play-history / track-progress split carry no
// state.seconds at all — the position lives in t_track_progress. The backfill
// used to require state.seconds and skipped those rows entirely.
describe('backfill reads the position from t_track_progress', () => {
  let knex, dbApi;

  const track = (contentHash, title, duration) => ({ trackId: 'x', contentHash, title, duration });

  beforeEach(async () => {
    knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await knex.schema.createTable('t_work', t => {
      t.string('id').primary(); t.string('root_folder'); t.string('dir');
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
      t.unique(['user_name', 'work_id', 'track_key']);
    });
    await knex('t_work').insert([
      { id: '000001', root_folder: 'root', dir: 'w1' },
      { id: '000002', root_folder: 'root', dir: 'w2' },
    ]);
    dbApi = { knex, ...makeQueries(knex) };
  });

  afterEach(async () => { await knex.destroy(); });

  const run = (dryRun = false) => runBackfill({ dryRun, log: () => {}, dbApi });

  it('marks listened from the progress row of a seconds-less history row', async () => {
    await knex('t_play_history').insert({
      user_name: 'admin', work_id: '000001',
      state: JSON.stringify({ queue: [track('aaaaaaaa', '01.mp3', 600)], index: 0 }),
    });
    await knex('t_track_progress').insert({
      user_name: 'admin', work_id: '000001', track_key: 'aaaaaaaa', seconds: 590, completed: 1,
    });

    const summary = await run();
    expect(summary.marked).to.equal(1);
    const review = await knex('t_review').where({ user_name: 'admin', work_id: '000001' }).first();
    expect(review.progress).to.equal('listened');
  });

  it('leaves a part-played work alone', async () => {
    await knex('t_play_history').insert({
      user_name: 'admin', work_id: '000001',
      state: JSON.stringify({ queue: [track('aaaaaaaa', '01.mp3', 600)], index: 0 }),
    });
    await knex('t_track_progress').insert({
      user_name: 'admin', work_id: '000001', track_key: 'aaaaaaaa', seconds: 120, completed: 0,
    });

    const summary = await run();
    expect(summary.marked).to.equal(0);
    expect(await knex('t_review').first()).to.equal(undefined);
  });

  it('still marks listened from a legacy row that carries its own seconds', async () => {
    await knex('t_play_history').insert({
      user_name: 'admin', work_id: '000002',
      state: JSON.stringify({ queue: [track('bbbbbbbb', '01.mp3', 600)], index: 0, seconds: 599 }),
    });

    const summary = await run();
    expect(summary.marked).to.equal(1);
    // ...and seeds the progress row the read path looks up, keyed by the
    // queue item's own contentHash — no file read needed.
    const progress = await knex('t_track_progress').where({ work_id: '000002' }).first();
    expect(progress.track_key).to.equal('bbbbbbbb');
    expect(progress.seconds).to.equal(599);
    expect(progress.completed).to.equal(1);
  });

  it('does not seed when there is no position to seed from', async () => {
    await knex('t_play_history').insert({
      user_name: 'admin', work_id: '000001',
      state: JSON.stringify({ queue: [track('aaaaaaaa', '01.mp3', 600)], index: 0 }),
    });

    const summary = await run();
    expect(summary.p2SkippedNoSeconds).to.equal(1);
    expect(summary.p2Seeded).to.equal(0);
    expect(await knex('t_track_progress').first()).to.equal(undefined);
  });

  it('writes nothing on a dry run', async () => {
    await knex('t_play_history').insert({
      user_name: 'admin', work_id: '000002',
      state: JSON.stringify({ queue: [track('bbbbbbbb', '01.mp3', 600)], index: 0, seconds: 599 }),
    });

    const summary = await run(true);
    expect(summary.marked).to.equal(1);
    expect(summary.p2Seeded).to.equal(1);
    expect(await knex('t_review').first()).to.equal(undefined);
    expect(await knex('t_track_progress').first()).to.equal(undefined);
  });
});
