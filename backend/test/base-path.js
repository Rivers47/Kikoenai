/* eslint-disable n/no-unpublished-require */
const { expect } = require('chai');
const { PUBLIC_PATH_TOKEN, normalizeBasePath, applyBasePath } = require('../base-path');

describe('base-path', () => {
  describe('normalizeBasePath', () => {
    it('treats an unset, empty or root value as "serve from the root"', () => {
      [undefined, null, '', '   ', '/', '//'].forEach(value => {
        expect(normalizeBasePath(value), JSON.stringify(value)).to.equal('');
      });
    });

    it('adds the leading slash and drops the trailing one', () => {
      expect(normalizeBasePath('kikoeru')).to.equal('/kikoeru');
      expect(normalizeBasePath('/kikoeru')).to.equal('/kikoeru');
      expect(normalizeBasePath('/kikoeru/')).to.equal('/kikoeru');
      expect(normalizeBasePath('  /kikoeru/  ')).to.equal('/kikoeru');
    });

    it('keeps multi-segment prefixes and collapses repeated slashes', () => {
      expect(normalizeBasePath('//apps//kikoeru//')).to.equal('/apps/kikoeru');
    });

    // A bad value should not stop the server from booting, so every rejection
    // falls back to the root rather than throwing.
    it('rejects anything that is not a path', () => {
      ['http://example.com/kikoeru', 'https://x', 'C:\\kikoeru'].forEach(value => {
        expect(normalizeBasePath(value), value).to.equal('');
      });
    });

    it('rejects relative segments and characters that do not belong in a path', () => {
      ['/a/../b', '/a/./b', '/kiko eru', '/kiko"eru', '/</script>'].forEach(value => {
        expect(normalizeBasePath(value), value).to.equal('');
      });
    });
  });

  describe('applyBasePath', () => {
    it('swaps every occurrence of the token for the prefix', () => {
      const asset = `<script src=${PUBLIC_PATH_TOKEN}js/app.js></script><link href=${PUBLIC_PATH_TOKEN}css/app.css>`;
      expect(applyBasePath(asset, '/kikoeru')).to.equal(
        '<script src=/kikoeru/js/app.js></script><link href=/kikoeru/css/app.css>'
      );
    });

    // The whole point of the empty default: a root-served install gets exactly
    // the URLs it had before any of this existed.
    it('collapses the token back to a bare slash when there is no prefix', () => {
      expect(applyBasePath(`${PUBLIC_PATH_TOKEN}js/app.js`, '')).to.equal('/js/app.js');
    });

    it('leaves an asset with no token untouched', () => {
      expect(applyBasePath('body { color: red }', '/kikoeru')).to.equal('body { color: red }');
    });
  });
});
