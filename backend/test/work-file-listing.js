/* eslint-disable n/no-unpublished-require */
// A work's file listing comes from t_work_file now, not from walking the folder
// on every request. These pin the two properties that would break quietly:
// the order must match what the walk produced, and a work must be walked once
// and then never again.

process.env.FREEZE_CONFIG_FILE = '1';

const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const knexLib = require('knex');

const { makeQueries } = require('../database/queries');
const { getTrackList } = require('../filesystem/utils');
const { listWorkTracks, indexWorkFiles } = require('../filesystem/workFiles');
const { addWorkFileSchema } = require('./helpers/schema');

describe('work file listing (t_work_file)', () => {
  let knex, dbApi, root, workDir;

  const write = (relPath, body = 'x') => {
    const full = path.join(workDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  };

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-wf-'));
    workDir = path.join(root, 'w1');
    fs.mkdirSync(workDir);

    knex = knexLib({ client: 'sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await knex.schema.createTable('t_work', (t) => {
      t.string('id').primary(); t.string('root_folder'); t.string('dir');
    });
    await addWorkFileSchema(knex);
    await knex('t_work').insert({ id: '000001', root_folder: 'root', dir: 'w1' });
    dbApi = { knex, ...makeQueries(knex) };
  });

  afterEach(async () => {
    await knex.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  });

  // The order decides the order of every file tree in the UI, and it used to be
  // whatever natural-orderby made of the walked list. Drift here is invisible
  // until someone notices their tracks are shuffled.
  it('orders identically to the filesystem walk', async () => {
    write('02 second.mp3');
    write('01 first.mp3');
    write('10 tenth.mp3');          // natural order: 10 after 2, not after 1
    write('SE/01 first.mp3');
    write('SE/02 second.mp3');
    write('絶頂/01 囁き♡.mp3');
    write('cover.jpg');
    write('notes.txt');

    const walked = (await getTrackList('000001', workDir, {})).map((t) => t.trackId);
    const listed = (await listWorkTracks('000001', workDir, { dbApi })).map((t) => t.trackId);

    expect(listed).to.deep.equal(walked);
  });

  it('carries every tracked file type, not just audio', async () => {
    write('01.mp3'); write('01.lrc'); write('cover.jpg'); write('booklet.pdf'); write('notes.txt');

    const listed = await listWorkTracks('000001', workDir, { dbApi });
    expect(listed.map((t) => t.shortFilePath).sort())
      .to.deep.equal(['01.lrc', '01.mp3', 'booklet.pdf', 'cover.jpg', 'notes.txt']);
  });

  it('indexes once, then reads without touching the filesystem', async () => {
    write('01.mp3');
    await listWorkTracks('000001', workDir, { dbApi });

    const stamped = await knex('t_work').select('files_indexed_at').where('id', '000001').first();
    expect(stamped.files_indexed_at, 'files_indexed_at is stamped').to.not.equal(null);

    // Delete the folder outright: a second read that still answers proves it is
    // not walking. This is also the unmounted-NAS case.
    fs.rmSync(workDir, { recursive: true, force: true });
    const again = await listWorkTracks('000001', workDir, { dbApi });
    expect(again.map((t) => t.shortFilePath)).to.deep.equal(['01.mp3']);
  });

  it('does not re-walk a work that is genuinely empty', async () => {
    const listed = await listWorkTracks('000001', workDir, { dbApi });
    expect(listed).to.deep.equal([]);
    const stamped = await knex('t_work').select('files_indexed_at').where('id', '000001').first();
    expect(stamped.files_indexed_at, 'an empty work is still marked indexed').to.not.equal(null);
  });

  // Durations cost an ffprobe each and track titles cost a model call. Indexing
  // must not write NULLs over them.
  it('carries durations and track titles from the memo on first index', async () => {
    write('01.mp3'); write('02.mp3');
    await knex('t_work').where('id', '000001').update({
      memo: JSON.stringify({
        duration: { '01.mp3': 61.5, '02.mp3': 120 },
        trackTitles: { '01.mp3': 'Opening' },
      }),
    });

    const listed = await listWorkTracks('000001', workDir, { dbApi });
    const byPath = new Map(listed.map((t) => [t.shortFilePath, t]));
    expect(byPath.get('01.mp3').duration).to.equal(61.5);
    expect(byPath.get('01.mp3').trackTitle).to.equal('Opening');
    expect(byPath.get('02.mp3').duration).to.equal(120);
  });

  it('preserves a stored duration when re-indexing without one', async () => {
    write('01.mp3');
    await dbApi.replaceWorkFiles('000001', [
      { work_id: '000001', rel_path: '01.mp3', duration: 99, mtime: 1, track_title: 'Kept' },
    ]);

    await indexWorkFiles('000001', workDir, undefined, dbApi);
    const [row] = await dbApi.getWorkFiles('000001');
    expect(row.duration).to.equal(99);
    expect(row.track_title).to.equal('Kept');
  });

  it('drops rows for files that are gone after a re-index', async () => {
    write('01.mp3'); write('02.mp3');
    await listWorkTracks('000001', workDir, { dbApi });

    fs.rmSync(path.join(workDir, '02.mp3'));
    await indexWorkFiles('000001', workDir, undefined, dbApi);

    const rows = await dbApi.getWorkFiles('000001');
    expect(rows.map((r) => r.rel_path)).to.deep.equal(['01.mp3']);
  });

  it('only attaches duration to audio, matching the walk', async () => {
    write('01.mp3'); write('cover.jpg');
    await knex('t_work').where('id', '000001').update({
      memo: JSON.stringify({ duration: { '01.mp3': 10 } }),
    });

    const listed = await listWorkTracks('000001', workDir, { dbApi });
    const cover = listed.find((t) => t.shortFilePath === 'cover.jpg');
    expect(cover).to.not.have.property('duration');
  });
});
