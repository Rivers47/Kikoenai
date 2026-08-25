const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// The four persistent data folders (config/sqlite/covers/images) all hang off
// dataRoot. It defaults to the application directory, which cannot take a
// single volume without shadowing app.js, node_modules and dist -- that is why
// the old container layout needed one mount per folder.
//
// KIKO_DATA_DIR moves all four somewhere outside the app directory, so one
// mount covers everything: the container image sets it to /appdata, and the
// portable Windows launcher sets it to the folder holding Kikoenai.bat.
//
// The voice-work library is deliberately NOT under here -- it is the user's
// media, mounted separately, and never follows dataRoot.
//
// appDir is kept separately because a config.json written before this variable
// was set stores folder paths as absolute paths inside it; see rerootFromAppDir.
const appDir = __dirname;
const dataRoot = process.env.KIKO_DATA_DIR || appDir;

// Loud, advisory only: the container image used to keep these folders under the
// application directory and now defaults to KIKO_DATA_DIR=/appdata. An operator
// upgrading without moving their volumes would otherwise start against an empty
// directory, rescan, and lose ratings/reviews/progress/history -- none of which
// a rescan can rebuild. Nothing is changed here; the point is that the failure
// must not be silent.
if (process.env.IS_DOCKER && dataRoot !== appDir) {
  const legacyDb = path.join(appDir, 'sqlite', 'db.sqlite3');
  const currentDb = path.join(dataRoot, 'sqlite', 'db.sqlite3');
  if (fs.existsSync(legacyDb) && !fs.existsSync(currentDb)) {
    console.warn(` !!! 检测到旧版数据目录: ${legacyDb} 存在，但当前数据目录 ${dataRoot} 为空。`);
    console.warn(` !!! Found a database at ${legacyDb}, but the current data root ${dataRoot} is empty.`);
    console.warn(` !!! Either mount your data into ${dataRoot} (config/ sqlite/ covers/ images/),`);
    console.warn(` !!! or set KIKO_DATA_DIR=${appDir} to keep the previous layout. See README.md.`);
  }
}
const configFolderDir = path.join(dataRoot, 'config');
const configPath = path.join(configFolderDir, 'config.json');
const pjson = require('./package.json');
const compareVersions = require('compare-versions');

// Before the following version, there is no version tracking
const versionWithoutVerTracking = '0.4.1';
// Before the following version, db path is using the absolute path in databaseFolderDir of config.json
const versionDbRelativePath = '0.5.8';

let config = {};

const voiceWorkDefaultPath = () => {
  if (process.env.IS_DOCKER) {
    return '/usr/src/kikoeru/VoiceWork';
  } else {
    return path.join(dataRoot, 'VoiceWork');
  }
};

