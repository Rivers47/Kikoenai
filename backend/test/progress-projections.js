/* eslint-disable n/no-unpublished-require */
// getTrackProgress and applyTrackProgressSeconds are two shapes over one query
// (trackProgressFor). They drifted once already -- the first selected updated_at
// and the second did not, so the work page's file tree and its info panel
// disagreed about the same position. These assert they cannot disagree again.

process.env.FREEZE_CONFIG_FILE = '1';

const { expect } = require('chai');
const knexLib = require('knex');
const { makeQueries } = require('../database/queries');

describe('the two track-progress projections agree', () => {
  let knex, queries;

  beforeEach(async () => {
    knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await knex.schema.createTable('t_track_progress', (t) => {
      t.string('user_name'); t.string('work_id'); t.string('track_key');
      t.float('seconds'); t.boolean('completed');
      t.timestamps(true, true);
      t.primary(['user_name', 'work_id', 'track_key']);
    });
    queries = makeQueries(knex);
    await queries.upsertTrackProgress('admin', '000001', 'SE/01 intro.mp3', 123.5,
      true, Date.parse('2026-09-13T06:00:00Z'));
  });

  afterEach(async () => { await knex.destroy(); });

  const historyRow = () => ({
    work_id: '000001',
    state: JSON.stringify({ queue: [{ trackId: '000001/SE/01 intro.mp3' }], index: 0 }),
  });

  it('report the same seconds for the same track', async () => {
    const map = await queries.getTrackProgress('admin', '000001');
    const rows = [historyRow()];
    await queries.applyTrackProgressSeconds('admin', rows);

    const fromMap = map['000001/SE/01 intro.mp3'];
    const fromJoin = JSON.parse(rows[0].state);
    expect(fromMap.seconds).to.equal(123.5);
    expect(fromJoin.seconds).to.equal(fromMap.seconds);
  });

  // The asymmetry that existed: the map carried observedAt, the join did not.
  it('report the same observedAt for the same track', async () => {
    const map = await queries.getTrackProgress('admin', '000001');
    const rows = [historyRow()];
    await queries.applyTrackProgressSeconds('admin', rows);

    const fromJoin = JSON.parse(rows[0].state);
    expect(map['000001/SE/01 intro.mp3'].observedAt).to.equal('2026-09-13 06:00:00');
    expect(fromJoin.secondsObservedAt).to.equal(map['000001/SE/01 intro.mp3'].observedAt);
  });

  it('both key on the relPath, not on a positional handle', async () => {
    const map = await queries.getTrackProgress('admin', '000001');
    expect(Object.keys(map)).to.deep.equal(['000001/SE/01 intro.mp3']);
  });

  it('leave a history row alone when the track has no progress row', async () => {
    const rows = [{
      work_id: '000002',
      state: JSON.stringify({ queue: [{ trackId: '000002/nope.mp3' }], index: 0, seconds: 7 }),
    }];
    await queries.applyTrackProgressSeconds('admin', rows);
    const state = JSON.parse(rows[0].state);
    expect(state.seconds).to.equal(7);
    expect(state).to.not.have.property('secondsObservedAt');
  });

  it('do not leak one work\'s position into another with the same relPath', async () => {
    await queries.upsertTrackProgress('admin', '000002', 'SE/01 intro.mp3', 999,
      false, Date.parse('2026-09-13T07:00:00Z'));

    const first = await queries.getTrackProgress('admin', '000001');
    const second = await queries.getTrackProgress('admin', '000002');
    expect(first['000001/SE/01 intro.mp3'].seconds).to.equal(123.5);
    expect(second['000002/SE/01 intro.mp3'].seconds).to.equal(999);
  });
});
