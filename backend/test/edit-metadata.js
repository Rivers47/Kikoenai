/* eslint-disable n/no-unpublished-require */
// Test manual metadata editing and refresh-merge semantics

process.env.FREEZE_CONFIG_FILE = true;
process.env.NODE_ENV = 'test';

const chai = require('chai');
const expect = chai.expect;
const { existsSync } = require('fs');
const { join } = require('path');

const db = require('../database/db');
const { createSchema } = require('../database/schema');
const { nameToUUID } = require('../scraper/utils');

const TEST_DB = join(__dirname, 'db-test.sqlite3');

// Wrapper describe so the trailing `after` hook is scoped to this file's
// suite (runs after both child describes) rather than registered as a global
// root hook that would only fire after the entire Mocha run. This keeps
// test/migration..js (which shares db-test.sqlite3) from seeing our schema.
describe('edit-metadata suite', function () {
  this.timeout(10000);

describe('editWorkMetadata', function () {
  // Increase timeout for DB operations
  this.timeout(10000);

  let workId;
  let defaultCircleId;

  before('Create fresh test schema and insert a work', async function () {
    // Remove old test DB if exists
    if (existsSync(TEST_DB)) {
      // Drop all tables first
      try {
        await db.knex.schema.raw('DROP VIEW IF EXISTS staticMetadata');
        await db.knex.schema.raw('DROP TABLE IF EXISTS r_tag_work');
        await db.knex.schema.raw('DROP TABLE IF EXISTS r_va_work');
        await db.knex.schema.raw('DROP TABLE IF EXISTS r_illustrator_work');
        await db.knex.schema.raw('DROP TABLE IF EXISTS r_script_writer_work');
        await db.knex.schema.raw('DROP TABLE IF EXISTS r_series_work');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_review');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_play_history');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_work');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_tag');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_va');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_illustrator');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_script_writer');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_series');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_circle');
        await db.knex.schema.raw('DROP TABLE IF EXISTS t_user');
        await db.knex.schema.raw('DROP TABLE IF EXISTS knex_migrations');
      } catch (e) {
        // ignore cleanup errors
      }
    }

    // Create schema
    await createSchema();

    // Create a circle (UUID id)
    defaultCircleId = nameToUUID('测试社团');
    await db.knex.raw('INSERT OR IGNORE INTO t_circle(id, name) VALUES (?, ?)', [defaultCircleId, '测试社团']);

    // Insert a work (explicit string id)
    workId = '123456';
    await db.knex('t_work').insert({
      id: workId,
      root_folder: 'default',
      dir: 'test_dir',
      title: '原始标题',
      circle_id: defaultCircleId,
      nsfw: false,
      release: '2020-01-01',
      dl_count: 100,
      price: 500,
      review_count: 10,
      rate_count: 20,
      rate_average_2dp: 3.5,
      rate_count_detail: JSON.stringify([{ review_point: 5, count: 5 }]),
      rank: null,
    });

    // Tag
    const tagId = nameToUUID('测试标签');
    await db.knex.raw('INSERT OR IGNORE INTO t_tag(id, name) VALUES (?, ?)', [tagId, '测试标签']);
    await db.knex('r_tag_work').insert({ tag_id: tagId, work_id: workId });

    // VA
    const vaId = nameToUUID('测试声优');
    await db.knex.raw('INSERT OR IGNORE INTO t_va(id, name) VALUES (?, ?)', [vaId, '测试声优']);
    await db.knex('r_va_work').insert({ va_id: vaId, work_id: workId });

    // Illustrator
    const illId = nameToUUID('测试画师');
    await db.knex.raw('INSERT OR IGNORE INTO t_illustrator(id, name) VALUES (?, ?)', [illId, '测试画师']);
    await db.knex('r_illustrator_work').insert({ illustrator_id: illId, work_id: workId });

    // Script writer
    const swId = nameToUUID('测试脚本');
    await db.knex.raw('INSERT OR IGNORE INTO t_script_writer(id, name) VALUES (?, ?)', [swId, '测试脚本']);
    await db.knex('r_script_writer_work').insert({ script_writer_id: swId, work_id: workId });

    // Series
    const seriesId = nameToUUID('测试系列');
    await db.knex.raw('INSERT OR IGNORE INTO t_series(id, name) VALUES (?, ?)', [seriesId, '测试系列']);
    await db.knex('r_series_work').insert({ series_id: seriesId, work_id: workId });
  });

  it('1. Core fields: edit title/nsfw/release', async function () {
    await db.editWorkMetadata(workId, {
      title: '新标题',
      nsfw: true,
      release: '2024-06-15',
      circle: '测试社团',
      tags: [{ name: '测试标签' }],
      vas: [{ name: '测试声优' }],
      illustrators: [{ name: '测试画师' }],
      scriptWriters: [{ name: '测试脚本' }],
      series: { name: '测试系列' },
    });

    const work = await db.knex('t_work').select('title', 'nsfw', 'release').where('id', workId).first();
    expect(work.title).to.equal('新标题');
    expect(work.nsfw).to.equal(1); // SQLite stores boolean as 0/1
    expect(work.release).to.equal('2024-06-15');
  });

  it('2. New label by name: add a new tag', async function () {
    await db.editWorkMetadata(workId, {
      title: '新标题',
      nsfw: true,
      release: '2024-06-15',
      circle: '测试社团',
      tags: [{ name: '测试标签' }, { name: '全新标签' }],
      vas: [{ name: '测试声优' }],
      illustrators: [{ name: '测试画师' }],
      scriptWriters: [{ name: '测试脚本' }],
      series: { name: '测试系列' },
    });

    // Check new tag exists in t_tag
    const newTag = await db.knex('t_tag').select('id', 'name').where('name', '全新标签').first();
    expect(newTag).to.not.be.undefined;
    expect(newTag.name).to.equal('全新标签');

    // Check relationship exists
    const link = await db.knex('r_tag_work').select('tag_id').where({ tag_id: newTag.id, work_id: workId }).first();
    expect(link).to.not.be.undefined;
  });

  it('3. Reuse existing label: duplicate tag name does not create duplicate t_tag row', async function () {
    // Count existing tags
    const before = await db.knex('t_tag').select('id').where('name', '全新标签');

    await db.editWorkMetadata(workId, {
      title: '新标题',
      nsfw: true,
      release: '2024-06-15',
      circle: '测试社团',
      tags: [{ name: '全新标签' }],
      vas: [{ name: '测试声优' }],
      illustrators: [{ name: '测试画师' }],
      scriptWriters: [{ name: '测试脚本' }],
      series: { name: '测试系列' },
    });

    const after = await db.knex('t_tag').select('id').where('name', '全新标签');
    expect(after.length).to.equal(before.length);
  });

  it('4. Clear list: tags=[] deletes all r_tag_work rows and orphans unused tag', async function () {
    // First count tag links
    const beforeLinks = await db.knex('r_tag_work').select('tag_id').where('work_id', workId);
    expect(beforeLinks.length).to.be.at.least(1);

    // Count t_tag rows before
    const beforeTags = await db.knex('t_tag').select('id');

    await db.editWorkMetadata(workId, {
      title: '新标题',
      nsfw: true,
      release: '2024-06-15',
      circle: '测试社团',
      tags: [],
      vas: [{ name: '测试声优' }],
      illustrators: [{ name: '测试画师' }],
      scriptWriters: [{ name: '测试脚本' }],
      series: { name: '测试系列' },
    });

    const afterLinks = await db.knex('r_tag_work').select('tag_id').where('work_id', workId);
    expect(afterLinks.length).to.equal(0);

    // The "全新标签" tag should be orphaned and removed
    const orphan = await db.knex('t_tag').select('id').where('name', '全新标签').first();
    expect(orphan).to.be.undefined;
  });

  it('5. Circle reassign: change circle name', async function () {
    const oldCircleId = await db.knex('t_work').select('circle_id').where('id', workId).first().then(r => r.circle_id);

    await db.editWorkMetadata(workId, {
      title: '新标题',
      nsfw: true,
      release: '2024-06-15',
      circle: '新社团',
      tags: [],
      vas: [{ name: '测试声优' }],
      illustrators: [{ name: '测试画师' }],
      scriptWriters: [{ name: '测试脚本' }],
      series: { name: '测试系列' },
    });

    const newCircle = await db.knex('t_circle').select('id', 'name').where('name', '新社团').first();
    expect(newCircle).to.not.be.undefined;

    const workCircle = await db.knex('t_work').select('circle_id').where('id', workId).first();
    expect(workCircle.circle_id).to.equal(newCircle.id);

    // Old circle should be pruned if unused
    const oldCircle = await db.knex('t_circle').select('id').where('id', oldCircleId).first();
    if (oldCircleId !== newCircle.id) {
      expect(oldCircle).to.be.undefined;
    }
  });

  it('6. Series unset: series=null removes r_series_work row', async function () {
    await db.editWorkMetadata(workId, {
      title: '新标题',
      nsfw: true,
      release: '2024-06-15',
      circle: '新社团',
      tags: [],
      vas: [{ name: '测试声优' }],
      illustrators: [{ name: '测试画师' }],
      scriptWriters: [{ name: '测试脚本' }],
      series: null,
    });

    const link = await db.knex('r_series_work').select('series_id').where('work_id', workId).first();
    expect(link).to.be.undefined;
  });

  it('7. Transaction atomicity: error mid-way does not persist partial writes', async function () {
    // Put some data back first
    await db.editWorkMetadata(workId, {
      title: '原子测试',
      nsfw: false,
      release: '2023-01-01',
      circle: '新社团',
      tags: [{ name: '原子标签' }],
      vas: [{ name: '测试声优' }],
      illustrators: [{ name: '测试画师' }],
      scriptWriters: [{ name: '测试脚本' }],
      series: null,
    });

    // Verify initial state
    let work = await db.knex('t_work').select('title').where('id', workId).first();
    expect(work.title).to.equal('原子测试');

    // Attempt an edit that will fail (e.g. circle name unusually long shouldn't fail - let's use a bad type)
    // SQLite doesn't enforce types strictly. Let's try passing an undefined series that causes our code issue.
    // Actually, the simplest way: try calling with data that would fail in a unique constraint
    // Since t_tag name is not unique by constraint, let's just test the transaction rolls back on error
    // by passing an undefined value that causes a crash.
    let threw = false;
    try {
      // Force an error by passing null for title which should be validated upstream but calling directly
      // The resolveCircle should fail if we pass null... no it won't since it's already validated.
      // Let's just verify the function doesn't leave partial state when it throws for another reason.
      // Pass a bad circle type that will cause an unhandled error
      await db.editWorkMetadata(workId, {
        title: '不应该生效',
        nsfw: false,
        release: null,
        circle: null, // This will cause an error in resolveCircle
        tags: [],
        vas: [],
        illustrators: [],
        scriptWriters: [],
        series: null,
      });
    } catch (err) {
      threw = true;
    }
    expect(threw).to.be.true;

    // Verify data wasn't changed
    work = await db.knex('t_work').select('title').where('id', workId).first();
    expect(work.title).to.equal('原子测试');
  });

  it('8. New label by name: add new VA/illustrator/scriptWriter with brand-new name', async function () {
    await db.editWorkMetadata(workId, {
      title: '新标签测试',
      nsfw: false,
      release: '2023-01-01',
      circle: '新社团',
      tags: [],
      vas: [{ name: '测试声优' }, { name: '全新声优' }],
      illustrators: [{ name: '全新画师' }],
      scriptWriters: [{ name: '全新脚本' }],
      series: null,
    });

    // Check new VA
    const vaId = nameToUUID('全新声优');
    const va = await db.knex('t_va').select('id', 'name').where('id', vaId).first();
    expect(va).to.not.be.undefined;
    expect(va.name).to.equal('全新声优');

    const vaLink = await db.knex('r_va_work').select('va_id').where({ va_id: vaId, work_id: workId }).first();
    expect(vaLink).to.not.be.undefined;

    // Check new illustrator
    const illId = nameToUUID('全新画师');
    const ill = await db.knex('t_illustrator').select('id', 'name').where('id', illId).first();
    expect(ill).to.not.be.undefined;
    expect(ill.name).to.equal('全新画师');

    // Check new script writer
    const swId = nameToUUID('全新脚本');
    const sw = await db.knex('t_script_writer').select('id', 'name').where('id', swId).first();
    expect(sw).to.not.be.undefined;
    expect(sw.name).to.equal('全新脚本');
  });
});

