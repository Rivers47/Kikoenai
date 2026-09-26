/* eslint-disable n/no-unpublished-require */
// KIKO_DATA_DIR resolution. The failure these pin is a data folder that grows
// a level on every startup, because setConfig persists each round: `covers` ->
// `data/covers` -> `data/data/covers`, surfacing much later as res.sendFile
// refusing a relative path.
//
// Run in a subprocess: config.js has module-init side effects and a cached
// `config` object the rest of the suite already holds.

process.env.FREEZE_CONFIG_FILE = '1';

const { expect } = require('chai');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FOLDER_KEYS = [
  'coverFolderDir',
  'imageFolderDir',
  'databaseFolderDir',
  'transcodeCacheDir',
  'lyricFolderDir',
];

/**
 * Boot config.js in a child process with the given KIKO_DATA_DIR and report
 * what it resolved. `cwd` is where a relative value is measured from.
 */
const bootConfig = (dataRoot, cwd) => {
  const script = `
    const { config, dataRoot } = require(${JSON.stringify(path.join(__dirname, '..', 'config.js'))});
    process.stdout.write(JSON.stringify({ dataRoot, config }));
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd,
    env: { ...process.env, KIKO_DATA_DIR: dataRoot, FREEZE_CONFIG_FILE: '1' },
    encoding: 'utf8',
  });
  // The relative-path notice is printed before the JSON.
  return JSON.parse(out.slice(out.indexOf('{')));
};

describe('KIKO_DATA_DIR', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kiko-root-'));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('resolves a relative value against the working directory', () => {
    fs.mkdirSync(path.join(root, 'test_data_root'));
    const { dataRoot } = bootConfig('test_data_root', root);

    expect(path.isAbsolute(dataRoot)).to.equal(true);
    // fs.realpath: macOS hands out /var/folders symlinked from /private/var.
    expect(fs.realpathSync(dataRoot)).to.equal(fs.realpathSync(path.join(root, 'test_data_root')));
  });

  it('gives every data folder an absolute path, nested exactly once', () => {
    fs.mkdirSync(path.join(root, 'test_data_root'));
    const { config } = bootConfig('test_data_root', root);

    for (const key of FOLDER_KEYS) {
      expect(path.isAbsolute(config[key]), `${key} should be absolute`).to.equal(true);
      // The bug's signature: the data root's own name repeated in the path.
      const repeats = config[key].split(path.sep).filter(seg => seg === 'test_data_root').length;
      expect(repeats, `${key} = ${config[key]}`).to.equal(1);
    }
  });

  // Feeding one boot's answer back in must be a no-op.
  it('is idempotent across restarts', () => {
    fs.mkdirSync(path.join(root, 'test_data_root'));
    const first = bootConfig('test_data_root', root).config;

    // What the second startup reads: the absolute paths the first one wrote.
    const configDir = path.join(root, 'test_data_root', 'config');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(first));

    const second = bootConfig('test_data_root', root).config;

    for (const key of FOLDER_KEYS) {
      expect(second[key], key).to.equal(first[key]);
    }
  });

  // A data root under the app directory: every correct path looks like a
  // legacy app-dir path to rerootFromAppDir. Absolute values hit this too.
  describe('with the data root inside the application directory', () => {
    const appDir = path.join(__dirname, '..');
    let inside;

    beforeEach(() => {
      inside = fs.mkdtempSync(path.join(appDir, 'kiko-inside-'));
    });

    afterEach(() => {
      fs.rmSync(inside, { recursive: true, force: true });
    });

    it('does not re-root paths that already live there', () => {
      const { config } = bootConfig(inside, appDir);
      for (const key of FOLDER_KEYS) {
        expect(config[key], key).to.equal(path.join(inside, path.basename(config[key])));
      }
    });

    it('is idempotent across restarts', () => {
      const first = bootConfig(inside, appDir).config;

      const configDir = path.join(inside, 'config');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.json'), JSON.stringify(first));

      const second = bootConfig(inside, appDir).config;
      for (const key of FOLDER_KEYS) {
        expect(second[key], key).to.equal(first[key]);
      }
    });

    // What rerootFromAppDir exists for, still working.
    it('still re-roots a legacy path pinned in the app directory', () => {
      const legacy = path.join(appDir, 'covers');
      const configDir = path.join(inside, 'config');
      fs.mkdirSync(configDir, { recursive: true });
      fs.writeFileSync(path.join(configDir, 'config.json'),
        JSON.stringify({ version: '0.0.0', coverFolderDir: legacy, coverUseDefaultPath: false }));

      const { config } = bootConfig(inside, appDir);
      expect(config.coverFolderDir).to.equal(path.join(inside, 'covers'));
    });
  });

  it('leaves an absolute value exactly as given', () => {
    const absolute = path.join(root, 'data');
    fs.mkdirSync(absolute);
    const { dataRoot, config } = bootConfig(absolute, os.tmpdir());

    expect(dataRoot).to.equal(absolute);
    expect(config.coverFolderDir).to.equal(path.join(absolute, 'covers'));
    expect(config.lyricFolderDir).to.equal(path.join(absolute, 'lyrics'));
  });
});
