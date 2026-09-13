/* eslint-disable n/no-unpublished-require */
// relPath is a file's one identity: its trackId, its media URL and its
// t_track_progress.track_key. These cover the resolution both ways, the legacy
// positional handle that stored play-history queues still carry, and the
// migration that rekeyed them.

process.env.FREEZE_CONFIG_FILE = '1';

const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const os = require('os');
const path = require('path');
const knexLib = require('knex');

const { getTrackList, toTree } = require('../filesystem/utils');
const { legacyIndex } = require('../routes/utils/track');
const migration = require('../database/migrations/20260912000000_relpath_track_keys');
const { addWorkFileSchema } = require('./helpers/schema');
const { makeQueries } = require('../database/queries');

describe('track identity: relPath', function () {
  let dir;

  const write = (relPath, body = 'x') => {
    const full = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-track-'));
  });

  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('builds a trackId from the work id and the relative path', async function () {
    write('01 intro.mp3');
    write('SE/02 main.mp3');

    const tracks = await getTrackList('000001', dir, {});
    const byPath = new Map(tracks.map(t => [t.shortFilePath, t.trackId]));

    expect(byPath.get('01 intro.mp3')).to.equal('000001/01 intro.mp3');
    expect(byPath.get('SE/02 main.mp3')).to.equal('000001/SE/02 main.mp3');
  });

  it('keeps a non-ASCII path intact', async function () {
    write('絶頂トレーニング/01 囁き＆吐息♡.mp3');

    const [track] = await getTrackList('000001', dir, {});
    expect(track.shortFilePath).to.equal('絶頂トレーニング/01 囁き＆吐息♡.mp3');
    expect(track.trackId).to.equal('000001/絶頂トレーニング/01 囁き＆吐息♡.mp3');
  });

  // A media URL is the trackId, so a backslashed relPath from a Windows server
  // would key the same file differently and address a path no client can build.
  it('always spells a relPath with forward slashes', async function () {
    write('SE/sub dir/03.mp3');

    const [track] = await getTrackList('000001', dir, {});
    expect(track.shortFilePath).to.not.include('\\');
    expect(track.shortFilePath).to.equal('SE/sub dir/03.mp3');
  });

  it('exposes relPath on every node type, not just audio', async function () {
    write('01 intro.mp3');
    write('cover.jpg');
    write('readme.txt');
    write('booklet.pdf');

    const tracks = await getTrackList('000001', dir, {});
    const tree = toTree(tracks, 'Work', 'w1', { name: 'root', path: dir });
    const nodes = tree.filter(n => n.type);

    expect(nodes.map(n => n.type).sort()).to.deep.equal(['audio', 'image', 'other', 'text']);
    for (const node of nodes) {
      expect(node.relPath, node.type).to.be.a('string');
      expect(node.trackId, node.type).to.equal(`000001/${node.relPath}`);
    }
  });

  describe('the legacy positional handle', function () {
    it('reads a lone run of digits as an index', function () {
      expect(legacyIndex(['7'])).to.equal(7);
      expect(legacyIndex(['0'])).to.equal(0);
    });

    // Every tracked file carries a supported extension, so a real relPath
    // always contains a '.' -- which is what makes the branch unambiguous.
    it('reads anything that could be a real path as a path', function () {
      expect(legacyIndex(['01.mp3'])).to.equal(null);
      expect(legacyIndex(['SE', '7'])).to.equal(null);
      expect(legacyIndex(['7.mp3'])).to.equal(null);
      expect(legacyIndex([])).to.equal(null);
    });
  });

  describe('migration 20260912000000', function () {
    let knex;

    beforeEach(async function () {
      knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
      await knex.schema.createTable('t_work', t => { t.string('id').primary(); t.text('memo'); });
      await knex.schema.createTable('t_play_history', t => {
        t.string('user_name'); t.string('work_id'); t.text('state');
      });
      await knex.schema.createTable('t_track_progress', t => {
        t.string('user_name'); t.string('work_id'); t.string('track_key');
        t.float('seconds'); t.boolean('completed'); t.timestamp('updated_at');
        t.primary(['user_name', 'work_id', 'track_key']);
      });
      await knex('t_work').insert({
        id: '000001',
        memo: JSON.stringify({
          duration: { '01 intro.mp3': 60 },
          contentHash: { '01 intro.mp3': 'aaaaaaaa', 'SE/02 main.mp3': 'bbbbbbbb' },
        }),
      });
    });

    afterEach(async function () { await knex.destroy(); });

    it('rekeys a progress row from its hash to its relPath', async function () {
      await knex('t_track_progress').insert({
        user_name: 'admin', work_id: '000001', track_key: 'bbbbbbbb', seconds: 42, completed: 0,
      });

      await migration.up(knex);

      const row = await knex('t_track_progress').first();
      expect(row.track_key).to.equal('SE/02 main.mp3');
      expect(row.seconds).to.equal(42);
    });

    // Never deleted: an older scrapeWorkMemo wiped memo.contentHash on most
    // works (AGENTS.md §2.9a), and the old tree endpoint would recompute the
    // hash and revive the row -- so dropping it here is silent data loss.
    // scripts/rekey-track-progress.js recovers these by reading the files.
    it('keeps a progress row whose hash no longer resolves', async function () {
      await knex('t_track_progress').insert({
        user_name: 'admin', work_id: '000001', track_key: 'deadbeef', seconds: 9, completed: 0,
      });

      await migration.up(knex);

      const row = await knex('t_track_progress').first();
      expect(row.track_key).to.equal('deadbeef');
      expect(row.seconds).to.equal(9);
    });

    it('rewrites a queue item trackId and drops its contentHash', async function () {
      await knex('t_play_history').insert({
        user_name: 'admin', work_id: '000001',
        state: JSON.stringify({
          index: 0,
          queue: [{ trackId: '000001/3', contentHash: 'aaaaaaaa', title: '01 intro.mp3' }],
        }),
      });

      await migration.up(knex);

      const state = JSON.parse((await knex('t_play_history').first()).state);
      expect(state.queue[0].trackId).to.equal('000001/01 intro.mp3');
      expect(state.queue[0]).to.not.have.property('contentHash');
    });

    it('folds the pre-rename `hash` field into trackId', async function () {
      await knex('t_play_history').insert({
        user_name: 'admin', work_id: '000001',
        state: JSON.stringify({ index: 0, queue: [{ hash: '000001/3', title: '01 intro.mp3' }] }),
      });

      await migration.up(knex);

      const item = JSON.parse((await knex('t_play_history').first()).state).queue[0];
      // No contentHash to resolve, so the legacy positional handle is kept --
      // routes/utils/track.js still resolves it.
      expect(item.trackId).to.equal('000001/3');
      expect(item).to.not.have.property('hash');
    });

    it('strips contentHash from the memo once it has been used', async function () {
      await migration.up(knex);

      const memo = JSON.parse((await knex('t_work').first()).memo);
      expect(memo).to.not.have.property('contentHash');
      expect(memo.duration).to.deep.equal({ '01 intro.mp3': 60 });
    });

    it('refuses to roll back rather than pretend it can', async function () {
      let threw = false;
      try {
        await migration.down(knex);
      } catch {
        threw = true;
      }
      expect(threw).to.equal(true);
    });
  });
});

