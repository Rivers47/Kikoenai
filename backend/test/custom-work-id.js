/* eslint-disable n/no-unpublished-require */
// Custom work identity: a UUID derived from where the folder is, not from what
// it says. These pin the two properties the whole feature rests on -- stability
// across platforms, and change exactly when the folder moves.
process.env.FREEZE_CONFIG_FILE = '1';
process.env.NODE_ENV = 'test';

const { expect } = require('chai');

const {
  isCustomWorkId, customWorkId, canonicalizeWorkId, workno, CUSTOM_WORK_ID_RE,
} = require('../work-id');
const { WORK_ID_RE, normalizeWorkId } = require('../routes/utils/validate');
const { coverFileName } = require('../filesystem/utils');

describe('custom work ids', function () {
  this.timeout(10000);

  it('is a v5-shaped UUID', () => {
    const id = customWorkId('library', 'Rain');
    expect(id).to.match(CUSTOM_WORK_ID_RE);
    expect(id).to.match(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('is stable across calls and process-independent', () => {
    expect(customWorkId('library', 'Rain')).to.equal(customWorkId('library', 'Rain'));
  });

  it('separates two folders with the same name under different roots', () => {
    expect(customWorkId('library', 'Rain')).to.not.equal(customWorkId('other', 'Rain'));
  });

  it('separates two folders with the same name at different paths', () => {
    expect(customWorkId('library', 'Rain')).to.not.equal(customWorkId('library', 'Discs/Rain'));
  });

  it('hashes the same path on Windows and POSIX', () => {
    expect(customWorkId('library', 'Discs\\Rain')).to.equal(customWorkId('library', 'Discs/Rain'));
  });

  it('hashes the same folder however its Unicode is composed', () => {
    const decomposed = 'rain\u3099';
    const composed = decomposed.normalize('NFC');
    expect(customWorkId('library', decomposed)).to.equal(customWorkId('library', composed));
  });

  it('keeps the alias and path apart, so neither can impersonate the other', () => {
    expect(customWorkId('a\u0000b', 'c')).to.not.equal(customWorkId('a', 'b\u0000c'));
  });

  it('recognises its own ids and nothing else', () => {
    expect(isCustomWorkId(customWorkId('library', 'Rain'))).to.equal(true);
    for (const other of ['123456', '01134567', 'BJ635795', 'd215444', 'not-an-id', '']) {
      expect(isCustomWorkId(other)).to.equal(false);
    }
  });

  it('canonicalises an upper-case id to lower case', () => {
    const id = customWorkId('library', 'Rain');
    expect(canonicalizeWorkId(id.toUpperCase())).to.equal(id);
  });

  it('passes a custom id through workno, and still prefixes store ids', () => {
    const id = customWorkId('library', 'Rain');
    expect(workno(id)).to.equal(id);
    expect(workno('635795')).to.equal('RJ635795');
    expect(workno('BJ635795')).to.equal('BJ635795');
    expect(workno('d215444')).to.equal('d_215444');
  });

  it('names cover files after the id, with no store prefix', () => {
    const id = customWorkId('library', 'Rain');
    expect(coverFileName(id, 'main')).to.equal(`${id}_img_main.jpg`);
    expect(coverFileName('635795', 'main')).to.equal('RJ635795_img_main.jpg');
    expect(coverFileName('d215444', 'main')).to.equal('d_215444_img_main.jpg');
  });

  describe('route param contract', () => {
    it('accepts both spellings of every id the app stores', () => {
      expect(WORK_ID_RE.test(customWorkId('library', 'Rain'))).to.equal(true);
      expect(WORK_ID_RE.test('01134567')).to.equal(true);
      expect(WORK_ID_RE.test('BJ635795')).to.equal(true);
      expect(WORK_ID_RE.test('d215444')).to.equal(true);
      expect(WORK_ID_RE.test('d_215444')).to.equal(true);
    });

    it('still rejects everything that is not a work id', () => {
      for (const bad of ['', '../etc/passwd', 'RJ', '635795.x', 'javascript:alert(1)', 'f'.repeat(36)]) {
        expect(WORK_ID_RE.test(bad)).to.equal(false);
      }
    });

    it('leaves a custom id intact through the sanitiser, case included', () => {
      const id = customWorkId('library', 'Rain');
      expect(normalizeWorkId(id)).to.equal(id);
      expect(normalizeWorkId(id.toUpperCase())).to.equal(id);
    });
  });
});
