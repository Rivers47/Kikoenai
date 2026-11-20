/* eslint-disable n/no-unpublished-require */
// Custom works against a real database: a work with no circle, the sidecar as
// the refresh source, and the cleanup rule that lets the sidecar be deleted.
process.env.FREEZE_CONFIG_FILE = '1';
process.env.NODE_ENV = 'test';

const { expect } = require('chai');
const { existsSync } = require('fs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../database/db');
const { createSchema } = require('../database/schema');
const normalize = require('../routes/utils/normalize');
const { customWorkId } = require('../work-id');
const { readNfoMetadata } = require('../filesystem/nfo');
const {
  CustomWorkError, customWorkFields, insertCustomWork, refreshCustomWork, localDate,
} = require('../filesystem/customWork');
const { performCleanup } = require('../filesystem/scannerModules');
const { config } = require('../config');

const TEST_DB = path.join(__dirname, 'db-test.sqlite3');

const DROP_LIST = [
  'DROP VIEW IF EXISTS staticMetadata',
  'DROP TABLE IF EXISTS r_tag_work',
  'DROP TABLE IF EXISTS r_va_work',
  'DROP TABLE IF EXISTS r_illustrator_work',
  'DROP TABLE IF EXISTS r_script_writer_work',
  'DROP TABLE IF EXISTS r_series_work',
  'DROP TABLE IF EXISTS r_author_work',
  'DROP TABLE IF EXISTS t_dlsite_review',
  'DROP TABLE IF EXISTS t_work_file',
  'DROP TABLE IF EXISTS t_track_progress',
  'DROP TABLE IF EXISTS t_review',
  'DROP TABLE IF EXISTS t_play_history',
  'DROP TABLE IF EXISTS t_work',
  'DROP TABLE IF EXISTS t_tag',
  'DROP TABLE IF EXISTS t_va',
  'DROP TABLE IF EXISTS t_illustrator',
  'DROP TABLE IF EXISTS t_script_writer',
  'DROP TABLE IF EXISTS t_series',
  'DROP TABLE IF EXISTS t_author',
  'DROP TABLE IF EXISTS t_circle',
  'DROP TABLE IF EXISTS t_user',
  'DROP TABLE IF EXISTS t_session',
  'DROP TABLE IF EXISTS knex_migrations',
];

