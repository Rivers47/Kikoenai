/* eslint-disable n/no-unpublished-require */
// KIKO_DATA_DIR resolution. A *relative* value used to be taken verbatim, and
// the failure was not "it points somewhere odd" but a path that grew a level
// on every single startup: defaultConfig wrote `data/covers` (relative),
// resolveDataFolder re-joined it onto dataRoot to get `data/data/covers`, and
// setConfig persisted that for the next boot to nest again. The visible
// symptom was `res.sendFile` refusing a relative path, several restarts later.
//
// Run in a subprocess rather than by juggling require.cache: config.js has
// module-init side effects and a cached `config` object that every other test
// in this suite already holds a reference to.

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

  // The part that actually made it dangerous: the nesting was persisted, so
  // every restart compounded it. Feeding one boot's answer back in must be a
  // no-op, whatever the data root looked like on the command line.
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

  // The case that actually bit: a data root *under* the application directory.
  // Every correct path then looks like a legacy app-dir path to
  // rerootFromAppDir, which re-roots it onto the data root and nests it one
  // level deeper per startup -- with an absolute KIKO_DATA_DIR too, so the
  // path.resolve above does not cover this.
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

    // The behaviour rerootFromAppDir exists for must survive: a folder pinned
    // in the app directory by a run from before KIKO_DATA_DIR was set still
    // moves onto the data root, or a container upgrade silently leaves the
    // covers and the database behind.
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