describe('updateWorkMetadata refresh merge semantics', function () {
  this.timeout(10000);

  let workId;
  const origCircleName = '原始刷新社团';

  before('Setup work for refresh merge tests', async function () {
    // Create a circle
    const circleId = nameToUUID(origCircleName);
    await db.knex.raw('INSERT OR IGNORE INTO t_circle(id, name) VALUES (?, ?)', [circleId, origCircleName]);

    // Insert a work with only basic fields, empty title placeholder, no release, no VAs
    workId = '654321';
    await db.knex('t_work').insert({
      id: workId,
      root_folder: 'default',
      dir: 'refresh_test_dir',
      title: '',
      circle_id: circleId,
      nsfw: false,
      release: '',
      dl_count: 50,
      price: 300,
      review_count: 5,
      rate_count: 10,
      rate_average_2dp: 4.0,
      rate_count_detail: JSON.stringify([{ review_point: 4, count: 8 }]),
      rank: null,
    });

    // Manually edit: set title and add a custom VA
    await db.editWorkMetadata(workId, {
      title: '手动编辑的标题',
      nsfw: false,
      release: '',
      circle: origCircleName,
      tags: [],
      vas: [{ name: '手动添加的声优' }],
      illustrators: [],
      scriptWriters: [],
      series: null,
    });
  });

  it('9. Refresh merge: after manual edit, refreshAll merges (title stays, VA additive)', async function () {
    // Simulate DLsite data
    const dlsiteData = {
      id: workId,
      title: 'DLsite标题',
      nsfw: true,
      release: '2025-01-01',
      circle: { id: null, name: origCircleName },
      vas: [{ id: nameToUUID('DLsite声优'), name: 'DLsite声优' }],
      illustrators: [],
      scriptWriters: [],
      series: null,
      tags: [],
      dl_count: 200,
      price: 1000,
      review_count: 20,
      rate_count: 30,
      rate_average_2dp: 4.5,
      rate_count_detail: [{ review_point: 5, count: 25 }],
      rank: null,
    };

    await db.updateWorkMetadata(dlsiteData, { refreshAll: true });

    // Title should NOT be overwritten (gap-fill: existing title is non-empty)
    const work = await db.knex('t_work').select('title', 'nsfw', 'release').where('id', workId).first();
    expect(work.title).to.equal('手动编辑的标题');
    // nsfw: was false (0), now refresh tries to set true, but gap-fill only fills null
    // Since cur.nsfw = 0 (not null), it should NOT be overwritten
    expect(work.nsfw).to.equal(0);
    // release was '' (falsy), so gap-fill should write '2025-01-01'
    expect(work.release).to.equal('2025-01-01');

    // Manually-added VA should still be linked (additive)
    const manualVaId = nameToUUID('手动添加的声优');
    const manualLink = await db.knex('r_va_work').select('va_id').where({ va_id: manualVaId, work_id: workId }).first();
    expect(manualLink).to.not.be.undefined;

    // DLsite VA should also be linked
    const dlsiteVaId = nameToUUID('DLsite声优');
    const dlsiteLink = await db.knex('r_va_work').select('va_id').where({ va_id: dlsiteVaId, work_id: workId }).first();
    expect(dlsiteLink).to.not.be.undefined;

    // Stats should be updated
    const stats = await db.knex('t_work').select('dl_count', 'price').where('id', workId).first();
    expect(stats.dl_count).to.equal(200);
    expect(stats.price).to.equal(1000);
  });

  it('10. Refresh gap-fill: empty release gets filled, non-empty title stays', async function () {
    // release is already '2025-01-01' from previous test - non-empty stays
    // Create a new work with empty release
    const circleId = nameToUUID('gap测试社团');
    await db.knex.raw('INSERT OR IGNORE INTO t_circle(id, name) VALUES (?, ?)', [circleId, 'gap测试社团']);
    const gapWorkId = '789012';
    await db.knex('t_work').insert({
      id: gapWorkId,
      root_folder: 'default',
      dir: 'gap_test_dir',
      title: '已有标题',
      circle_id: circleId,
      nsfw: false,
      release: '',
      dl_count: 0,
      price: 0,
      review_count: 0,
      rate_count: 0,
      rate_average_2dp: 0,
      rate_count_detail: JSON.stringify([]),
      rank: null,
    });

    // Refresh with DLsite data that has a release date
    await db.updateWorkMetadata({
      id: gapWorkId,
      title: '已有标题',
      nsfw: false,
      release: '2024-12-25',
      circle: { id: null, name: 'gap测试社团' },
      vas: [],
      illustrators: [],
      scriptWriters: [],
      series: null,
      tags: [],
      dl_count: 10,
      price: 100,
      review_count: 1,
      rate_count: 2,
      rate_average_2dp: 3.0,
      rate_count_detail: [{ review_point: 3, count: 2 }],
      rank: null,
    }, { refreshAll: true });

    // release was '' -> should be filled to '2024-12-25'
    const work = await db.knex('t_work').select('release', 'title').where('id', gapWorkId).first();
    expect(work.release).to.equal('2024-12-25');
    // title was already '已有标题' -> stays
    expect(work.title).to.equal('已有标题');
  });

  it('11. CLI flag includeVA still deletes+reinserts (regression guard)', async function () {
    // First: add a custom VA and a DLsite VA via refreshAll merge
    const dlsiteVaId = nameToUUID('DLsite声优');
    const customVaId = nameToUUID('手动添加的声优');

    // Now simulate CLI with includeVA flag
    const dlsiteData = {
      id: workId,
      title: 'DLsite标题',
      nsfw: true,
      release: '2025-01-01',
      circle: { id: null, name: origCircleName },
      vas: [{ id: dlsiteVaId, name: 'DLsite声优' }],
      illustrators: [],
      scriptWriters: [],
      series: null,
      tags: [],
      dl_count: 200,
      price: 1000,
      review_count: 20,
      rate_count: 30,
      rate_average_2dp: 4.5,
      rate_count_detail: [{ review_point: 5, count: 25 }],
      rank: null,
    };

    await db.updateWorkMetadata(dlsiteData, { includeVA: true });

    // The manually-added VA should NO longer be linked (deleted by includeVA)
    const manualLink = await db.knex('r_va_work').select('va_id').where({ va_id: customVaId, work_id: workId }).first();
    expect(manualLink).to.be.undefined;

    // The DLsite VA should be linked
    const dlsiteLink = await db.knex('r_va_work').select('va_id').where({ va_id: dlsiteVaId, work_id: workId }).first();
    expect(dlsiteLink).to.not.be.undefined;
  });
});

