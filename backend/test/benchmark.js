/* eslint-disable n/no-unpublished-require */
process.env.FREEZE_CONFIG_FILE = '1';

const fs = require('fs');
const path = require('path');
const { makeQueries } = require('../database/queries');
const { config } = require('../config');
const knex = require('knex');
const knexfile = require('../database/knexfile');
const chai = require('chai');
const { nsfwFilter } = require('../database/db');

const expect = chai.expect;

const WARMUP = 5;
const ITERATIONS = parseInt(process.env.BENCH_ITERATIONS || '50', 10);
const PAGE_SIZE = config.pageSize || 12;

const results = [];

const bench = async (label, fn) => {
  for (let i = 0; i < WARMUP; i += 1) {
    await fn();
  }
  const timings = [];
  for (let i = 0; i < ITERATIONS; i += 1) {
    const start = process.hrtime.bigint();
    await fn();
    const end = process.hrtime.bigint();
    timings.push(Number(end - start) / 1e6);
  }
  timings.sort((a, b) => a - b);
  const n = timings.length;
  const min = timings[0];
  const max = timings[n - 1];
  const avg = timings.reduce((a, b) => a + b, 0) / n;
  const medIdx = Math.floor(n / 2);
  const median = n % 2 ? timings[medIdx] : (timings[medIdx - 1] + timings[medIdx]) / 2;
  const p95Idx = Math.min(Math.ceil(0.95 * n) - 1, n - 1);
  const p95 = timings[p95Idx];
  const row = {
    query: label, n,
    minMs: +min.toFixed(3), avgMs: +avg.toFixed(3),
    medianMs: +median.toFixed(3), p95Ms: +p95.toFixed(3), maxMs: +max.toFixed(3),
  };
  results.push(row);
  return row;
};

