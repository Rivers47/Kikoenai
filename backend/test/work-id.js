/* eslint-disable n/no-unpublished-require */
// Canonical Fanza work ids (d215444) and the boundaries that still speak d_215444

process.env.FREEZE_CONFIG_FILE = '1';

const chai = require('chai');
const expect = chai.expect;
const { existsSync, unlinkSync } = require('fs');
const { join } = require('path');

const { isFanzaId, canonicalizeWorkId, fanzaCid } = require('../work-id');
const { coverFileName, workImageFileName, getFolderList } = require('../filesystem/utils');
const migration = require('../database/migrations/20260828000000_canonical_fanza_id');

describe('work-id helpers', function () {
  it('recognises both Fanza spellings, and no DLsite id', function () {
    expect(isFanzaId('d215444')).to.be.true;
    expect(isFanzaId('d_215444')).to.be.true;
    expect(isFanzaId('123456')).to.be.false;
    expect(isFanzaId('01134567')).to.be.false;
  });

  it('canonicalizes to the underscore-free form', function () {
    expect(canonicalizeWorkId('d_215444')).to.equal('d215444');
    expect(canonicalizeWorkId('d215444')).to.equal('d215444');
    expect(canonicalizeWorkId('01134567')).to.equal('01134567');
  });

  it('rebuilds Fanza\'s own cid for DMM', function () {
    expect(fanzaCid('d215444')).to.equal('d_215444');
    expect(fanzaCid('d_215444')).to.equal('d_215444');
    expect(fanzaCid('123456')).to.equal('123456');
  });

  it('keeps on-disk file names in the underscore form', function () {
    // Renaming everyone's cached covers is not worth it; the file name is an
    // external format here, like the DMM URL.
    expect(coverFileName('d215444', 'main')).to.equal('d_215444_img_main.jpg');
    expect(coverFileName('d_215444', 'main')).to.equal('d_215444_img_main.jpg');
    expect(coverFileName('123456', 'main')).to.equal('RJ123456_img_main.jpg');
    expect(workImageFileName('d215444', 'smp', 2)).to.equal('d_215444_img_smp2.jpg');
  });
});

describe('getFolderList() work-code detection', function () {
  const { mkdtempSync, mkdirSync, rmSync } = require('fs');
  let root;

  const scan = async () => {
    const found = [];
    for await (const folder of getFolderList({ name: 'test', path: root })) found.push(folder.id);
    return found.sort();
  };

  before('Lay out a fake library', function () {
    root = mkdtempSync(join(__dirname, 'folders-'));
    for (const name of [
      'RJ123456 タイトル',      // DLsite
      'd_215444',               // Fanza, its own spelling
      'd987654 タイトル',       // Fanza, underscore-free
      '[FANZA] d_111222',       // Fanza, prefixed
      'Sound_CD1',              // NOT a work code
    ]) mkdirSync(join(root, name));
  });

  after(function () {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('reads both Fanza spellings and yields the canonical id', async function () {
    // Sound_CD1 is not a work folder, so it is recursed into (and is empty).
    expect(await scan()).to.deep.equal(['123456', 'd111222', 'd215444', 'd987654']);
  });
});

describe('migration 20260828000000 (d_215444 → d215444)', function () {
  this.timeout(10000);

  const TEST_DB = join(__dirname, 'db-workid-test.sqlite3');
  let knex;

  const ids = () => knex('t_work').pluck('id').orderBy('id');

  before('Build a two-work library with a pre-migration Fanza id', async function () {
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    knex = require('knex')({
      client: 'sqlite3', useNullAsDefault: true, connection: { filename: TEST_DB },
    });
    await knex.schema.createTable('t_work', t => { t.string('id'); t.string('title'); });
    await knex.schema.createTable('r_tag_work', t => { t.string('tag_id'); t.string('work_id'); });
    await knex.schema.createTable('t_review', t => { t.string('work_id'); t.integer('rating'); });
    await knex('t_work').insert([{ id: 'd_215444', title: 'Fanza' }, { id: '123456', title: 'DLsite' }]);
    await knex('r_tag_work').insert([{ tag_id: 'x', work_id: 'd_215444' }, { tag_id: 'x', work_id: '123456' }]);
    await knex('t_review').insert([{ work_id: 'd_215444', rating: 5 }]);
  });

  after(async function () {
    if (knex) await knex.destroy();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
  });

  it('rewrites every work-id column, leaving DLsite ids alone', async function () {
    await migration.up(knex);
    expect(await ids()).to.deep.equal(['123456', 'd215444']);
    expect(await knex('r_tag_work').pluck('work_id').orderBy('work_id')).to.deep.equal(['123456', 'd215444']);
    expect(await knex('t_review').pluck('work_id')).to.deep.equal(['d215444']);
  });

  it('reverses cleanly', async function () {
    await migration.down(knex);
    expect(await ids()).to.deep.equal(['123456', 'd_215444']);
    expect(await knex('t_review').pluck('work_id')).to.deep.equal(['d_215444']);
    await migration.up(knex); // leave it migrated
  });
});
