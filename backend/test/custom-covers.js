/* eslint-disable n/no-unpublished-require */
// Cover generation for custom works: which file is the source, and what ffmpeg
// is asked to do with it. The resize itself is ffmpeg's job, so the arguments
// are what this suite pins; the end-to-end run is skipped without the binary.
process.env.FREEZE_CONFIG_FILE = '1';
process.env.NODE_ENV = 'test';

const { expect } = require('chai');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { config } = require('../config');
const {
  COVER_SOURCE_NAMES, buildCoverArgs, findCoverSource, saveCustomCovers,
} = require('../filesystem/customCovers');
const { coverFileName } = require('../filesystem/utils');
const { customWorkId } = require('../work-id');

const hasFfmpeg = () => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

describe('custom work covers', function () {
  this.timeout(20000);

  let workDir;
  let coverDir;
  let savedCoverDir;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-cover-work-'));
    coverDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-cover-out-'));
    savedCoverDir = config.coverFolderDir;
    config.coverFolderDir = coverDir;
  });

  afterEach(() => {
    config.coverFolderDir = savedCoverDir;
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(coverDir, { recursive: true, force: true });
  });

  describe('findCoverSource', () => {
    it('prefers cover.jpg, then the other accepted names', () => {
      expect(COVER_SOURCE_NAMES).to.deep.equal(['cover.jpg', 'cover.jpeg', 'cover.png', 'cover.webp']);

      fs.writeFileSync(path.join(workDir, 'cover.png'), 'x');
      expect(findCoverSource(workDir)).to.equal(path.join(workDir, 'cover.png'));

      fs.writeFileSync(path.join(workDir, 'cover.jpg'), 'x');
      expect(findCoverSource(workDir)).to.equal(path.join(workDir, 'cover.jpg'));
    });

    it('matches the name in any case', () => {
      fs.writeFileSync(path.join(workDir, 'Cover.JPG'), 'x');
      expect(findCoverSource(workDir)).to.equal(path.join(workDir, 'Cover.JPG'));
    });

    it('ignores other images in the folder', () => {
      fs.writeFileSync(path.join(workDir, 'artwork.jpg'), 'x');
      expect(findCoverSource(workDir)).to.equal(null);
    });

    it('returns null for a folder that cannot be read', () => {
      expect(findCoverSource(path.join(workDir, 'missing'))).to.equal(null);
    });
  });

  describe('buildCoverArgs', () => {
    it('keeps the source resolution for main', () => {
      expect(buildCoverArgs('in.jpg', 'out.jpg', 'main')).to.deep.equal([
        '-y', '-i', 'in.jpg', '-q:v', '2', 'out.jpg',
      ]);
    });

    it('scales sam to 640 wide, keeping the aspect ratio', () => {
      expect(buildCoverArgs('in.jpg', 'out.jpg', 'sam')).to.deep.equal([
        '-y', '-i', 'in.jpg', '-vf', 'scale=640:-2', '-q:v', '3', 'out.jpg',
      ]);
    });

    it('crops 240x240 to a square', () => {
      expect(buildCoverArgs('in.jpg', 'out.jpg', '240x240')).to.deep.equal([
        '-y', '-i', 'in.jpg',
        '-vf', 'scale=240:240:force_original_aspect_ratio=increase,crop=240:240',
        '-q:v', '3', 'out.jpg',
      ]);
    });
  });

  describe('saveCustomCovers', () => {
    it('writes nothing when the folder has no source image', async () => {
      const id = customWorkId('library', 'Rain');
      const result = await saveCustomCovers(id, workDir);

      expect(result).to.deep.equal({ written: [], failed: [], source: null });
      expect(fs.readdirSync(coverDir)).to.deep.equal([]);
    });

    it('names the files after the id, with no store prefix', async function () {
      if (!hasFfmpeg()) this.skip();

      const id = customWorkId('library', 'Rain');
      execFileSync('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=64x64', '-frames:v', '1',
        path.join(workDir, 'cover.jpg')], { stdio: 'ignore' });

      const result = await saveCustomCovers(id, workDir, ['main', '240x240']);

      expect(result.written).to.deep.equal(['main', '240x240']);
      expect(fs.existsSync(path.join(coverDir, coverFileName(id, 'main')))).to.equal(true);
      expect(fs.existsSync(path.join(coverDir, coverFileName(id, '240x240')))).to.equal(true);
      // Only the requested types, so an existing cover is never overwritten.
      expect(fs.existsSync(path.join(coverDir, coverFileName(id, 'sam')))).to.equal(false);
    });

    it('reports a failure instead of throwing, so a cover never fails a work', async function () {
      if (!hasFfmpeg()) this.skip();

      const id = customWorkId('library', 'Rain');
      // A file ffmpeg cannot decode: the work must still import.
      fs.writeFileSync(path.join(workDir, 'cover.jpg'), 'not an image');

      const result = await saveCustomCovers(id, workDir, ['main']);

      expect(result.written).to.deep.equal([]);
      expect(result.failed).to.have.length(1);
      expect(result.failed[0].type).to.equal('main');
      expect(fs.existsSync(path.join(coverDir, coverFileName(id, 'main')))).to.equal(false);
    });
  });
});
