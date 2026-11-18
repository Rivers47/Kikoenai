/* eslint-disable n/no-unpublished-require */
// Folder discovery: which folders become works, and which layouts stop the scan.
process.env.FREEZE_CONFIG_FILE = '1';
process.env.NODE_ENV = 'test';

const { expect } = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { getFolderList } = require('../filesystem/utils');
const { NfoConflictError, NfoError } = require('../filesystem/nfo');
const { customWorkId, isCustomWorkId } = require('../work-id');
const { config } = require('../config');

const collect = async (rootFolder) => {
  const folders = [];
  for await (const folder of getFolderList(rootFolder, '', 0, { error() {} })) folders.push(folder);
  return folders;
};

describe('scan folder discovery with sidecars', function () {
  this.timeout(15000);

  let root;
  let savedDepth;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-scan-'));
    // Pin the limit: a local config.json can lower it, and these cases are about
    // the walk, not about whatever depth this machine happens to use.
    savedDepth = config.scannerMaxRecursionDepth;
    config.scannerMaxRecursionDepth = 3;
  });

  afterEach(() => {
    config.scannerMaxRecursionDepth = savedDepth;
    fs.rmSync(root, { recursive: true, force: true });
  });

  const mkdir = (relative) => {
    const dir = path.join(root, relative);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  };

  const nfo = (relative, body = 'title = "t"') => {
    const dir = mkdir(relative);
    fs.writeFileSync(path.join(dir, 'kikoenai.nfo'), body);
  };

  const rootFolder = () => ({ name: 'library', path: root });

  it('yields a sidecar folder as a work with a path-derived id', async () => {
    nfo('Rain');
    const folders = await collect(rootFolder());

    expect(folders).to.have.length(1);
    expect(folders[0].id).to.equal(customWorkId('library', 'Rain'));
    expect(isCustomWorkId(folders[0].id)).to.equal(true);
    expect(folders[0].relativePath).to.equal('Rain');
    expect(folders[0].nfoMetadata.title).to.equal('t');
  });

  it('carries the parsed sidecar, so the scan never reads it twice', async () => {
    nfo('Rain', 'title = "雨"\ntags = ["a"]');
    const [folder] = await collect(rootFolder());

    expect(folder.nfoMetadata.title).to.equal('雨');
    expect(folder.nfoMetadata.tags).to.deep.equal(['a']);
  });

  it('finds a sidecar in a subfolder, using its path for the id', async () => {
    nfo('Discs/Rain');
    const [folder] = await collect(rootFolder());

    expect(folder.id).to.equal(customWorkId('library', path.join('Discs', 'Rain')));
  });

  it('still yields DLsite and Fanza folders, with their ids', async () => {
    mkdir('RJ123456');
    mkdir('BJ635795');
    mkdir('d_215444');
    const ids = (await collect(rootFolder())).map(folder => folder.id).sort();

    expect(ids).to.deep.equal(['123456', 'BJ635795', 'd215444']);
  });

  it('ignores a bare .nfo, which other tools leave behind', async () => {
    const dir = mkdir('Rain');
    fs.writeFileSync(path.join(dir, '.nfo'), 'title = "x"');
    expect(await collect(rootFolder())).to.deep.equal([]);
  });

  it('aborts when a work folder also holds a sidecar', async () => {
    nfo('RJ123456');
    try {
      await collect(rootFolder());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(NfoConflictError);
      expect(err.paths[0]).to.equal(path.join(root, 'RJ123456'));
      expect(err.paths[1]).to.equal(path.join(root, 'RJ123456', 'kikoenai.nfo'));
    }
  });

  it('aborts when a sidecar folder contains a work-named folder', async () => {
    nfo('Collection');
    mkdir('Collection/RJ123456');
    try {
      await collect(rootFolder());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(NfoConflictError);
      expect(err.paths).to.include(path.join(root, 'Collection', 'RJ123456'));
      expect(err.paths).to.include(path.join(root, 'Collection'));
    }
  });

  it('aborts when a sidecar folder contains a nested sidecar', async () => {
    nfo('Collection');
    nfo('Collection/Disc2');
    expect(() => collect(rootFolder())).to.not.throw();
    try {
      await collect(rootFolder());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(NfoConflictError);
      expect(err.paths).to.include(path.join(root, 'Collection', 'Disc2'));
    }
  });

  it('aborts on a sidecar that cannot be parsed, before anything is imported', async () => {
    nfo('Broken', 'title = ');
    try {
      await collect(rootFolder());
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).to.be.instanceOf(NfoError);
      expect(err.filePath).to.equal(path.join(root, 'Broken', 'kikoenai.nfo'));
    }
  });

  it('does not look for sidecars below the recursion limit', async () => {
    config.scannerMaxRecursionDepth = 2;
    nfo('a/b/c/Rain');

    const folders = await collect(rootFolder());
    expect(folders).to.deep.equal([]);
  });

  it('reads a sidecar at the deepest folder the walk reaches', async () => {
    config.scannerMaxRecursionDepth = 2;
    nfo('a/Rain');

    const folders = await collect(rootFolder());
    expect(folders).to.have.length(1);
    expect(folders[0].id).to.equal(customWorkId('library', path.join('a', 'Rain')));
  });
});
