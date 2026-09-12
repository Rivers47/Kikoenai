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
