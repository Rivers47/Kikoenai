// Config is loaded transitively through filesystem/utils; keep it off disk.
process.env.FREEZE_CONFIG_FILE = '1';

//eslint-disable-next-line n/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const path = require('path');
const { findLyricTracks } = require('../routes/utils/lyrics');

// Build a track list shaped like getTrackList()'s output from bare filenames.
const trackList = (...names) => names.map((name, index) => {
  const slash = name.lastIndexOf('/');
  return {
    title: slash === -1 ? name : name.substring(slash + 1),
    subtitle: slash === -1 ? null : name.substring(0, slash),
    trackId: `1/${index}`,
    ext: path.extname(name).toLowerCase(),
  };
});

const findFor = (name, tracks) => findLyricTracks(tracks.find(t => t.title === name), tracks);

describe('findLyricTracks()', function () {
  it('finds the stem-form sidecar', function () {
    const tracks = trackList('01 Track.mp3', '01 Track.lrc');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([
      { trackId: '1/1', lyricExtension: '.lrc' },
    ]);
  });

  it('finds the full-filename sidecar and an uppercase extension', function () {
    const tracks = trackList('01 Track.mp3', '01 Track.mp3.LRC');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([
      { trackId: '1/1', lyricExtension: '.lrc' },
    ]);
  });

  it('prefers the stem form over the full-filename form', function () {
    const tracks = trackList('01 Track.mp3', '01 Track.lrc', '01 Track.mp3.lrc');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([
      { trackId: '1/1', lyricExtension: '.lrc' },
    ]);
  });

  it('prefers .lrc over .srt over .vtt for the same speaker', function () {
    const tracks = trackList('01 Track.mp3', '01 Track.vtt', '01 Track.srt', '01 Track.lrc');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([
      { trackId: '1/3', lyricExtension: '.lrc' },
    ]);
  });

  it('returns numbered speaker files in numeric order', function () {
    const tracks = trackList('01 Track.mp3', '01 Track.2.srt', '01 Track.10.srt', '01 Track.1.srt');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([
      { trackId: '1/3', lyricExtension: '.srt' },
      { trackId: '1/1', lyricExtension: '.srt' },
      { trackId: '1/2', lyricExtension: '.srt' },
    ]);
  });

  it('accepts numbered files in the full-filename form too', function () {
    const tracks = trackList('01 Track.mp3', '01 Track.mp3.1.vtt', '01 Track.mp3.2.vtt');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([
      { trackId: '1/1', lyricExtension: '.vtt' },
      { trackId: '1/2', lyricExtension: '.vtt' },
    ]);
  });

  it('ignores the unnumbered transcript when numbered files exist', function () {
    const tracks = trackList('01 Track.mp3', '01 Track.lrc', '01 Track.1.lrc', '01 Track.2.lrc');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([
      { trackId: '1/2', lyricExtension: '.lrc' },
      { trackId: '1/3', lyricExtension: '.lrc' },
    ]);
  });

  it('does not claim a numbered lyric that belongs to another track', function () {
    // "01.2.lrc" is the lyric of "01.2.mp3", not speaker 2 of "01.mp3".
    const tracks = trackList('01.mp3', '01.2.mp3', '01.2.lrc');
    expect(findFor('01.mp3', tracks)).to.deep.equal([]);
    expect(findFor('01.2.mp3', tracks)).to.deep.equal([
      { trackId: '1/2', lyricExtension: '.lrc' },
    ]);
  });

  it('only matches lyrics sitting in the track\'s own folder', function () {
    const tracks = trackList('cd1/01 Track.mp3', 'cd2/01 Track.1.lrc', 'cd1/01 Track.1.lrc');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([
      { trackId: '1/2', lyricExtension: '.lrc' },
    ]);
  });

  it('treats regex metacharacters in the filename literally', function () {
    const tracks = trackList('0+1 (a).mp3', '0+1 (a).1.lrc', '0X1 (a).1.lrc');
    expect(findFor('0+1 (a).mp3', tracks)).to.deep.equal([
      { trackId: '1/1', lyricExtension: '.lrc' },
    ]);
  });

  it('does not let a non-media sibling disqualify a speaker file', function () {
    // "01 Track.1.txt" is a plain text file; it cannot own "01 Track.1.lrc".
    const tracks = trackList('01 Track.mp3', '01 Track.1.txt', '01 Track.1.lrc', '01 Track.2.lrc');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([
      { trackId: '1/2', lyricExtension: '.lrc' },
      { trackId: '1/3', lyricExtension: '.lrc' },
    ]);
  });

  it('ignores unrelated and unsupported files', function () {
    const tracks = trackList('01 Track.mp3', '01 Track.ass', '01 Track.txt', '02 Track.lrc', 'readme.lrc');
    expect(findFor('01 Track.mp3', tracks)).to.deep.equal([]);
  });

  it('returns nothing when the track has no lyrics', function () {
    expect(findFor('01 Track.mp3', trackList('01 Track.mp3'))).to.deep.equal([]);
  });
});