describe('DB query benchmark', function () {
  // Each case runs WARMUP + ITERATIONS query executions; the slowest paths
  // (e.g. getWorksBy default over a large dev DB) can take ~40ms each, so the
  // default 2s mocha timeout is far too small. Scale the timeout with the
  // iteration count and give plenty of headroom.
  this.timeout(Math.max(30000, (WARMUP + ITERATIONS) * 1000));

  let myKnex = null;
  let Q = null;

  before(async function () {
    const dbPath = process.env.BENCH_DB || path.join(config.databaseFolderDir, 'db.sqlite3');
    if (!fs.existsSync(dbPath)) {
      this.skip(`Dev DB (${dbPath}) not found — skipping benchmark`);
      return;
    }

    if (process.env.BENCH_DB) {
      myKnex = knex({ client: 'sqlite3', useNullAsDefault: true, connection: { filename: process.env.BENCH_DB } });
    } else {
      myKnex = knex(knexfile.development);
    }
    Q = makeQueries(myKnex);

    // Check t_work has data
    const workCount = await myKnex('t_work').count('id as count').first();
    if (!workCount || workCount.count === 0) {
      this.skip('t_work is empty — skipping benchmark');
      return;
    }

    // Sample real IDs from the DB
    this.sample = {};

    const workRow = await myKnex('t_work').select('id').first();
    this.sample.workId = workRow ? workRow.id : null;

    const circleRow = await myKnex('t_work').select('circle_id as id').whereNotNull('circle_id').first();
    this.sample.circleId = circleRow ? circleRow.id : null;

    const tagRow = await myKnex('r_tag_work').select('tag_id as id').first();
    this.sample.tagId = tagRow ? tagRow.id : null;

    const vaRow = await myKnex('r_va_work').select('va_id as id').first();
    this.sample.vaId = vaRow ? vaRow.id : null;

    const illustratorRow = await myKnex('r_illustrator_work').select('illustrator_id as id').first();
    this.sample.illustratorId = illustratorRow ? illustratorRow.id : null;

    const scriptWriterRow = await myKnex('r_script_writer_work').select('script_writer_id as id').first();
    this.sample.scriptWriterId = scriptWriterRow ? scriptWriterRow.id : null;

    const seriesRow = await myKnex('r_series_work').select('series_id as id').first();
    this.sample.seriesId = seriesRow ? seriesRow.id : null;

    // Numeric RJ id for keyword search (strip leading digits from work id)
    if (this.sample.workId) {
      this.sample.numericId = String(this.sample.workId).replace(/\D/g, '');
    }

    // Text keyword from an existing title
    const titleRow = await myKnex('t_work').select('title').whereNotNull('title').first();
    this.sample.keyword = (titleRow && titleRow.title) ? titleRow.title.slice(0, 12) : null;

    // Username with reviews
    const reviewUserRow = await myKnex('t_review').select('user_name').distinct().first();
    this.sample.reviewUser = reviewUserRow ? reviewUserRow.user_name : null;

    // Username with play history
    const historyUserRow = await myKnex('t_play_histroy').select('user_name').distinct().first();
    this.sample.historyUser = historyUserRow ? historyUserRow.user_name : null;

    this.sample.username = 'admin';
  });

  after(async function () {
    if (results.length) {
      console.table(results);
    }
    if (myKnex) {
      // destroy() can abort still-pending pool acquire operations, which tarn
      // reports as a noisy 'Acquire connection error: aborted'. It is a benign
      // teardown artifact (all timed queries have already resolved), so swallow it.
      try {
        await myKnex.destroy();
      } catch (err) {
        console.warn('benchmark knex destroy warning:', err.message);
      }
    }
  });

  it('getWorksBy default (all works)', async function () {
    const row = await bench('getWorksBy default', () => Q.getWorksBy({ username: this.sample.username }));
    expect(row).to.exist;
  });

  it('getWorksBy circle', async function () {
    if (!this.sample.circleId) { this.skip('no circle id'); return; }
    const row = await bench('getWorksBy circle', () => Q.getWorksBy({ id: this.sample.circleId, field: 'circle', username: this.sample.username }));
    expect(row).to.exist;
  });

  it('getWorksBy tag', async function () {
    if (!this.sample.tagId) { this.skip('no tag id'); return; }
    const row = await bench('getWorksBy tag', () => Q.getWorksBy({ id: this.sample.tagId, field: 'tag', username: this.sample.username }));
    expect(row).to.exist;
  });

  it('getWorksBy va', async function () {
    if (!this.sample.vaId) { this.skip('no va id'); return; }
    const row = await bench('getWorksBy va', () => Q.getWorksBy({ id: this.sample.vaId, field: 'va', username: this.sample.username }));
    expect(row).to.exist;
  });

  it('getWorksBy illustrator', async function () {
    if (!this.sample.illustratorId) { this.skip('no illustrator id'); return; }
    const row = await bench('getWorksBy illustrator', () => Q.getWorksBy({ id: this.sample.illustratorId, field: 'illustrator', username: this.sample.username }));
    expect(row).to.exist;
  });

  it('getWorksBy script_writer', async function () {
    if (!this.sample.scriptWriterId) { this.skip('no script_writer id'); return; }
    const row = await bench('getWorksBy script_writer', () => Q.getWorksBy({ id: this.sample.scriptWriterId, field: 'script_writer', username: this.sample.username }));
    expect(row).to.exist;
  });

  it('getWorksBy series', async function () {
    if (!this.sample.seriesId) { this.skip('no series id'); return; }
    const row = await bench('getWorksBy series', () => Q.getWorksBy({ id: this.sample.seriesId, field: 'series', username: this.sample.username }));
    expect(row).to.exist;
  });

  it('realistic /api/works (paged + count)', async function () {
    const query = () => nsfwFilter(0, Q.getWorksBy({ username: this.sample.username }));
    const countRes = await query().count('id as count');
    expect(countRes).to.exist;
    const row = await bench('realistic /api/works', () => query()
      .limit(PAGE_SIZE).offset(48).orderBy('release', 'desc')
      .orderBy([{ column: 'release', order: 'desc' }, { column: 'id', order: 'desc' }]));
    expect(row).to.exist;
  });

  it('getWorksByKeyWord numeric id', async function () {
    if (!this.sample.numericId) { this.skip('no numeric id'); return; }
    const row = await bench('getWorksByKeyWord numeric', () => Q.getWorksByKeyWord({ keyword: `RJ${this.sample.numericId}`, username: this.sample.username }));
    expect(row).to.exist;
  });

  it('getWorksByKeyWord text keyword', async function () {
    if (!this.sample.keyword) { this.skip('no keyword'); return; }
    const row = await bench('getWorksByKeyWord text', () => Q.getWorksByKeyWord({ keyword: this.sample.keyword, username: this.sample.username }));
    expect(row).to.exist;
  });

  it('getWorkMetadata', async function () {
    if (!this.sample.workId) { this.skip('no work id'); return; }
    const row = await bench('getWorkMetadata', () => Q.getWorkMetadata(this.sample.workId, this.sample.username));
    expect(row).to.exist;
  });

  it('getLabels circle', async function () {
    const row = await bench('getLabels circle', () => Q.getLabels('circle'));
    expect(row).to.exist;
  });

  it('getLabels tag', async function () {
    const row = await bench('getLabels tag', () => Q.getLabels('tag'));
    expect(row).to.exist;
  });

  it('getLabels va', async function () {
    const row = await bench('getLabels va', () => Q.getLabels('va'));
    expect(row).to.exist;
  });

  it('getLabels illustrator', async function () {
    const row = await bench('getLabels illustrator', () => Q.getLabels('illustrator'));
    expect(row).to.exist;
  });

  it('getLabels script_writer', async function () {
    const row = await bench('getLabels script_writer', () => Q.getLabels('script_writer'));
    expect(row).to.exist;
  });

  it('getLabels series', async function () {
    const row = await bench('getLabels series', () => Q.getLabels('series'));
    expect(row).to.exist;
  });

  it('getWorksWithReviews (paged)', async function () {
    if (!this.sample.reviewUser) { this.skip('no reviewing user'); return; }
    const row = await bench('getWorksWithReviews', () => Q.getWorksWithReviews({
      username: this.sample.reviewUser, limit: PAGE_SIZE, offset: 0,
      orderBy: 'release', sortOption: 'desc',
    }));
    expect(row).to.exist;
  });

  it('getPlayHistroy (paged)', async function () {
    if (!this.sample.historyUser) { this.skip('no history user'); return; }
    const row = await bench('getPlayHistroy', () => Q.getPlayHistroy({
      username: this.sample.historyUser, limit: PAGE_SIZE, offset: 0, sortOption: 'desc',
    }));
    expect(row).to.exist;
  });
});