// The recovery tool for rows migration 20260912000000 had to leave behind.
// CRC32 lives only in that script, so this is the one place it is exercised.
describe('rekey-track-progress (opt-in recovery)', function () {
  const zlib = require('zlib');
  const { config } = require('../config');
  const { run } = require('../scripts/rekey-track-progress');

  let knex, root, savedRootFolders;

  const hashOf = (body) => (zlib.crc32(body) >>> 0).toString(16).padStart(8, '0');

  beforeEach(async function () {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-rekey-'));
    fs.mkdirSync(path.join(root, 'w1'));
    fs.writeFileSync(path.join(root, 'w1', '01 intro.mp3'), 'aaaa');
    savedRootFolders = config.rootFolders;
    config.rootFolders = [{ name: 'root', path: root }];

    knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await knex.schema.createTable('t_work', t => {
      t.string('id').primary(); t.string('root_folder'); t.string('dir');
    });
    await knex.schema.createTable('t_track_progress', t => {
      t.string('user_name'); t.string('work_id'); t.string('track_key');
      t.float('seconds'); t.boolean('completed'); t.timestamp('updated_at');
      t.primary(['user_name', 'work_id', 'track_key']);
    });
    await addWorkFileSchema(knex);
    await knex('t_work').insert({ id: '000001', root_folder: 'root', dir: 'w1' });
  });

  afterEach(async function () {
    config.rootFolders = savedRootFolders;
    await knex.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const seed = (track_key, seconds = 42) => knex('t_track_progress')
    .insert({ user_name: 'admin', work_id: '000001', track_key, seconds, completed: 0 });

  it('recovers a stranded row by hashing the file it names', async function () {
    await seed(hashOf('aaaa'), 77);

    const summary = await run({ log: () => {}, dbApi: { knex, ...makeQueries(knex) } });
    expect(summary.recovered).to.equal(1);

    const row = await knex('t_track_progress').first();
    expect(row.track_key).to.equal('01 intro.mp3');
    expect(row.seconds).to.equal(77);
  });

  it('leaves a row alone when no file matches its hash', async function () {
    await seed('deadbeef');

    const summary = await run({ log: () => {}, dbApi: { knex, ...makeQueries(knex) } });
    expect(summary.unresolved).to.equal(1);
    expect((await knex('t_track_progress').first()).track_key).to.equal('deadbeef');
  });

  it('writes nothing on a dry run', async function () {
    await seed(hashOf('aaaa'));

    const summary = await run({ dryRun: true, log: () => {}, dbApi: { knex, ...makeQueries(knex) } });
    expect(summary.recovered).to.equal(1);
    expect((await knex('t_track_progress').first()).track_key).to.equal(hashOf('aaaa'));
  });

  it('discards the leftovers on --purge', async function () {
    await seed('deadbeef');

    const summary = await run({ purge: true, log: () => {}, dbApi: { knex, ...makeQueries(knex) } });
    expect(summary.purged).to.equal(1);
    expect(await knex('t_track_progress').first()).to.equal(undefined);
  });

  it('does nothing when every key is already a relPath', async function () {
    await seed('01 intro.mp3');

    const summary = await run({ log: () => {}, dbApi: { knex, ...makeQueries(knex) } });
    expect(summary).to.deep.equal({ stale: 0, recovered: 0, purged: 0, unresolved: 0 });
  });
});

// Re-running the migration must not report already-converted rows as stranded:
// by then the memos are stripped, so nothing resolves and a "did not resolve"
// counter would accuse every row it had correctly converted.
describe('migration 20260912000000 re-run', function () {
  let knex;

  beforeEach(async function () {
    knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await knex.schema.createTable('t_work', t => { t.string('id').primary(); t.text('memo'); });
    await knex.schema.createTable('t_play_history', t => {
      t.string('user_name'); t.string('work_id'); t.text('state');
    });
    await knex.schema.createTable('t_track_progress', t => {
      t.string('user_name'); t.string('work_id'); t.string('track_key');
      t.float('seconds'); t.boolean('completed'); t.timestamp('updated_at');
      t.primary(['user_name', 'work_id', 'track_key']);
    });
    // Already migrated: memo stripped, one row converted, one left stranded.
    await knex('t_work').insert({ id: '000001', memo: JSON.stringify({ duration: {} }) });
    await knex('t_track_progress').insert([
      { user_name: 'admin', work_id: '000001', track_key: '01 intro.mp3', seconds: 10, completed: 0 },
      { user_name: 'admin', work_id: '000001', track_key: 'deadbeef', seconds: 20, completed: 0 },
    ]);
  });

  afterEach(async function () { await knex.destroy(); });

  it('counts only genuinely hash-shaped keys as stranded', async function () {
    const lines = [];
    const log = console.log;
    console.log = (m) => lines.push(String(m));
    try {
      await migration.up(knex);
    } finally {
      console.log = log;
    }
    expect(lines.join('\n')).to.include('1 left hash-keyed');
  });

  it('changes nothing on a second pass', async function () {
    const before = await knex('t_track_progress').orderBy('track_key');
    await migration.up(knex);
    const after = await knex('t_track_progress').orderBy('track_key');
    expect(after).to.deep.equal(before);
  });
});
