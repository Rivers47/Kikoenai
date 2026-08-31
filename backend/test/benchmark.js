/* eslint-disable n/no-unpublished-require */
process.env.FREEZE_CONFIG_FILE = '1';

const fs = require('fs');
const path = require('path');
const { makeQueries } = require('../database/queries');
const { formatSearchTerm } = require('../database/search-query');
const { config } = require('../config');
const knex = require('knex');
const knexfile = require('../database/knexfile');
const chai = require('chai');

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
  // Each case runs WARMUP + ITERATIONS query executions; scale timeout with
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

    // Label filters resolve by name, so that is what the benchmarks need.
    const labelName = async (relTable, key, nameTable) => {
      const rel = await myKnex(relTable).select(`${key} as id`).first();
      if (!rel) return null;
      const row = await myKnex(nameTable).select('name').where('id', rel.id).first();
      return row ? row.name : null;
    };

    const circleRow = await myKnex('t_work')
      .join('t_circle', 't_circle.id', 't_work.circle_id')
      .select('t_circle.name').whereNotNull('circle_id').first();
    this.sample.circleName = circleRow ? circleRow.name : null;

    this.sample.tagName = await labelName('r_tag_work', 'tag_id', 't_tag');
    this.sample.vaName = await labelName('r_va_work', 'va_id', 't_va');
    this.sample.illustratorName = await labelName('r_illustrator_work', 'illustrator_id', 't_illustrator');
    this.sample.scriptWriterName = await labelName('r_script_writer_work', 'script_writer_id', 't_script_writer');
    this.sample.seriesName = await labelName('r_series_work', 'series_id', 't_series');

    // Numeric RJ id for keyword search
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
    const historyUserRow = await myKnex('t_play_history').select('user_name').distinct().first();
    this.sample.historyUser = historyUserRow ? historyUserRow.user_name : null;

    this.sample.username = 'admin';
  });

  after(async function () {
    if (results.length) {
      console.table(results);
    }
    if (myKnex) {
      try {
        await myKnex.destroy();
      } catch (err) {
        console.warn('benchmark knex destroy warning:', err.message);
      }
    }
  });

  it('getWorksBy default (all works)', async function () {
    // Omit limit/offset to get all works
    const row = await bench('getWorksBy default', () => Q.getWorksBy({ username: this.sample.username }));
    expect(row).to.exist;
  });

  it('label filter circle', async function () {
    if (!this.sample.circleName) { this.skip('no circle name'); return; }
    const keyword = formatSearchTerm({ field: 'circle', value: this.sample.circleName, exact: true });
    const row = await bench('filter circle', () => Q.getWorksByFilter({ filter: keyword, username: this.sample.username }));
    expect(row).to.exist;
  });

  it('label filter tag', async function () {
    if (!this.sample.tagName) { this.skip('no tag name'); return; }
    const keyword = formatSearchTerm({ field: 'tag', value: this.sample.tagName, exact: true });
    const row = await bench('filter tag', () => Q.getWorksByFilter({ filter: keyword, username: this.sample.username }));
    expect(row).to.exist;
  });

  it('label filter va', async function () {
    if (!this.sample.vaName) { this.skip('no va name'); return; }
    const keyword = formatSearchTerm({ field: 'va', value: this.sample.vaName, exact: true });
    const row = await bench('filter va', () => Q.getWorksByFilter({ filter: keyword, username: this.sample.username }));
    expect(row).to.exist;
  });

  it('label filter illustrator', async function () {
    if (!this.sample.illustratorName) { this.skip('no illustrator name'); return; }
    const keyword = formatSearchTerm({ field: 'illustrator', value: this.sample.illustratorName, exact: true });
    const row = await bench('filter illustrator', () => Q.getWorksByFilter({ filter: keyword, username: this.sample.username }));
    expect(row).to.exist;
  });

  it('label filter script_writer', async function () {
    if (!this.sample.scriptWriterName) { this.skip('no script_writer name'); return; }
    const keyword = formatSearchTerm({ field: 'script_writer', value: this.sample.scriptWriterName, exact: true });
    const row = await bench('filter script_writer', () => Q.getWorksByFilter({ filter: keyword, username: this.sample.username }));
    expect(row).to.exist;
  });

  it('label filter series', async function () {
    if (!this.sample.seriesName) { this.skip('no series name'); return; }
    const keyword = formatSearchTerm({ field: 'series', value: this.sample.seriesName, exact: true });
    const row = await bench('filter series', () => Q.getWorksByFilter({ filter: keyword, username: this.sample.username }));
    expect(row).to.exist;
  });

  it('realistic /api/works (paged + count)', async function () {
    const row = await bench('realistic /api/works', () => Q.getWorksBy({
      username: this.sample.username, nsfw: 0,
      order: 'release', sort: 'desc',
      limit: PAGE_SIZE, offset: 48,
    }));
    expect(row).to.exist;
  });

  it('getWorksByFilter numeric id', async function () {
    if (!this.sample.numericId) { this.skip('no numeric id'); return; }
    const row = await bench('getWorksByFilter numeric', () => Q.getWorksByFilter({ filter: `RJ${this.sample.numericId}`, username: this.sample.username }));
    expect(row).to.exist;
  });

  it('getWorksByFilter text keyword', async function () {
    if (!this.sample.keyword) { this.skip('no keyword'); return; }
    const row = await bench('getWorksByFilter text', () => Q.getWorksByFilter({ filter: this.sample.keyword, username: this.sample.username }));
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

  it('getPlayHistory (paged)', async function () {
    if (!this.sample.historyUser) { this.skip('no history user'); return; }
    const row = await bench('getPlayHistory', () => Q.getPlayHistory({
      username: this.sample.historyUser, limit: PAGE_SIZE, offset: 0, sortOption: 'desc',
    }));
    expect(row).to.exist;
  });
});