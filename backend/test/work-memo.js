// Config is loaded transitively through filesystem/utils; keep it off disk.
process.env.FREEZE_CONFIG_FILE = '1';

//eslint-disable-next-line n/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const os = require('os');
const path = require('path');
const { scrapeWorkMemo, getTrackList } = require('../filesystem/utils');

// setWorkMemo replaces the whole t_work.memo column, so every producer has to
// carry the keys it does not own. These are the rules that keep a rescan from
// silently wiping what another writer put there.
describe('work memo: rescans', function () {
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

  it('records an mtime for every audio file', async function () {
    const memo = await scrapeWorkMemo('1', dir, null);
    expect(Object.keys(memo.mtime)).to.have.members(['a.mp3', 'b.mp3']);
  });

  it('preserves trackTitles across a rescan', async function () {
    const memo = await scrapeWorkMemo('1', dir, { trackTitles: { 'a.mp3': 'Track One' } });
    expect(memo.trackTitles).to.deep.equal({ 'a.mp3': 'Track One' });
  });

  it('reuses a cached duration and refreshes a modified file\'s mtime', async function () {
    const first = await scrapeWorkMemo('1', dir, null);
    first.duration = { 'a.mp3': 12, 'b.mp3': 34 };

    write('a.mp3', 'ZZZZZZZZ');
    touch('a.mp3', 60);
    const second = await scrapeWorkMemo('1', dir, first);

    // b.mp3 is untouched, so its cached duration survives without an ffprobe.
    expect(second.duration['b.mp3']).to.equal(34);
    expect(second.mtime['a.mp3']).to.not.equal(first.mtime['a.mp3']);
    expect(second.mtime['b.mp3']).to.equal(first.mtime['b.mp3']);
  });

  it('flags a work that contains a lyric file', async function () {
    expect((await scrapeWorkMemo('1', dir, null)).isContainLyric).to.equal(false);
    write('a.lrc', '[00:00.00]x');
    expect((await scrapeWorkMemo('1', dir, null)).isContainLyric).to.equal(true);
  });

  // The memo maps and the track list must agree on how a file is spelled, or
  // every cached duration and track title misses.
  it('keys the memo the same way getTrackList keys a track', async function () {
    fs.mkdirSync(path.join(dir, 'SE'));
    fs.writeFileSync(path.join(dir, 'SE', 'c.mp3'), 'cccc');

    const memo = await scrapeWorkMemo('1', dir, null);
    const tracks = await getTrackList('1', dir, memo);
    const relPaths = tracks.map(t => t.shortFilePath);

    expect(relPaths).to.include('SE/c.mp3');
    for (const key of Object.keys(memo.mtime)) {
      expect(relPaths).to.include(key);
    }
  });
});
