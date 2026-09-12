/* eslint-disable n/no-unpublished-require */
// Scraped image bookkeeping: which files a work claims, and which get pruned

process.env.FREEZE_CONFIG_FILE = '1';

const chai = require('chai');
const expect = chai.expect;
const fs = require('fs');
const os = require('os');
const { join } = require('path');

const { config } = require('../config');
const { collectWorkImages, deleteWorkImagesFromDisk, workImageFileNamePattern } = require('../filesystem/utils');
const { splitDownloadTargets } = require('../filesystem/workExtras');

describe('scraped work images', function () {
  describe('collectWorkImages', function () {
    it('lists the slider first, then description images, deduplicated', function () {
      const images = collectWorkImages({
        sampleImages: [{ url: 'a.jpg', thumb: 'a_t.jpg' }, { url: 'b.jpg' }],
        descriptionParts: [
          { images: ['c.jpg', 'a.jpg'] },  // a.jpg is already in the slider
          { images: ['d.jpg'] },
        ],
      });

      expect(images.map(i => i.url)).to.eql(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
      expect(images.map(i => i.kind)).to.eql(['smp', 'smp', 'part', 'part']);
      expect(images[0].thumb).to.equal('a_t.jpg');
    });
  });

  describe('splitDownloadTargets', function () {
    const target = (url, file) => ({ url, file });

    it('reuses an image the last run put in the same file', function () {
      const targets = [target('a.jpg', 'RJ1_img_smp1.jpg'), target('b.jpg', 'RJ1_img_smp2.jpg')];
      const previous = [target('a.jpg', 'RJ1_img_smp1.jpg'), target('b.jpg', 'RJ1_img_smp2.jpg')];
      const { reuse, fetch } = splitDownloadTargets(targets, previous, new Set(['RJ1_img_smp1.jpg', 'RJ1_img_smp2.jpg']));

      expect(reuse.map(t => t.url)).to.eql(['a.jpg', 'b.jpg']);
      expect(fetch).to.be.empty;
    });

    it('refetches when the file is gone from disk', function () {
      const targets = [target('a.jpg', 'RJ1_img_smp1.jpg')];
      const { reuse, fetch } = splitDownloadTargets(targets, targets, new Set());

      expect(reuse).to.be.empty;
      expect(fetch.map(t => t.url)).to.eql(['a.jpg']);
    });

    it('refetches when the name now belongs to a different image', function () {
      // The description lost its first image, so every later one shifts up a
      // number: part2's bytes are on disk under part1's name.
      const targets = [target('b.jpg', 'RJ1_img_part1.jpg')];
      const previous = [target('a.jpg', 'RJ1_img_part1.jpg'), target('b.jpg', 'RJ1_img_part2.jpg')];
      const { reuse, fetch } = splitDownloadTargets(targets, previous, new Set(['RJ1_img_part1.jpg', 'RJ1_img_part2.jpg']));

      expect(reuse).to.be.empty;
      expect(fetch.map(t => t.url)).to.eql(['b.jpg']);
    });

    it('fetches everything when there is no previous list', function () {
      const targets = [target('a.jpg', 'RJ1_img_smp1.jpg')];
      expect(splitDownloadTargets(targets, [], new Set(['RJ1_img_smp1.jpg'])).fetch).to.have.length(1);
      expect(splitDownloadTargets(targets, undefined, new Set()).fetch).to.have.length(1);
    });

    it('ignores a previous entry whose download had failed', function () {
      const targets = [target('a.jpg', 'RJ1_img_smp1.jpg')];
      const previous = [{ url: 'a.jpg', file: null }];
      expect(splitDownloadTargets(targets, previous, new Set(['RJ1_img_smp1.jpg'])).fetch).to.have.length(1);
    });
  });

  describe('deleteWorkImagesFromDisk', function () {
    let imageDir;
    let originalDir;

    beforeEach(function () {
      imageDir = fs.mkdtempSync(join(os.tmpdir(), 'kiko-images-'));
      originalDir = config.imageFolderDir;
      config.imageFolderDir = imageDir;
    });

    afterEach(function () {
      config.imageFolderDir = originalDir;
      fs.rmSync(imageDir, { recursive: true, force: true });
    });

    const write = (name) => fs.writeFileSync(join(imageDir, name), 'x');
    const remaining = () => fs.readdirSync(imageDir).sort();

    it('deletes every image of the work, and nothing else', async function () {
      ['RJ123456_img_smp1.jpg', 'RJ123456_img_part1.png', 'RJ654321_img_smp1.jpg',
        'RJ123456_img_main.jpg', 'notes.txt'].forEach(write);

      const deleted = await deleteWorkImagesFromDisk('123456');

      expect(deleted).to.equal(2);
      // The cover (_img_main) survives: a deployment may point imageFolderDir
      // at the cover folder.
      expect(remaining()).to.eql(['RJ123456_img_main.jpg', 'RJ654321_img_smp1.jpg', 'notes.txt']);
    });

    it('spares the names a fresh download claimed', async function () {
      ['RJ123456_img_smp1.jpg', 'RJ123456_img_part1.jpg', 'RJ123456_img_part2.jpg'].forEach(write);

      // The description lost a part image, so part2 is left over from last run.
      const deleted = await deleteWorkImagesFromDisk('123456',
        new Set(['RJ123456_img_smp1.jpg', 'RJ123456_img_part1.jpg']));

      expect(deleted).to.equal(1);
      expect(remaining()).to.eql(['RJ123456_img_part1.jpg', 'RJ123456_img_smp1.jpg']);
    });

    it('does nothing when the image folder does not exist', async function () {
      config.imageFolderDir = join(imageDir, 'nope');
      expect(await deleteWorkImagesFromDisk('123456')).to.equal(0);
    });
  });

  describe('workImageFileNamePattern', function () {
    it('matches only this work\'s scraped images', function () {
      const pattern = workImageFileNamePattern('123456');

      expect(pattern.test('RJ123456_img_smp1.jpg')).to.be.true;
      expect(pattern.test('RJ123456_img_part12.webp')).to.be.true;
      expect(pattern.test('RJ654321_img_smp1.jpg')).to.be.false;
      expect(pattern.test('RJ123456_img_main.jpg')).to.be.false;
      expect(pattern.test('../../config/config.json')).to.be.false;
    });

    it('takes the prefixed spelling of every floor', function () {
      expect(workImageFileNamePattern('BJ635795').test('BJ635795_img_smp1.jpg')).to.be.true;
      expect(workImageFileNamePattern('d215444').test('d_215444_img_smp1.jpg')).to.be.true;
    });
  });
});
