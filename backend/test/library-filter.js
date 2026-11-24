/* eslint-disable n/no-unpublished-require */
// The main library list's multiselect filter (age rating + progress) and its
// "last played" ordering. Both are LEFT JOINs on the caller's own rows, so the
// cases that matter are the ones with no row at all.

process.env.FREEZE_CONFIG_FILE = '1';

const { expect } = require('chai');
const { existsSync, unlinkSync } = require('fs');
const { join } = require('path');
const { makeQueries } = require('../database/queries');
const { nameToUUID } = require('../scraper/utils');

const TEST_DB = join(__dirname, 'db-library-filter-test.sqlite3');

// `played` is the t_play_history row's updated_at; `null` means never played.
// `progress === undefined` means no t_review row; null means a rating-only row.
const LIBRARY = [
  { id: '100001', nsfw: false, rating: 5, progress: 'marked', played: '2024-01-01 10:00:00' },
  { id: '100002', nsfw: true, rating: 3, progress: 'listened', played: '2024-03-01 10:00:00' },
  { id: '100003', nsfw: true, rating: null, progress: undefined, played: null },
  { id: '100004', nsfw: false, rating: 4, progress: null, played: '2024-02-01 10:00:00' },
  // An all-NULL row: t_review holds it, but nothing was written on it.
  { id: '100005', nsfw: false, rating: null, progress: null, played: null, emptyRow: true },
];

