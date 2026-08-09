//eslint-disable-next-line n/no-unpublished-require
const chai = require('chai');
const expect = chai.expect;
const { transcodeFileName } = require('../filesystem/utils');

describe('transcodeFileName()', function(){
  it('should key the cache filename off both work id and content hash', function() {
    expect(transcodeFileName('123456', 'a1b2c3d4')).to.equal('123456_a1b2c3d4.opus');
  });

  it('should support Fanza-style d_-prefixed ids', function() {
    expect(transcodeFileName('d_215444', 'deadbeef')).to.equal('d_215444_deadbeef.opus');
  });

  it('should produce a different filename when the content hash changes', function() {
    const before = transcodeFileName('123456', 'a1b2c3d4');
    const after = transcodeFileName('123456', 'deadbeef');
    expect(before).to.not.equal(after);
  });
});