after('Tear down test database', async function () {
  // Drop all schema objects we created so other test files in the suite
  // (e.g. test/migration..js) start from a clean slate. Each drop is its own
  // try/catch so one failure does not abort the rest of the cleanup.
  // NOTE: do NOT call db.knex.destroy() here — the `db` module is a singleton
  // shared across the whole Mocha run; destroying it would break later test
  // files. test/migration..js owns the final knex teardown for the suite.
  const dropList = [
    'DROP VIEW IF EXISTS staticMetadata',
    'DROP TABLE IF EXISTS r_tag_work',
    'DROP TABLE IF EXISTS r_va_work',
    'DROP TABLE IF EXISTS r_illustrator_work',
    'DROP TABLE IF EXISTS r_script_writer_work',
    'DROP TABLE IF EXISTS r_series_work',
    'DROP TABLE IF EXISTS t_review',
    'DROP TABLE IF EXISTS t_play_history',
    'DROP TABLE IF EXISTS t_work',
    'DROP TABLE IF EXISTS t_tag',
    'DROP TABLE IF EXISTS t_va',
    'DROP TABLE IF EXISTS t_illustrator',
    'DROP TABLE IF EXISTS t_script_writer',
    'DROP TABLE IF EXISTS t_series',
    'DROP TABLE IF EXISTS t_circle',
    'DROP TABLE IF EXISTS t_user',
    'DROP TABLE IF EXISTS knex_migrations',
  ];
  for (const stmt of dropList) {
    try {
      await db.knex.schema.raw(stmt);
    } catch (e) {
      // ignore individual drop failures
    }
  }

  // Intentionally do NOT unlink db-test.sqlite3 here: the file is shared with
  // test/migration..js, and unlinking it while the knex pool still holds an
  // open fd leaves a deleted inode whose schema is stale, causing the
  // migration test's createOldSchema to fail with "table already exists".
  // Leaving the (now-empty) file in place lets the migration test own final
  // teardown; this file's own `before` hook drops any leftover schema on rerun.
});

}); // close wrapper 'edit-metadata suite' describe