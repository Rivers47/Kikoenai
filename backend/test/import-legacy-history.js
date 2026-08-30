// Requiring the importer pulls in config + database/db; freeze the config file
// so the test run never writes one, as backfill-progress.js's test does.
process.env.FREEZE_CONFIG_FILE = true;

//eslint-disable-next-line n/no-unpublished-require
const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const knexLib = require('knex');
const { makeQueries } = require('../database/queries');
const { config } = require('../config');
const { runImport } = require('../scripts/import-legacy-history');

/**
 * The importer reads the current track list off disk (getTrackList), so these
 * tests lay down a real work folder. Where a test seeds memo.contentHash the
 * bytes are irrelevant; where it does not, the importer CRC32s the file it
 * finds, so the one byte written here is the hash's actual input.
 */
describe('import-legacy-history', () => {
  let knex, dbApi, tmpRoot, oldDbPath, oldKnex, savedRootFolders;

  const writeTrack = (relPath) => {
    const full = path.join(tmpRoot, 'w1', relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
  };

  beforeEach(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-import-'));
    savedRootFolders = config.rootFolders;
    config.rootFolders = [{ name: 'root', path: tmpRoot }];

    knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await knex.schema.createTable('t_work', t => {
      t.string('id').primary(); t.string('title'); t.string('root_folder'); t.string('dir'); t.text('memo');
    });
    await knex.schema.createTable('t_play_history', t => {
      t.string('user_name'); t.string('work_id'); t.text('state');
      t.timestamp('created_at'); t.timestamp('updated_at');
      t.primary(['user_name', 'work_id']);
    });
    await knex.schema.createTable('t_review', t => {
      t.string('user_name'); t.string('work_id'); t.string('progress');
      t.integer('rating'); t.text('review_text'); t.timestamp('updated_at');
      t.primary(['user_name', 'work_id']);
    });
    await knex.schema.createTable('t_track_progress', t => {
      t.string('user_name'); t.string('work_id'); t.string('track_key');
      t.float('seconds'); t.boolean('completed'); t.timestamp('updated_at');
      t.primary(['user_name', 'work_id', 'track_key']);
    });
    dbApi = { knex, ...makeQueries(knex) };

    // The legacy database, in the kikoeru-project shape.
    oldDbPath = path.join(tmpRoot, 'old.sqlite3');
    oldKnex = knexLib({ client: 'sqlite3', connection: { filename: oldDbPath }, useNullAsDefault: true });
    await oldKnex.schema.createTable('t_history', t => {
      t.increments('id'); t.string('user_name'); t.string('work_id');
      t.string('file_index'); t.string('file_name');
      t.integer('play_time'); t.integer('total_time');
      t.timestamp('created_at'); t.timestamp('updated_at');
    });
    await oldKnex.schema.createTable('t_review', t => {
      t.string('user_name'); t.string('work_id'); t.integer('rating');
      t.string('review_text'); t.string('progress');
    });
  });

  afterEach(async () => {
    config.rootFolders = savedRootFolders;
    await oldKnex.destroy();
    await knex.destroy();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  const run = (opts = {}) => runImport({ oldDbPath, log: () => {}, dbApi, ...opts });

  const insertWork = (memo) => knex('t_work').insert({
    id: '000001', title: 'Work One', root_folder: 'root', dir: 'w1', memo: JSON.stringify(memo),
  });

  describe('a re-encoded library (.flac -> .webm)', () => {
    beforeEach(async () => {
      writeTrack('01 intro.webm');
      writeTrack('02 main.webm');
      await insertWork({
        duration: { '01 intro.webm': 60.2, '02 main.webm': 600.4 },
        contentHash: { '01 intro.webm': 'aaaaaaaa', '02 main.webm': 'bbbbbbbb' },
      });
      await oldKnex('t_history').insert([
        { user_name: 'admin', work_id: '1', file_index: '0', file_name: '01 intro.flac', play_time: 59, total_time: 60, created_at: '2023-02-09 06:04:46', updated_at: '2023-02-09 06:04:46' },
        { user_name: 'admin', work_id: '1', file_index: '1', file_name: '02 main.flac', play_time: 120, total_time: 600, created_at: '2023-02-09 06:11:15', updated_at: '2023-02-10 07:00:00' },
      ]);
    });

    it('matches on the basename and seeds per-track progress', async () => {
      const summary = await run();
      expect(summary.matchedRows).to.equal(2);
      expect(summary.unmatchedRows).to.equal(0);

      const rows = await knex('t_track_progress').orderBy('track_key');
      expect(rows.map(r => [r.track_key, r.seconds, !!r.completed]))
        .to.deep.equal([['aaaaaaaa', 59, true], ['bbbbbbbb', 120, false]]);
    });

    it('rebuilds a play-history entry anchored on the last track played', async () => {
      await run();
      const row = await knex('t_play_history').first();
      const state = JSON.parse(row.state);
      expect(state.queue).to.have.length(2);
      expect(state.index).to.equal(1);
      expect(state.seconds).to.equal(120);
      expect(state.queue[1]).to.deep.equal({
        trackId: '000001/1', contentHash: 'bbbbbbbb', title: '02 main.webm',
        duration: 600.4, workTitle: 'Work One',
      });
      // The history list orders by updated_at; a 2023 session must not sort as today.
      expect(row.created_at).to.equal('2023-02-09 06:04:46');
      expect(row.updated_at).to.equal('2023-02-10 07:00:00');
    });

    it('writes nothing on a dry run', async () => {
      const summary = await run({ dryRun: true });
      expect(summary.progressWritten).to.equal(2);
      expect(await knex('t_track_progress').count('* as n').first()).to.deep.equal({ n: 0 });
      expect(await knex('t_play_history').count('* as n').first()).to.deep.equal({ n: 0 });
    });

    it('is idempotent: a second run writes nothing new', async () => {
      await run();
      const summary = await run();
      expect(summary.progressWritten).to.equal(0);
      expect(summary.playHistoryWritten).to.equal(0);
      expect(summary.progressSkipped).to.equal(2);
    });

    it('leaves a position the user has set since alone', async () => {
      await knex('t_track_progress').insert({
        user_name: 'admin', work_id: '000001', track_key: 'bbbbbbbb', seconds: 500, completed: 0,
      });
      await run();
      const row = await knex('t_track_progress').where({ track_key: 'bbbbbbbb' }).first();
      expect(row.seconds).to.equal(500);
    });
  });

  it('seeds both variants when a name exists in an SE-on and an SE-off folder', async () => {
    writeTrack('SE/01 track.webm');
    writeTrack('noSE/01 track.webm');
    await insertWork({
      duration: { 'SE/01 track.webm': 300, 'noSE/01 track.webm': 300 },
      contentHash: { 'SE/01 track.webm': 'aaaaaaaa', 'noSE/01 track.webm': 'bbbbbbbb' },
    });
    await oldKnex('t_history').insert({
      user_name: 'admin', work_id: '1', file_index: '0', file_name: '01 track.flac',
      play_time: 150, total_time: 300, created_at: '2023-02-09 06:04:46', updated_at: '2023-02-09 06:04:46',
    });

    await run();
    const rows = await knex('t_track_progress').orderBy('track_key');
    expect(rows.map(r => r.track_key)).to.deep.equal(['aaaaaaaa', 'bbbbbbbb']);
    // The queue is folder-scoped, so it holds only the anchor's own folder.
    const state = JSON.parse((await knex('t_play_history').first()).state);
    expect(state.queue).to.have.length(1);
  });

  it('picks the variant whose duration matches when the duplicates differ', async () => {
    writeTrack('SE/01 track.webm');
    writeTrack('noSE/01 track.webm');
    await insertWork({
      duration: { 'SE/01 track.webm': 300, 'noSE/01 track.webm': 420 },
      contentHash: { 'SE/01 track.webm': 'aaaaaaaa', 'noSE/01 track.webm': 'bbbbbbbb' },
    });
    await oldKnex('t_history').insert({
      user_name: 'admin', work_id: '1', file_index: '0', file_name: '01 track.flac',
      play_time: 100, total_time: 420, created_at: '2023-02-09 06:04:46', updated_at: '2023-02-09 06:04:46',
    });

    await run();
    const rows = await knex('t_track_progress');
    expect(rows.map(r => r.track_key)).to.deep.equal(['bbbbbbbb']);
  });

  it('falls back to a unique duration match for a renamed file', async () => {
    writeTrack('Track01 the real name.webm');
    writeTrack('Track02 something else.webm');
    await insertWork({
      duration: { 'Track01 the real name.webm': 913.7, 'Track02 something else.webm': 342.8 },
      contentHash: { 'Track01 the real name.webm': 'aaaaaaaa', 'Track02 something else.webm': 'bbbbbbbb' },
    });
    await oldKnex('t_history').insert({
      user_name: 'admin', work_id: '1', file_index: '0', file_name: 'Track01.flac',
      play_time: 32, total_time: 913, created_at: '2023-07-23 05:17:51', updated_at: '2023-07-23 05:17:51',
    });

    const summary = await run();
    expect(summary.matchedRows).to.equal(1);
    expect((await knex('t_track_progress').first()).track_key).to.equal('aaaaaaaa');
  });

  // A library that has not been rescanned has no memo.contentHash at all, which
  // is the normal state for someone importing years-old history. Requiring the
  // scan first would make the import a no-op on nearly every work.
  it('computes the hash from disk when the memo has none', async () => {
    writeTrack('01 intro.webm');
    await insertWork({ duration: { '01 intro.webm': 60 } });
    await oldKnex('t_history').insert({
      user_name: 'admin', work_id: '1', file_index: '0', file_name: '01 intro.flac',
      play_time: 59, total_time: 60, created_at: '2023-02-09 06:04:46', updated_at: '2023-02-09 06:04:46',
    });

    const summary = await run();
    expect(summary.hashesComputed).to.be.greaterThan(0);
    expect(summary.progressWritten).to.equal(1);

    const row = await knex('t_track_progress').first();
    // CRC32 of the one byte written by writeTrack, as zlib.crc32 produces it.
    expect(row.track_key).to.equal(require('zlib').crc32('x').toString(16));
    expect(row.seconds).to.equal(59);
  });

  it('works with no memo at all, matching purely on the file name', async () => {
    writeTrack('01 intro.webm');
    await insertWork({});
    await oldKnex('t_history').insert({
      user_name: 'admin', work_id: '1', file_index: '0', file_name: '01 intro.flac',
      play_time: 59, total_time: 60, created_at: '2023-02-09 06:04:46', updated_at: '2023-02-09 06:04:46',
    });

    const summary = await run();
    expect(summary.matchedRows).to.equal(1);
    expect(summary.progressWritten).to.equal(1);
    // No duration anywhere, so completion falls back to the legacy total_time.
    expect(!!(await knex('t_track_progress').first()).completed).to.equal(true);
  });

  it('gives every queue item a content hash on an unscanned work', async () => {
    writeTrack('01 intro.webm');
    writeTrack('02 main.webm');
    await insertWork({ duration: { '01 intro.webm': 60, '02 main.webm': 600 } });
    await oldKnex('t_history').insert({
      user_name: 'admin', work_id: '1', file_index: '0', file_name: '01 intro.flac',
      play_time: 30, total_time: 60, created_at: '2023-02-09 06:04:46', updated_at: '2023-02-09 06:04:46',
    });

    await run();
    // A queue persisted without hashes can never report per-track progress
    // again -- the resume-from-history path never refetches the tree.
    const state = JSON.parse((await knex('t_play_history').first()).state);
    expect(state.queue).to.have.length(2);
    expect(state.queue.every(q => !!q.contentHash)).to.equal(true);
  });

  it('reads each file at most once per run', async () => {
    writeTrack('SE/01 track.webm');
    writeTrack('noSE/01 track.webm');
    await insertWork({ duration: { 'SE/01 track.webm': 300, 'noSE/01 track.webm': 300 } });
    await oldKnex('t_history').insert({
      user_name: 'admin', work_id: '1', file_index: '0', file_name: '01 track.flac',
      play_time: 150, total_time: 300, created_at: '2023-02-09 06:04:46', updated_at: '2023-02-09 06:04:46',
    });

    // Both mixes are seeded, and the anchor's folder is hashed for the queue --
    // but the anchor track itself is shared between those two passes.
    const summary = await run();
    expect(summary.hashesComputed).to.equal(2);
  });

  it('skips a work that is no longer in the library', async () => {
    await oldKnex('t_history').insert({
      user_name: 'admin', work_id: '999999', file_index: '0', file_name: 'x.flac',
      play_time: 1, total_time: 2, created_at: '2023-02-09 06:04:46', updated_at: '2023-02-09 06:04:46',
    });
    const summary = await run();
    expect(summary.worksMissing).to.equal(1);
  });

  describe('reviews', () => {
    beforeEach(async () => {
      writeTrack('01 intro.webm');
      await insertWork({
        duration: { '01 intro.webm': 60 }, contentHash: { '01 intro.webm': 'aaaaaaaa' },
      });
    });

    it('ports rating and progress, treating rating 0 as unrated', async () => {
      await oldKnex('t_review').insert([
        { user_name: 'admin', work_id: '1', rating: 5, review_text: '', progress: 'listened' },
      ]);
      await run();
      const row = await knex('t_review').first();
      expect(row.rating).to.equal(5);
      expect(row.progress).to.equal('listened');
    });

    it('fills only the fields that are currently empty', async () => {
      await knex('t_review').insert({ user_name: 'admin', work_id: '000001', rating: 3 });
      await oldKnex('t_review').insert({ user_name: 'admin', work_id: '1', rating: 5, review_text: '', progress: 'marked' });

      await run();
      const row = await knex('t_review').first();
      expect(row.rating).to.equal(3);       // kept
      expect(row.progress).to.equal('marked'); // filled
    });

    it('skips an all-empty legacy review row', async () => {
      await oldKnex('t_review').insert({ user_name: 'admin', work_id: '1', rating: 0, review_text: '', progress: null });
      const summary = await run();
      expect(summary.reviewsWritten).to.equal(0);
    });
  });
});
