/* eslint-disable n/no-unpublished-require */
// Sidecar parsing: what a kikoenai.nfo may say, and what stops a scan.
process.env.FREEZE_CONFIG_FILE = '1';
process.env.NODE_ENV = 'test';

const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  NFO_FILENAMES, NfoError, findNfoEntry, readNfoMetadata,
} = require('../filesystem/nfo');

const write = (dir, name, body) => {
  fs.writeFileSync(path.join(dir, name), body);
  return dir;
};

describe('custom work sidecar (nfo)', function () {
  this.timeout(10000);

  let dirs = [];
  const tempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-nfo-'));
    dirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
    dirs = [];
  });

  describe('findNfoEntry', () => {
    it('prefers kikoenai.nfo over .kikoenai.nfo', () => {
      expect(findNfoEntry(['.kikoenai.nfo', 'kikoenai.nfo'])).to.equal('kikoenai.nfo');
    });

    it('accepts either name in any case', () => {
      expect(findNfoEntry(['Kikoenai.NFO'])).to.equal('Kikoenai.NFO');
      expect(findNfoEntry(['.KIKOENAI.nfo'])).to.equal('.KIKOENAI.nfo');
    });

    it('ignores a bare .nfo, which belongs to other tools', () => {
      expect(findNfoEntry(['.nfo', 'work.nfo', 'readme.txt'])).to.equal(null);
    });
  });

  describe('readNfoMetadata', () => {
    it('reads every supported field', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', `
title = "雨の日"
nsfw = true
release = "2024-03-05"
circle = "サークル"
tags = ["ASMR", "耳かき"]
vas = ["声優"]
illustrators = ["絵師"]
scriptwriters = ["脚本"]
series = "シリーズ"
description = "<p>説明</p>"
`);

      expect(readNfoMetadata(dir)).to.deep.equal({
        title: '雨の日',
        circle: 'サークル',
        series: 'シリーズ',
        description: '<p>説明</p>',
        release: '2024-03-05',
        nsfw: true,
        tags: ['ASMR', '耳かき'],
        vas: ['声優'],
        illustrators: ['絵師'],
        scriptwriters: ['脚本'],
      });
    });

    it('leaves omitted fields undefined, so defaults stay the caller\'s', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', 'title = "只有标题"');
      const metadata = readNfoMetadata(dir);

      expect(metadata.title).to.equal('只有标题');
      expect(metadata.nsfw).to.equal(undefined);
      expect(metadata.release).to.equal(undefined);
      expect(metadata.circle).to.equal(undefined);
      expect(metadata.tags).to.equal(undefined);
      expect(metadata.description).to.equal(undefined);
    });

    it('reads an empty file as "no fields at all"', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', '');
      const metadata = readNfoMetadata(dir);

      expect(metadata.title).to.equal(undefined);
      expect(metadata.tags).to.equal(undefined);
    });

    it('accepts a TOML date literal for release', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', 'release = 2024-01-02');
      expect(readNfoMetadata(dir).release).to.equal('2024-01-02');
    });

    it('trims list entries, drops empties and deduplicates', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', 'tags = [" a ", "a", "", "b"]');
      expect(readNfoMetadata(dir).tags).to.deep.equal(['a', 'b']);
    });

    it('treats an empty string as an omitted field', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', 'title = ""\ncircle = "  "\ndescription = ""');
      const metadata = readNfoMetadata(dir);

      expect(metadata.title).to.equal(undefined);
      expect(metadata.circle).to.equal(undefined);
      expect(metadata.description).to.equal(undefined);
    });

    it('ignores unknown keys, so a newer file still loads', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', 'title = "t"\nfuture_key = 5');
      expect(readNfoMetadata(dir).title).to.equal('t');
    });

    it('reads .kikoenai.nfo when that is the only sidecar', () => {
      const dir = write(tempDir(), '.kikoenai.nfo', 'title = "hidden"');
      expect(readNfoMetadata(dir).title).to.equal('hidden');
    });

    it('reads the named file when the scan already found one', () => {
      const dir = write(tempDir(), '.kikoenai.nfo', 'title = "hidden"');
      write(dir, 'kikoenai.nfo', 'title = "visible"');
      expect(readNfoMetadata(dir, '.kikoenai.nfo').title).to.equal('hidden');
    });

    it('throws rather than guessing when there is no sidecar', () => {
      const dir = write(tempDir(), '.nfo', 'title = "other tool"');
      expect(() => readNfoMetadata(dir)).to.throw(NfoError, /kikoenai\.nfo/);
    });

    it('names the file and the key when a value has the wrong type', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', 'tags = 5');
      try {
        readNfoMetadata(dir);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(NfoError);
        expect(err.key).to.equal('tags');
        expect(err.filePath).to.equal(path.join(dir, 'kikoenai.nfo'));
        expect(err.message).to.match(/tags/);
      }
    });

    it('rejects a non-boolean nsfw', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', 'nsfw = "yes"');
      expect(() => readNfoMetadata(dir)).to.throw(NfoError, /nsfw/);
    });

    it('rejects a malformed or impossible release', () => {
      const bad = write(tempDir(), 'kikoenai.nfo', 'release = "2024-3-5"');
      expect(() => readNfoMetadata(bad)).to.throw(NfoError, /release/);

      const impossible = write(tempDir(), 'kikoenai.nfo', 'release = "2024-02-31"');
      expect(() => readNfoMetadata(impossible)).to.throw(NfoError, /release/);
    });

    it('reports TOML syntax errors against the file', () => {
      const dir = write(tempDir(), 'kikoenai.nfo', 'title = ');
      try {
        readNfoMetadata(dir);
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).to.be.instanceOf(NfoError);
        expect(err.filePath).to.equal(path.join(dir, 'kikoenai.nfo'));
        expect(err.message).to.match(/TOML/);
      }
    });
  });

  it('documents the recognised names in priority order', () => {
    expect(NFO_FILENAMES).to.deep.equal(['kikoenai.nfo', '.kikoenai.nfo']);
  });
});