describe('custom works in the database', function () {
  this.timeout(20000);

  let root;
  let workDir;
  let savedRootFolders;
  let savedCoverDir;
  let savedImageDir;
  let workId;

  const writeNfo = (body) => fs.writeFileSync(path.join(workDir, 'kikoenai.nfo'), body);

  const folder = () => ({
    id: workId,
    absolutePath: workDir,
    relativePath: 'Rain',
    rootFolderName: 'library',
    nfoMetadata: readNfoMetadata(workDir),
  });

  before('Create a fresh schema and a library folder', async function () {
    if (existsSync(TEST_DB)) {
      for (const statement of DROP_LIST) {
        try {
          await db.knex.schema.raw(statement);
        } catch { /* ignore */ }
      }
    }
    await createSchema();

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-custom-db-'));
    workDir = path.join(root, 'Rain');
    fs.mkdirSync(workDir, { recursive: true });

    savedRootFolders = config.rootFolders;
    savedCoverDir = config.coverFolderDir;
    savedImageDir = config.imageFolderDir;
    config.rootFolders = [{ name: 'library', path: root }];
    config.coverFolderDir = path.join(root, 'covers');
    config.imageFolderDir = path.join(root, 'images');

    workId = customWorkId('library', 'Rain');
  });

  after('Restore config and drop the schema', async function () {
    config.rootFolders = savedRootFolders;
    config.coverFolderDir = savedCoverDir;
    config.imageFolderDir = savedImageDir;
    fs.rmSync(root, { recursive: true, force: true });

    for (const statement of DROP_LIST) {
      try {
        await db.knex.schema.raw(statement);
      } catch { /* ignore */ }
    }
  });

  describe('customWorkFields', () => {
    it('defaults a first import: folder name, not nsfw, today', () => {
      const fields = customWorkFields({}, { folderName: 'Rain' });

      expect(fields.title).to.equal('Rain');
      expect(fields.nsfw).to.equal(false);
      expect(fields.release).to.equal(localDate());
      expect(fields.circle).to.equal(null);
      expect(fields.series).to.equal(null);
      expect(fields.tags).to.deep.equal([]);
    });

    it('keeps what the database already has when the file omits a key', () => {
      const fields = customWorkFields({}, {
        folderName: 'Rain',
        current: {
          title: '旧标题',
          nsfw: true,
          release: '2020-01-01',
          circle: { id: 'c', name: '社团' },
          series: { id: 's', name: '系列' },
          description: '<p>旧</p>',
          tags: [{ id: 't', name: '旧标签' }],
        },
      });

      expect(fields.title).to.equal('旧标题');
      expect(fields.nsfw).to.equal(true);
      expect(fields.release).to.equal('2020-01-01');
      expect(fields.circle).to.deep.equal({ name: '社团' });
      expect(fields.series).to.deep.equal({ name: '系列' });
      expect(fields.description).to.equal('<p>旧</p>');
      expect(fields.tags).to.deep.equal([{ name: '旧标签' }]);
    });

    it('lets the file clear a field the database has', () => {
      const fields = customWorkFields(
        { tags: [], description: undefined },
        { folderName: 'Rain', current: { tags: [{ name: '旧' }], description: '<p>旧</p>' } },
      );

      expect(fields.tags).to.deep.equal([]);
      expect(fields.description).to.equal('<p>旧</p>');
    });
  });

  describe('insertCustomWork', () => {
    it('inserts a work with no circle and the sidecar fields', async () => {
      writeNfo(`
title = "雨の日"
release = "2024-03-05"
tags = ["ASMR"]
vas = ["声優"]
description = "<p>説明</p>"
`);
      await insertCustomWork(folder());

      const row = await db.knex('t_work').where('id', workId).first();
      expect(row.title).to.equal('雨の日');
      expect(row.circle_id).to.equal(null);
      expect(row.nsfw).to.equal(0);
      expect(row.release).to.equal('2024-03-05');
      expect(row.description).to.equal('<p>説明</p>');
      expect(row.dl_count).to.equal(null);
      expect(row.rate_count_detail).to.equal(null);

      const tags = await db.knex('r_tag_work').where('work_id', workId);
      expect(tags).to.have.length(1);
    });

    it('lists a circle-less work, with circle null', async () => {
      const { works } = await db.getWorksBy({ username: 'admin', nsfw: 0, order: 'release', sort: 'desc' });
      normalize(works);

      const work = works.find(candidate => candidate.id === workId);
      expect(work).to.not.equal(undefined);
      expect(work.circle).to.equal(null);
      expect(work.tags).to.deep.equal([{ id: work.tags[0].id, name: 'ASMR' }]);
    });

    it('returns a circle-less work from the detail query', async () => {
      const [work] = await db.getWorkMetadata(workId, 'admin');
      normalize([work]);

      expect(work.circle).to.equal(null);
      expect(work.title).to.equal('雨の日');
    });
  });

  describe('editWorkMetadata', () => {
    it('clears the circle when the name is empty', async () => {
      await db.editWorkMetadata(workId, {
        title: '雨の日', nsfw: false, release: '2024-03-05', circle: '  ',
        tags: [], vas: [], illustrators: [], scriptWriters: [], series: null,
      });

      const row = await db.knex('t_work').where('id', workId).first();
      expect(row.circle_id).to.equal(null);
    });

    it('sets and clears the description', async () => {
      await db.editWorkMetadata(workId, {
        title: '雨の日', nsfw: false, release: '2024-03-05', circle: null,
        tags: [], vas: [], illustrators: [], scriptWriters: [], series: null,
        description: '<p>新</p>',
      });
      expect((await db.knex('t_work').where('id', workId).first()).description).to.equal('<p>新</p>');

      await db.editWorkMetadata(workId, {
        title: '雨の日', nsfw: false, release: '2024-03-05', circle: null,
        tags: [], vas: [], illustrators: [], scriptWriters: [], series: null,
        description: '',
      });
      expect((await db.knex('t_work').where('id', workId).first()).description).to.equal(null);
    });
  });

  describe('refreshCustomWork', () => {
    it('re-applies the sidecar without changing the id', async () => {
      writeNfo('title = "新しいタイトル"\ntags = ["新标签"]');
      await refreshCustomWork(workId);

      const row = await db.knex('t_work').where('id', workId).first();
      expect(row.id).to.equal(workId);
      expect(row.title).to.equal('新しいタイトル');

      const tags = await db.knex('r_tag_work').join('t_tag', 't_tag.id', 'r_tag_work.tag_id')
        .select('t_tag.name').where('work_id', workId);
      expect(tags.map(tag => tag.name)).to.deep.equal(['新标签']);
    });

    it('keeps the work untouched when the sidecar is gone', async () => {
      fs.unlinkSync(path.join(workDir, 'kikoenai.nfo'));

      try {
        await refreshCustomWork(workId);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(CustomWorkError);
        expect(err.status).to.equal(400);
        expect(err.reason).to.equal('no-nfo');
      }

      const row = await db.knex('t_work').where('id', workId).first();
      expect(row.title).to.equal('新しいタイトル');
    });

    it('reports a missing work as 404', async () => {
      try {
        await refreshCustomWork(customWorkId('library', 'Gone'));
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(CustomWorkError);
        expect(err.status).to.equal(404);
      }
    });
  });

  describe('cleanup', () => {
    it('keeps a custom work whose sidecar is gone but whose folder remains', async () => {
      await performCleanup();

      const row = await db.knex('t_work').where('id', workId).first();
      expect(row).to.not.equal(undefined);
    });

    it('removes the work once the folder is gone, circle-less or not', async () => {
      fs.rmSync(workDir, { recursive: true, force: true });
      await performCleanup();

      const row = await db.knex('t_work').where('id', workId).first();
      expect(row).to.equal(undefined);
    });
  });
});
