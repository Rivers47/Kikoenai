//eslint-disable-next-line n/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const { transcodeFileName } = require('../filesystem/utils');

// The cache key must cover everything the transcoded output depends on: which
// file, which version of it, and the encode settings. Miss one and the cache
// serves the wrong bytes indefinitely -- nothing cleans this directory up.
describe('transcodeFileName()', function(){
  const base = () => transcodeFileName('123456', 'SE/01 intro.wav', 1699999999000, '96k');

  it('is deterministic for the same file, version and settings', function() {
    expect(base()).to.equal(base());
    expect(base()).to.match(/^123456_[0-9a-f]{16}\.opus$/);
  });

  it('supports Fanza-style ids', function() {
    expect(transcodeFileName('d215444', '01.wav', 1, '96k')).to.match(/^d215444_[0-9a-f]{16}\.opus$/);
  });

  it('changes when the source file changes', function() {
    expect(transcodeFileName('123456', 'SE/02 main.wav', 1699999999000, '96k')).to.not.equal(base());
  });

  // The bug this replaced: the key was the source content hash alone, so
  // changing config.transcodeBitrate kept serving the old bitrate from cache.
  it('changes when the bitrate changes', function() {
    expect(transcodeFileName('123456', 'SE/01 intro.wav', 1699999999000, '128k')).to.not.equal(base());
  });

  it('changes when the source is re-encoded in place (mtime moves)', function() {
    expect(transcodeFileName('123456', 'SE/01 intro.wav', 1700000000000, '96k')).to.not.equal(base());
  });

  // A relPath carries slashes, spaces and unicode; the digest keeps all of that
  // out of the filename without reading the audio to hash it.
  it('keeps a nested non-ASCII path out of the filename', function() {
    const name = transcodeFileName('123456', '絶頂トレーニング/01 囁き♡.wav', 1, '96k');
    expect(name).to.match(/^123456_[0-9a-f]{16}\.opus$/);
  });
});
