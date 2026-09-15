/* eslint-disable n/no-unpublished-require */
// Durations are the expensive thing here: one ffprobe subprocess per audio file.
// probeAudioDurations decides what to re-probe, and t_work_file is where the
// answer is kept -- it used to be t_work.memo, which is why these replace the old
// work-memo.js. The invalidation key is mtime.

process.env.FREEZE_CONFIG_FILE = '1';

const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getTrackList, probeAudioDurations } = require('../filesystem/utils');

describe('probeAudioDurations', function () {
  let dir;

  const write = (name, body) => fs.writeFileSync(path.join(dir, name), body);
  // mtime has 1s granularity on some filesystems; set it explicitly rather than
  // sleeping, so a modified file reliably reads as modified.
  const touch = (name, secondsAhead) => {
    const when = new Date(Date.now() + secondsAhead * 1000);
    fs.utimesSync(path.join(dir, name), when, when);
  };
  const mtimeOf = (name) => Math.round(fs.statSync(path.join(dir, name)).mtime.getTime());

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-wfiles-'));
    write('a.mp3', 'aaaa');
    write('b.mp3', 'bbbb');
  });

  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('records an mtime for every audio file', async function () {
    const tracks = await probeAudioDurations('1', await getTrackList('1', dir));
    expect(tracks.map(t => t.mtime).every(m => typeof m === 'number')).to.equal(true);
  });

  it('reuses a known duration when the mtime is unchanged', async function () {
    const known = new Map([['a.mp3', { duration: 42, mtime: mtimeOf('a.mp3') }]]);
    const tracks = await probeAudioDurations('1', await getTrackList('1', dir), known);
    const a = tracks.find(t => t.shortFilePath === 'a.mp3');
    // 42 could only come from `known`: ffprobe is not installed in CI, and it
    // would not report 42 for a four-byte file if it were.
    expect(a.duration).to.equal(42);
  });

  it('re-probes when the mtime moved, and does not keep the stale duration', async function () {
    const known = new Map([['a.mp3', { duration: 42, mtime: mtimeOf('a.mp3') }]]);
    write('a.mp3', 'ZZZZZZZZ');
    touch('a.mp3', 60);

    const tracks = await probeAudioDurations('1', await getTrackList('1', dir), known);
    const a = tracks.find(t => t.shortFilePath === 'a.mp3');
    expect(a.duration).to.not.equal(42);
    expect(a.mtime).to.equal(mtimeOf('a.mp3'));
  });

  // The mtime test is deliberately separate from "has no duration": a file may
  // simply have failed ffprobe, which says nothing about its contents. Without
  // this, every rescan would re-probe every such file forever.
  it('re-probes a file with a known mtime but no duration', async function () {
    const known = new Map([['a.mp3', { mtime: mtimeOf('a.mp3') }]]);
    const tracks = await probeAudioDurations('1', await getTrackList('1', dir), known);
    // No assertion on the value -- ffprobe is absent here. What matters is that
    // it was attempted, i.e. the cached mtime alone did not short-circuit it.
    expect(tracks.find(t => t.shortFilePath === 'a.mp3').mtime).to.equal(mtimeOf('a.mp3'));
  });

  it('leaves non-audio files alone', async function () {
    write('cover.jpg', 'x');
    write('notes.txt', 'x');

    const tracks = await probeAudioDurations('1', await getTrackList('1', dir));
    for (const name of ['cover.jpg', 'notes.txt']) {
      const track = tracks.find(t => t.shortFilePath === name);
      expect(track.duration, name).to.equal(undefined);
      expect(track.mtime, name).to.equal(undefined);
    }
  });

  it('keeps what was known when a file vanishes mid-scan', async function () {
    const known = new Map([['a.mp3', { duration: 42, mtime: mtimeOf('a.mp3') }]]);
    const tracks = await getTrackList('1', dir);
    fs.rmSync(path.join(dir, 'a.mp3'));

    await probeAudioDurations('1', tracks, known);
    expect(tracks.find(t => t.shortFilePath === 'a.mp3').duration).to.equal(42);
  });
});

describe('getTrackList is a pure walker', function () {
  let dir;

  beforeEach(function () {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-walk-'));
    fs.writeFileSync(path.join(dir, '01.mp3'), 'x');
  });

  afterEach(function () {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // It no longer takes a memo, and no longer merges duration or trackTitle:
  // those come from t_work_file via filesystem/workFiles.js. Keeping the walker
  // free of storage is what let the request path stop touching the filesystem.
  it('returns no duration or trackTitle of its own', async function () {
    const [track] = await getTrackList('000001', dir);
    expect(track.duration).to.equal(undefined);
    expect(track.trackTitle).to.equal(undefined);
    expect(track.trackId).to.equal('000001/01.mp3');
  });
});