const defaultConfig = {
  version: pjson.version,
  production: process.env.NODE_ENV === 'production' ? true : false,
  dbBusyTimeout: 1000,
  // Concurrent works during a scan. Each work now costs a page scrape, an API
  // call, 3 cover downloads, its sample/description images and its reviews, so
  // 16 at once is enough to get rate-limited by DLsite. Lower this further if
  // scans still stall; it only affects scan speed.
  maxParallelism: 8,
  rootFolders: [
    // {
    //   name: '',
    //   path: ''
    // }
  ],
  coverFolderDir: path.join(dataRoot, 'covers'),
  imageFolderDir: path.join(dataRoot, 'images'), // Scraped sample/description images, kept out of the cover cache
  databaseFolderDir: path.join(dataRoot, 'sqlite'),
  coverUseDefaultPath: false, // Ignores coverFolderDir if set to true
  imageUseDefaultPath: false, // Ignores imageFolderDir if set to true
  dbUseDefaultPath: true, // Ignores databaseFolderDir if set to true
  voiceWorkDefaultPath: voiceWorkDefaultPath(),
  auth: process.env.NODE_ENV === 'production' ? true : false,
  md5secret: crypto.randomBytes(32).toString('hex'),
  jwtsecret: crypto.randomBytes(32).toString('hex'),
  expiresIn: 2592000,
  scannerMaxRecursionDepth: 2,
  pageSize: 12,
  retry: 5,
  dlsiteTimeout: 10000,
  hvdbTimeout: 10000,
  fanzaTimeout: 10000,
  retryDelay: 2000,
  httpProxyHost: '',
  httpProxyPort: 0,
  listenPort: 8888,
  blockRemoteConnection: false,
  // Hostnames (no port) this server should answer requests for, in addition to
  // localhost/loopback/private-LAN addresses, which are always allowed. Defends
  // against DNS-rebinding-style attacks where a malicious site's own domain is
  // briefly pointed at this server's address: the browser treats such a request
  // as "same-origin" (same hostname string) even though the IP just changed, so
  // it will still carry a valid session cookie unless the Host header itself is
  // checked server-side. Empty by default -- opt-in, so upgrading does not lock
  // out an existing public hostname nobody has listed yet. Add your domain (e.g.
  // "kikoeru.example.com") once you have one to start enforcing.
  allowedHosts: [],
  behindProxy: false,
  httpsEnabled: false,
  httpsPrivateKey: 'kikoeru.key',
  httpsCert: 'kikoeru.crt',
  httpsPort: 8443,
  skipCleanup: false,
  enableGzip: true,
  rewindSeekTime: 5,
  forwardSeekTime: 30,
  offloadMedia: false,
  offloadStreamPath: '/media/stream/',          // /media/stream/RJ123456/subdirs/track.mp3
  offloadDownloadPath: '/media/download/',      // /media/download/RJ123456/subdirs/track.mp3
};
const initConfig = (writeConfigToFile = !process.env.FREEZE_CONFIG_FILE) => {
  config = Object.assign(config, defaultConfig);
  if (writeConfigToFile) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, "\t"));
  }
};

const setConfig = (newConfig, writeConfigToFile = !process.env.FREEZE_CONFIG_FILE) => {
  // Prevent changing some values, overwrite with old ones
  newConfig.production = config.production;
  newConfig.md5secret = config.md5secret;
  newConfig.jwtsecret = config.jwtsecret;

  // Merge config
  config = Object.assign(config, newConfig);
  // Re-resolve after the merge: newConfig carries whatever was on disk or came
  // from the admin panel, which may be relative or pinned to the old data root.
  resolveDataFolders();
  if (writeConfigToFile) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, "\t"));
  }
};

// Re-root a data folder that an earlier run pinned inside the application
// directory.
//
// The admin panel saves folder paths as absolute, so a config.json written
// before KIKO_DATA_DIR was set holds e.g. "/usr/src/kikoeru/covers". Setting
// KIKO_DATA_DIR afterwards would move only the folders that config.json does
// not mention, silently leaving the covers and the database behind at the old
// location. Anything outside the app directory is a deliberate choice by the
// user (a big disk, a network share) and is left alone.
//
// Deliberately not applied to rootFolders or voiceWorkDefaultPath: those are
// the user's media mounts, not app state, and rewriting them would break a
// working library.
const rerootFromAppDir = (dir) => {
  if (dataRoot === appDir) return dir;

  const relative = path.relative(appDir, dir);
  // '..' prefix or an absolute result (another Windows drive) means the path
  // is not inside the app directory.
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return dir;

  const rerooted = path.join(dataRoot, relative);
  console.log(`数据目录已迁移: ${dir} -> ${rerooted}`);
  return rerooted;
};

/**
 * Resolve one configurable data folder against the current data root.
 * @param {String} dir Value from config.json (relative or absolute).
 * @param {String} defaultName Folder name used when useDefault is set.
 * @param {Boolean} useDefault Ignore `dir` and use dataRoot/defaultName.
 * @returns {String} Absolute path.
 */