describe('library list filter and played ordering', function () {
  this.timeout(10000);

  let knex;
  let Q;

  const ids = async (opts) => {
    const { works, totalCount } = await Q.getWorksBy({ username: 'admin', ...opts });
    const got = works.map(w => w.id);
    expect(totalCount[0].count, 'totalCount agrees with the page').to.equal(got.length);
    return got;
  };

  before('Build a small in-file library', async function () {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    knex = require('knex')({
      client: 'sqlite3',
      useNullAsDefault: true,
      connection: { filename: TEST_DB },
    });
    Q = makeQueries(knex);

    await knex.schema.createTable('t_circle', (t) => {
      t.string('id').notNullable();
      t.string('name').notNullable();
    });
    for (const table of ['t_tag', 't_va', 't_illustrator', 't_script_writer', 't_series']) {
      await knex.schema.createTable(table, (t) => {
        t.string('id').notNullable();
        t.string('name').notNullable();
      });
    }
    await knex.schema.createTable('t_work', (t) => {
      t.string('id').notNullable();
      t.string('title').notNullable();
      t.string('circle_id').notNullable();
      t.boolean('nsfw');
      t.string('release');
      t.integer('dl_count');
      t.integer('price');
      t.integer('review_count');
      t.integer('rate_count');
      t.float('rate_average_2dp');
      t.text('rate_count_detail');
      t.text('rank');
      t.timestamp('created_at');
      t.timestamp('updated_at');
      t.primary(['id']);
    });
    for (const [rel, key] of Object.entries({
      r_tag_work: 'tag_id', r_va_work: 'va_id', r_illustrator_work: 'illustrator_id',
      r_script_writer_work: 'script_writer_id', r_series_work: 'series_id',
    })) {
      await knex.schema.createTable(rel, (t) => {
        t.string(key);
        t.string('work_id');
      });
    }
    await knex.schema.createTable('t_review', (t) => {
      t.string('user_name');
      t.string('work_id');
      t.integer('rating');
      t.string('review_text');
      t.string('progress');
      t.primary(['user_name', 'work_id']);
    });
    await knex.schema.createTable('t_play_history', (t) => {
      t.string('user_name');
      t.string('work_id');
      t.string('state');
      t.timestamps(true, true);
      t.primary(['user_name', 'work_id']);
    });

    await knex('t_circle').insert({ id: nameToUUID('Circle'), name: 'Circle' });
    for (const w of LIBRARY) {
      await knex('t_work').insert({
        id: w.id, title: w.id, circle_id: nameToUUID('Circle'), nsfw: w.nsfw, release: '2024-01-01',
      });
      if (w.emptyRow) {
        await knex('t_review').insert({ user_name: 'admin', work_id: w.id });
      } else if (w.progress !== undefined) {
        await knex('t_review').insert({
          user_name: 'admin', work_id: w.id, rating: w.rating, progress: w.progress,
        });
      }
      if (w.played) {
        await knex('t_play_history').insert({
          user_name: 'admin', work_id: w.id, state: '{}', updated_at: w.played,
        });
      }
    }
  });

  after('Drop the test library', async function () {
    if (knex) await knex.destroy();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  describe('age rating', function () {
    it('keeps only all-ages works', async function () {
      expect(await ids({ rating: ['sfw'], order: 'release', sort: 'asc' }).then(r => r.sort()))
        .to.deep.equal(['100001', '100004', '100005']);
    });

    it('keeps only adult works', async function () {
      expect(await ids({ rating: ['nsfw'], order: 'release', sort: 'asc' }).then(r => r.sort()))
        .to.deep.equal(['100002', '100003']);
    });

    it('applies no restriction when both are ticked', async function () {
      expect(await ids({ rating: ['sfw', 'nsfw'], order: 'release', sort: 'asc' }))
        .to.have.lengthOf(5);
    });
  });

  describe('progress', function () {
    it('keeps one state', async function () {
      expect(await ids({ progress: ['marked'] })).to.deep.equal(['100001']);
    });

    it('keeps several states', async function () {
      expect(await ids({ progress: ['marked', 'listened'] }).then(r => r.sort()))
        .to.deep.equal(['100001', '100002']);
    });

    // A rating-only row, an all-NULL row and a missing row all mean "not marked".
    it('counts a rating-only row, an all-NULL row and no row as unmarked', async function () {
      expect(await ids({ progress: ['unmarked'] }).then(r => r.sort()))
        .to.deep.equal(['100003', '100004', '100005']);
    });

    it('excludes unmarked works from a strict subset of states', async function () {
      const got = await ids({ progress: ['marked', 'listened', 'postponed'] });
      expect(got.sort()).to.deep.equal(['100001', '100002']);
    });

    it('combines with the rating filter', async function () {
      expect(await ids({ rating: ['sfw'], progress: ['marked'] })).to.deep.equal(['100001']);
    });
  });

  describe('getPlayHistory', function () {
    it('keeps only the ticked age rating', async function () {
      const sfw = await Q.getPlayHistory({ username: 'admin', rating: ['sfw'], excludeFinished: 'all' });
      expect(sfw.works.map(w => w.id).sort()).to.deep.equal(['100001', '100004']);
      expect(sfw.totalCount[0].count).to.equal(2);

      const nsfw = await Q.getPlayHistory({ username: 'admin', rating: ['nsfw'], excludeFinished: 'all' });
      expect(nsfw.works.map(w => w.id)).to.deep.equal(['100002']);
    });

    it('lists the whole history when no rating is given', async function () {
      const { works } = await Q.getPlayHistory({ username: 'admin', excludeFinished: 'all' });
      expect(works.map(w => w.id).sort()).to.deep.equal(['100001', '100002', '100004']);
    });
  });

  describe('star-or-comment filter', function () {
    // 100003 has no t_review row; 100004 has a rating-only row (progress NULL).
    it('has: keeps the works with a star or a review text', async function () {
      expect(await ids({ review: ['has'], order: 'release', sort: 'asc' }).then(r => r.sort()))
        .to.deep.equal(['100001', '100002', '100004']);
    });

    it('none: keeps the works with neither, all-NULL row included', async function () {
      expect(await ids({ review: ['none'] }).then(r => r.sort()))
        .to.deep.equal(['100003', '100005']);
    });

    it('both: no restriction', async function () {
      expect(await ids({ review: ['has', 'none'] })).to.have.lengthOf(5);
    });

    it('combines with the progress filter, which is a different question', async function () {
      // "starred/commented" AND "no progress" isolates the rating-only row.
      expect(await ids({ review: ['has'], progress: ['unmarked'] })).to.deep.equal(['100004']);
    });
  });

  describe('order by played', function () {
    it('puts the most recent playback first in desc', async function () {
      expect(await ids({ order: 'played', sort: 'desc' }))
        .to.deep.equal(['100002', '100004', '100001', '100005', '100003']);
    });

    it('puts never-played works first in asc', async function () {
      expect(await ids({ order: 'played', sort: 'asc' }))
        .to.deep.equal(['100005', '100003', '100001', '100004', '100002']);
    });

    it('still reports the user rating on each work', async function () {
      const { works } = await Q.getWorksBy({ username: 'admin', order: 'played', sort: 'desc' });
      expect(works.map(w => [w.id, w.userRating]))
        .to.deep.equal([['100002', 3], ['100004', 4], ['100001', 5], ['100005', null], ['100003', null]]);
    });
  });

  describe('getWorksByFilter (search results)', function () {
    it('accepts the same filters and played ordering', async function () {
      const { works } = await Q.getWorksByFilter({
        filter: '', username: 'admin', rating: ['nsfw'], progress: ['listened'], order: 'played', sort: 'desc',
      });
      expect(works.map(w => w.id)).to.deep.equal(['100002']);
    });

    it('excludes unmarked works when a state subset is ticked', async function () {
      const { works } = await Q.getWorksByFilter({
        filter: '', username: 'admin', progress: ['marked'], order: 'release', sort: 'asc',
      });
      expect(works.map(w => w.id)).to.deep.equal(['100001']);
    });
  });
});

describe('star-or-comment filter - the text field, and status independence', function () {
  this.timeout(10000);

  const knexLib = require('knex');
  const { join } = require('path');
  const { existsSync, unlinkSync } = require('fs');
  const { nameToUUID } = require('../scraper/utils');

  const TEXT_DB = join(__dirname, 'db-library-filter-text.sqlite3');
  let knex, Q;

  before('A library whose only user state is a review text', async function () {
    if (existsSync(TEXT_DB)) unlinkSync(TEXT_DB);
    knex = knexLib({ client: 'sqlite3', useNullAsDefault: true, connection: { filename: TEXT_DB } });
    Q = makeQueries(knex);

    await knex.schema.createTable('t_circle', t => { t.string('id'); t.string('name'); });
    for (const table of ['t_tag', 't_va', 't_illustrator', 't_script_writer', 't_series']) {
      await knex.schema.createTable(table, t => { t.string('id'); t.string('name'); });
    }
    await knex.schema.createTable('t_work', t => {
      t.string('id'); t.string('title'); t.string('circle_id'); t.boolean('nsfw'); t.string('release');
      t.integer('dl_count'); t.integer('price'); t.integer('review_count'); t.integer('rate_count');
      t.float('rate_average_2dp'); t.text('rate_count_detail'); t.text('rank');
      t.timestamp('created_at'); t.timestamp('updated_at'); t.primary(['id']);
    });
    for (const [rel, key] of Object.entries({
      r_tag_work: 'tag_id', r_va_work: 'va_id', r_illustrator_work: 'illustrator_id',
      r_script_writer_work: 'script_writer_id', r_series_work: 'series_id',
    })) {
      await knex.schema.createTable(rel, t => { t.string(key); t.string('work_id'); });
    }
    await knex.schema.createTable('t_review', t => {
      t.string('user_name'); t.string('work_id'); t.integer('rating');
      t.string('review_text'); t.string('progress'); t.primary(['user_name', 'work_id']);
    });
    await knex.schema.createTable('t_play_history', t => {
      t.string('user_name'); t.string('work_id'); t.string('state');
      t.timestamps(true, true); t.primary(['user_name', 'work_id']);
    });

    await knex('t_circle').insert({ id: nameToUUID('Circle'), name: 'Circle' });
    const work = id => knex('t_work').insert({
      id, title: id, circle_id: nameToUUID('Circle'), nsfw: false, release: '2024-01-01',
    });
    await work('200001');
    await work('200002');
    await work('200003');
    await work('200004');
    await knex('t_review').insert([
      { user_name: 'admin', work_id: '200001', review_text: 'ゆるふわ' },   // text only
      { user_name: 'admin', work_id: '200002', review_text: '' },           // empty text
      { user_name: 'admin', work_id: '200004', progress: 'marked' },        // status only
    ]);
  });

  after(async function () {
    if (knex) await knex.destroy();
    if (existsSync(TEXT_DB)) unlinkSync(TEXT_DB);
  });

  const ids = async (opts) => {
    const { works, totalCount } = await Q.getWorksBy({ username: 'admin', order: 'release', sort: 'asc', ...opts });
    const got = works.map(w => w.id).sort();
    expect(totalCount[0].count).to.equal(got.length);
    return got;
  };

  it('counts a review text with no star as "has"', async function () {
    expect(await ids({ review: ['has'] })).to.deep.equal(['200001']);
  });

  it('counts an empty review_text as "none"', async function () {
    expect(await ids({ review: ['none'] })).to.deep.equal(['200002', '200003', '200004']);
  });

  it('leaves a status-only work as "none", which is what makes the axes independent', async function () {
    expect(await ids({ review: ['none'], progress: ['marked'] })).to.deep.equal(['200004']);
  });

  it('leaves those works in the "no progress" state, since text is not a status', async function () {
    expect(await ids({ progress: ['unmarked'] })).to.deep.equal(['200001', '200002', '200003']);
  });
});
