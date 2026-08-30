// Config is loaded transitively through filesystem/utils; keep it off disk.
process.env.FREEZE_CONFIG_FILE = '1';

//eslint-disable-next-line n/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scrapeWorkHashes, scrapeWorkMemo } = require('../filesystem/utils');

// Content hashes are computed inline by GET /api/tracks/:id and cached in
// t_work.memo, so the caching rules below are what keep that endpoint from
// re-reading every audio byte on every page open.
describe('work memo: content hashes and rescans', function () {
  let dir;

  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  // mtime has 1s granularity on some filesystems; bump it explicitly rather
  // than sleeping so a modified file reliably reads as modified.
  const touch = (name, secondsAhead) => {
    const when = new Date(Date.now() + secondsAhead * 1000);
    fs.utimesSync(path.join(dir, name), when, when);
  };

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-memo-'));
    write('a.mp3', 'aaaa');
    write('b.mp3', 'bbbb');
  });

  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('hashes a work whose memo is null, and caches on the second pass', async function () {
    // t_work.memo is NULL for a work that was never scraped; JSON.parse gives
    // null, which must not throw.
    const first = await scrapeWorkHashes('1', dir, null);
    expect(first.changed).to.equal(true);
    expect(Object.keys(first.memo.contentHash)).to.have.members(['a.mp3', 'b.mp3']);

    const second = await scrapeWorkHashes('1', dir, first.memo);
    expect(second.changed).to.equal(false);
    expect(second.memo.contentHash).to.deep.equal(first.memo.contentHash);
  });

  it('returns the walked file list so the caller need not re-read the directory', async function () {
    const { files } = await scrapeWorkHashes('1', dir, null);
    expect(files.map(f => path.basename(f))).to.have.members(['a.mp3', 'b.mp3']);
  });

  it('keeps hashing the rest of the work when one file cannot be read', async function () {
    // Unreadable files must degrade to a missing badge, not a 500 on the whole
    // file list -- hashing now runs inline in the tree endpoint.
    write('c.mp3', 'cccc');
    fs.chmodSync(path.join(dir, 'c.mp3'), 0o000);
    try {
      const { memo } = await scrapeWorkHashes('1', dir, null);
      expect(memo.contentHash['a.mp3']).to.be.a('string');
      expect(memo.contentHash['b.mp3']).to.be.a('string');
      expect(memo.contentHash['c.mp3']).to.equal(undefined);
    } finally {
      fs.chmodSync(path.join(dir, 'c.mp3'), 0o644);
    }
  });

  it('preserves contentHash and trackTitles across a rescan', async function () {
    // setWorkMemo overwrites the whole column, so scrapeWorkMemo must carry
    // these through rather than building a fresh object.
    const { memo } = await scrapeWorkHashes('1', dir, null);
    memo.trackTitles = { 'a.mp3': 'Track One' };

    const rescanned = await scrapeWorkMemo('1', dir, memo);
    expect(rescanned.contentHash).to.deep.equal(memo.contentHash);
    expect(rescanned.trackTitles).to.deep.equal({ 'a.mp3': 'Track One' });
  });

  it('drops only the modified file\'s hash on a rescan', async function () {
    const { memo } = await scrapeWorkHashes('1', dir, null);
    const originalA = memo.contentHash['a.mp3'];

    write('a.mp3', 'ZZZZZZZZ');
    touch('a.mp3', 60);
    const rescanned = await scrapeWorkMemo('1', dir, memo);
    // Without this the rescan would write a fresh mtime next to the stale hash,
    // and scrapeWorkHashes would treat that hash as still valid forever.
    expect(rescanned.contentHash['a.mp3']).to.equal(undefined);
    expect(rescanned.contentHash['b.mp3']).to.equal(memo.contentHash['b.mp3']);

    const after = await scrapeWorkHashes('1', dir, rescanned);
    expect(after.memo.contentHash['a.mp3']).to.be.a('string');
    expect(after.memo.contentHash['a.mp3']).to.not.equal(originalA);
  });

  it('leaves every file hashed when the scanner chains memo then hashes', async function () {
    // The scanner warms hashes so GET /api/tracks/:id never has to compute
    // them. Order matters: scrapeWorkMemo rewrites mtimes and drops the hashes
    // of changed files, so hashing first would throw the fresh hashes away.
    let memo = await scrapeWorkMemo('1', dir, {});
    ({ memo } = await scrapeWorkHashes('1', dir, memo));
    expect(Object.keys(memo.contentHash)).to.have.members(['a.mp3', 'b.mp3']);

    // A later scan pass re-warms a modified file and leaves the rest cached.
    write('a.mp3', 'ZZZZZZZZ');
    touch('a.mp3', 60);
    const before = memo.contentHash['a.mp3'];
    memo = await scrapeWorkMemo('1', dir, memo);
    const rewarmed = await scrapeWorkHashes('1', dir, memo);
    expect(rewarmed.memo.contentHash['a.mp3']).to.not.equal(before);
    expect(rewarmed.memo.contentHash['b.mp3']).to.be.a('string');

    // With the work warm, opening it reads nothing.
    const onOpen = await scrapeWorkHashes('1', dir, rewarmed.memo);
    expect(onOpen.changed).to.equal(false);
  });

  it('keeps the hash of a file that merely has no duration', async function () {
    // The rescan's update branch also fires when ffprobe failed and left no
    // duration. That says nothing about the file's contents, so re-reading
    // every such file on every rescan would be pure waste.
    const { memo } = await scrapeWorkHashes('1', dir, null);
    delete memo.duration;

    const rescanned = await scrapeWorkMemo('1', dir, memo);
    expect(rescanned.contentHash).to.deep.equal(memo.contentHash);
  });
});
