const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const appDir = __dirname;
const dataRoot = process.env.KIKO_DATA_DIR || appDir;

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
const { normalizeBasePath } = require('./base-path');
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
  maxParallelism: 8,
  rootFolders: [
    // {
    //   name: '',
    //   path: ''
    // }
  ],
  skipWorkExtras: true, // Skip downloading all sample images, the desciption, and reviews
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
  basePath: '',
  blockRemoteConnection: false,
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
  enableTranscoding: true,
  transcodeBitrate: '96k',
  transcodeMaxConcurrent: 1,
  transcodeCacheDir: path.join(dataRoot, 'transcodes'),
  transcodeUseDefaultPath: false, // Ignores transcodeCacheDir if set to true
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
  resolveBasePath();
  if (writeConfigToFile) {
    fs.writeFileSync(configPath, JSON.stringify(config, null, "\t"));
  }
};

// Re-root a data folder that an earlier run pinned inside the application
// directory.
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
 * Resolve the four configurable data folders in place.
 *
 * Must run after ANY assignment into `config`, not just the initial read.
 */
const resolveDataFolders = () => {
  config.coverFolderDir = resolveDataFolder(config.coverFolderDir, 'covers', config.coverUseDefaultPath);
  config.imageFolderDir = resolveDataFolder(config.imageFolderDir, 'images', config.imageUseDefaultPath);
  config.databaseFolderDir = resolveDataFolder(config.databaseFolderDir, 'sqlite', config.dbUseDefaultPath);
  config.transcodeCacheDir = resolveDataFolder(config.transcodeCacheDir, 'transcodes', config.transcodeUseDefaultPath);
};

/**
 * Normalize the URL prefix in place, so every reader can just concatenate it
 * and so the tidied value is what gets written back to config.json.
 * Must run after ANY assignment into `config`, for the same reason
 * resolveDataFolders() does.
 */
const resolveBasePath = () => {
  config.basePath = normalizeBasePath(config.basePath);
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

  // Ignored, not dropped.
  const unknownKeys = Object.keys(config).filter(key => !(key in defaultConfig));
  if (unknownKeys.length) {
    console.log('配置项未被使用，已忽略:', unknownKeys.join(', '));
  }

  // Data folder paths: relative to dataRoot, or absolute, or forced to the
  // default. `useDefault` wins, then a relative path, then an absolute one.
  resolveDataFolders();
  resolveBasePath();

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
  get enableTranscoding() {
    return config.enableTranscoding;
  }
  export() {
    return {
      rewindSeekTime: this.rewindSeekTime,
      forwardSeekTime: this.forwardSeekTime,
      enableTranscoding: this.enableTranscoding,
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
  setConfig, updateConfig, config, sharedConfigHandle, configFolderDir, dataRoot
};