const resolveDataFolder = (dir, defaultName, useDefault) => {
  if (useDefault) return path.join(dataRoot, defaultName);
  if (!dir) return path.join(dataRoot, defaultName);
  if (!path.isAbsolute(dir)) return path.join(dataRoot, dir);
  return rerootFromAppDir(dir);
};

/**
 * Resolve the three configurable data folders in place.
 *
 * Must run after ANY assignment into `config`, not just the initial read:
 * updateConfig re-reads the raw file and hands it to setConfig, whose
 * Object.assign would otherwise put the unresolved on-disk values back --
 * silently undoing rerootFromAppDir and then persisting the stale paths.
 * That is how a version upgrade could leave covers pointing inside the
 * application directory while the database, opened earlier, stayed correct.
 */
const resolveDataFolders = () => {
  config.coverFolderDir = resolveDataFolder(config.coverFolderDir, 'covers', config.coverUseDefaultPath);
  config.imageFolderDir = resolveDataFolder(config.imageFolderDir, 'images', config.imageUseDefaultPath);
  config.databaseFolderDir = resolveDataFolder(config.databaseFolderDir, 'sqlite', config.dbUseDefaultPath);
};

// Get or use default value
const readConfig = () => {
  config = JSON.parse(fs.readFileSync(configPath));
  for (let key in defaultConfig) {
    if (!config.hasOwnProperty(key)) {
      if (key === 'version') {
        config['version'] = versionWithoutVerTracking;
      } else {
        config[key] = defaultConfig[key];
      }
    }
  }

  // Ignored, not dropped: rewriting config.json is destructive, and a stale key
  // is the only trace of what the user actually tried to configure.
  const unknownKeys = Object.keys(config).filter(key => !(key in defaultConfig));
  if (unknownKeys.length) {
    console.log('配置项未被使用，已忽略:', unknownKeys.join(', '));
  }

  // Data folder paths: relative to dataRoot, or absolute, or forced to the
  // default. `useDefault` wins, then a relative path, then an absolute one.
  resolveDataFolders();

  if (process.env.NODE_ENV === 'production' || config.production) {
    config.production = true;
  }
};

// Migrate config
const updateConfig = (writeConfigToFile = !process.env.FREEZE_CONFIG_FILE) => {
  let cfg = JSON.parse(fs.readFileSync(configPath));
  let countChanged = 0;
  for (let key in defaultConfig) {
    if (!cfg.hasOwnProperty(key)) {
      console.log('写入设置', key);
      cfg[key] = defaultConfig[key];
      countChanged += 1;
    }
  }

  if (compareVersions.compare(cfg.version, versionDbRelativePath, '<')) {
    console.log('数据库位置已设置为程序目录下的sqlite文件夹');
    console.log('如需指定其它位置，请阅读0.6.0-rc.0更新说明');
  }


  if (countChanged || cfg.version !== pjson.version) {
    cfg.version = pjson.version;
    setConfig(cfg, writeConfigToFile);
  }
};

class publicConfig {
  get rewindSeekTime() {
    return config.rewindSeekTime;
  }
  get forwardSeekTime() {
    return config.forwardSeekTime;
  }
  export() {
    return {
      rewindSeekTime: this.rewindSeekTime,
      forwardSeekTime: this.forwardSeekTime,
    };
  }
}

const sharedConfigHandle = new publicConfig();

// This part runs when the module is initialized
// TODO: refactor global side effect
if (!fs.existsSync(configPath)) {
  if (!fs.existsSync(configFolderDir)) {
    try {
      fs.mkdirSync(configFolderDir, { recursive: true });
    } catch(err) {
      console.error(` ! 在创建存放配置文件的文件夹时出错: ${err.message}`);
    }
  }
  const writeConfigToFile = !process.env.FREEZE_CONFIG_FILE;
  initConfig(writeConfigToFile);
} else {
  readConfig();
}

module.exports = {
  setConfig, updateConfig, config, sharedConfigHandle, configFolderDir
};
