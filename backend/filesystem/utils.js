const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
// Replacement for recursive-readdir: returns all files recursively as absolute paths
// Uses sync glob since the walked directories are bounded and the result is needed immediately.
const recursiveReaddir = (dir) => {
  return fs.globSync('**/*', { cwd: dir })
    .map(f => path.resolve(dir, f))
    // glob lists directories too, so one whose name ends in a known extension
    // (`bonus.txt/`) would otherwise be served as a ghost file of that type.
    // statSync follows symlinks, so a symlinked file still counts and a
    // symlinked directory still does not.
    .filter((file) => {
      try {
        return fs.statSync(file).isFile();
      } catch (err) {
        // Vanished between the walk and the stat; the walk itself is best effort.
        return false;
      }
    });
};
const { orderBy } = require('natural-orderby');
const { joinFragments, encodeTrackId } = require('../routes/utils/url');
const { config } = require('../config');
const { workno, isCustomWorkId, customWorkId } = require('../work-id');
const { findNfoEntry, readNfoMetadata, NfoConflictError } = require('./nfo');

const supportedMediaExtList = ['.mp3', '.ogg', '.opus', '.wav', '.aac', '.flac', '.webm', '.mp4', '.m4a', '.mka'];
const supportedSubtitleExtList = ['.lrc', '.srt', '.ass', ".vtt"]; // '.ass' only support show on file list, not for play lyric
const supportedImageExtList = ['.jpg', '.jpeg', '.png', '.webp'];

const LimitPromise = require('limit-promise'); // 限制并发数量
const limitP = new LimitPromise(config.maxParallelism); // 核心控制器
const util = require('util');
const execFile = util.promisify(require('child_process').execFile);

async function getAudioFileDuration(filePath) {
  try {
    // 默认环境中已经安装了ffprobe命令
    const { stdout } = await execFile('ffprobe', [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath,
    ]);
    const durationSecs = parseFloat(stdout);
    return durationSecs;
  } catch (err) {
    console.error(`get duration failed, file = ${filePath}`, err);
  }
  return NaN;
}
const getAudioFileDurationLimited = (filePath) => limitP.call(getAudioFileDuration, filePath);


const transcodeLimitP = new LimitPromise(config.transcodeMaxConcurrent || 1);

/**
 * Deterministic cache filename for a transcoded (Opus) copy of a track.
 *
 * @param {String} id Work id (e.g. '123456', 'd215444').
 * @param {String} relPath Work-relative path of the source file.
 * @param {Number|String} mtime Source mtime (ms), from memo.mtime.
 * @param {String} bitrate ffmpeg -b:a value, e.g. '96k'.
 * @returns {String} e.g. '123456_a1b2c3d4e5f6a7b8.opus'
 */
function transcodeFileName(id, relPath, mtime, bitrate) {
  const digest = crypto.createHash('sha256')
    .update(`${relPath}\u0000${mtime}\u0000${bitrate}`)
    .digest('hex')
    .slice(0, 16);
  return `${id}_${digest}.opus`;
}

/**
 * Transcode an audio file to Opus at the given bitrate, writing through a
 * temp file + rename so a concurrent request for the same track never sees a
 * partially-written cache file
 * @param {String} sourcePath Absolute path to the source (lossless) audio file.
 * @param {String} cachePath Absolute path to write the final Opus file to.
 * @param {String} bitrate ffmpeg -b:a value, e.g. '96k'.
 */
async function transcodeToOpus(sourcePath, cachePath, bitrate) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  const tmpPath = `${cachePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await execFile('ffmpeg', [
      '-y',
      '-i', sourcePath,
      '-map_metadata', '-1',
      '-vn',
      '-c:a', 'libopus',
      '-b:a', bitrate,
      tmpPath,
    ], { timeout: 600000 });
    fs.renameSync(tmpPath, cachePath);
  } catch (err) {
    try {
      fs.unlinkSync(tmpPath);
    } catch (unlinkErr) {
      // ENOENT is fine -- ffmpeg may have failed before ever writing tmpPath
      if (unlinkErr.code !== 'ENOENT') {
        console.error(`failed to clean up transcode tmp file: ${tmpPath}`, unlinkErr);
      }
    }
    throw err;
  }
}
const transcodeToOpusLimited = (sourcePath, cachePath, bitrate) => transcodeLimitP.call(transcodeToOpus, sourcePath, cachePath, bitrate);

/**
 * Attach `duration` and `mtime` to the audio tracks in a list, probing only what
 * has actually changed.
 *
 * @param {String} work_id for logging only
 * @param {Array} tracks getTrackList output, mutated in place
 * @param {Map<String, {duration, mtime}>} known previously recorded, by relPath
 * @returns {Promise<Array>} the same tracks
 */
async function probeAudioDurations (work_id, tracks, known = new Map()) {
  await Promise.all(tracks.map(async (track) => {
    if (!supportedMediaExtList.includes(track.ext)) return;

    const previous = known.get(track.shortFilePath) || {};
    let newMTime;
    try {
      newMTime = Math.round(fs.statSync(track.fullPath).mtime.getTime());
    } catch (err) {
      // Gone or unreadable between the walk and now. Keep whatever was known.
      console.error(`work[${work_id}] stat failed, file = ${track.fullPath}`, err);
      track.duration = previous.duration;
      track.mtime = previous.mtime;
      return;
    }

    const unchanged = previous.mtime !== undefined
      && previous.mtime === newMTime
      && previous.duration !== undefined;
    if (unchanged) {
      track.duration = previous.duration;
      track.mtime = previous.mtime;
      return;
    }

    console.log(`work[${work_id}] probing duration: ${track.fullPath}`);
    track.mtime = newMTime;
    const duration = await getAudioFileDurationLimited(track.fullPath);
    track.duration = (!isNaN(duration) && typeof duration === 'number') ? duration : undefined;
  }));
  return tracks;
}

/**
 * Returns list of playable tracks in a given folder. Track is an object
 * containing 'title', 'subtitle' and 'trackId'.
 * @param {String} id Work identifier (e.g. '123456', '01134567', 'd215444').
 * @param {String} dir Work directory (absolute).
 * @param {Array} files Optional list of files to process.
 */
const getTrackList = async function (id, dir, files) {
  try {
    const walkedFiles = files || (await recursiveReaddir(dir));
    // Filter out any files not matching these extensions
    const filteredFiles = walkedFiles.filter((file) => {
      const ext = path.extname(file).toLowerCase();

      return (
        supportedMediaExtList.includes(ext)
        || supportedSubtitleExtList.includes(ext)
        || supportedImageExtList.includes(ext)
        || ext === '.txt'
        || ext === '.pdf'
      );
    });

    // Sort by folder and title
    const sortedFiles = orderBy(filteredFiles.map((file) => {
      const shortFilePath = file.replace(path.join(dir, '/'), '').split(path.sep).join('/');
      const dirName = path.dirname(shortFilePath);

      return {
        title: path.basename(file),
        subtitle: dirName === '.' ? null : dirName,
        ext: path.extname(file).toLowerCase(),
        fullPath: file, // 给后面获取音频时长提供文件的全路径
        shortFilePath,
      };
    }), [v => v.subtitle, v => v.title, v => v.ext]);

    // Add trackId (file handle) to each file.
    const sortedHashedFiles = sortedFiles.map(
      (file) => ({
        title: file.title,
        subtitle: file.subtitle,
        trackId: `${id}/${file.shortFilePath}`,
        ext: file.ext,
        fullPath: file.fullPath,
        shortFilePath: file.shortFilePath,
      }),
    );

    // fullPath is kept: probeAudioDurations stats it, and workFiles builds the
    // media paths from it. Callers that return this to a client strip it.
    return sortedHashedFiles;
  } catch (err) {
    console.log('getTracList error = ', err);
    throw new Error(`Failed to get tracklist from disk: ${err}`);
  }
};

/**
 * 转换成树状结构
 * @param {Array} tracks 
 * @param {String} workTitle 
 */
const toTree = (tracks, workTitle, workDir, rootFolder) => {
  const tree = [];

  // 插入文件夹
  tracks.forEach(track => {
    let fatherFolder = tree;
    // subtitle is forward-slash on every platform (getTrackList and rowsToTracks
    // normalize it), so split on '/' -- path.sep left a Windows tree flat.
    const pathParts = track.subtitle ? track.subtitle.split('/') : [];
    pathParts.forEach(folderName => {
      const index = fatherFolder.findIndex(item => item.type === 'folder' && item.title === folderName);
      if (index === -1) {
        fatherFolder.push({
          type: 'folder',
          title: folderName,
          children: []
        });
      }
      fatherFolder = fatherFolder.find(item => item.type === 'folder' && item.title === folderName).children;
    });
  });

  // 插入文件
  tracks.forEach(track => {
    let fatherFolder = tree;
    const pathParts = track.subtitle ? track.subtitle.split('/') : [];
    pathParts.forEach(folderName => {
      fatherFolder = fatherFolder.find(item => item.type === 'folder' && item.title === folderName).children;
    });

    // Path controlled by config.offloadMedia, config.offloadStreamPath and config.offloadDownloadPath
    // If config.offloadMedia is enabled, by default, the paths are:
    // /media/stream/VoiceWork/RJ123456/subdirs/track.mp3
    // /media/download//VoiceWork/RJ123456/subdirs/track.mp3
    //
    // If the folder is deeper:
    // /media/stream/VoiceWork/second/RJ123456/subdirs/track.mp3
    // /media/download/VoiceWork/second/RJ123456/subdirs/track.mp3
    let offloadStreamUrl = joinFragments(config.offloadStreamPath, rootFolder.name, workDir, track.subtitle || '', track.title);
    let offloadDownloadUrl = joinFragments(config.offloadDownloadPath, rootFolder.name, workDir, track.subtitle || '', track.title);
    if (process.platform === 'win32') {
      offloadStreamUrl = offloadStreamUrl.replace(/\\/g, '/');
      offloadDownloadUrl = offloadDownloadUrl.replace(/\\/g, '/');
    }
  
    // These go to the browser as <audio>/<a href> sources, so they carry the
    // deploy prefix. The offload URLs above deliberately do not: they address
    // the reverse proxy's own virtual directories, which the operator names in
    // offloadStreamPath/offloadDownloadPath.
    const textBaseUrl = `${config.basePath}/api/media/stream/`;
    const mediaStreamBaseUrl = `${config.basePath}/api/media/stream/`;
    const mediaDownloadBaseUrl = `${config.basePath}/api/media/download/`;
    // Encoded: a relPath is a file name, so it can contain '#', '?' or '%',
    // which are URL syntax. See encodeTrackId.
    const encodedTrackId = encodeTrackId(track.trackId);
    const textStreamBaseUrl = textBaseUrl + encodedTrackId;    // Handle charset detection internally with jschardet
    const textDownloadBaseUrl = config.offloadMedia ? offloadDownloadUrl : mediaDownloadBaseUrl + encodedTrackId;
    const mediaStreamUrl = config.offloadMedia ? offloadStreamUrl : mediaStreamBaseUrl + encodedTrackId;
    const mediaDownloadUrl = config.offloadMedia ? offloadDownloadUrl : mediaDownloadBaseUrl + encodedTrackId;

    if (track.ext === '.txt' || track.ext === '.lrc' || track.ext === '.srt' || track.ext === '.ass' || track.ext === '.vtt') {
      fatherFolder.push({
        type: 'text',
        trackId: track.trackId,
        relPath: track.shortFilePath,
        title: track.title,
        workTitle,
        mediaStreamUrl: textStreamBaseUrl,
        mediaDownloadUrl: textDownloadBaseUrl
      });
    } else if (track.ext === '.jpg' || track.ext === '.jpeg' || track.ext === '.png' || track.ext === '.webp' ) {
      fatherFolder.push({
        type: 'image',
        trackId: track.trackId,
        relPath: track.shortFilePath,
        title: track.title,
        workTitle,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    } else if (track.ext === '.pdf') {
      fatherFolder.push({
        type: 'other',
        trackId: track.trackId,
        relPath: track.shortFilePath,
        title: track.title,
        workTitle,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    } else {
      fatherFolder.push({
        type: 'audio',
        trackId: track.trackId,
        relPath: track.shortFilePath,
        title: track.title,
        trackTitle: track.trackTitle, // display name, falls back to title in the UI
        duration: track.duration,
        workTitle,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    }
  });

  return tree;
};

/**
 * 音声文件夹名称 → 音声ID，三种命名约定：DLsite 的 RJ、DLsite books 的 BJ、Fanza 的 d_。
 * @param {String} name Folder name.
 * @returns {String|null} Work id, null when the name carries no work code.
 */
function matchWorkFolderName(name) {
  const rjMatch = name.match(/RJ(\d+)/i);
  if (rjMatch) return formatID(parseInt(rjMatch[1], 10));

  // DLsite's books floor (成年コミック/出版社) numbers its voice works
  // BJ instead of RJ; the prefix is kept in the id because the digits
  // alone would collide with an RJ work.
  const bjMatch = name.match(/BJ(\d+)/i);
  if (bjMatch) return `BJ${formatID(parseInt(bjMatch[1], 10))}`;

  // Fanza names its folders after the cid (`d_215444`); the underscore-free
  // spelling is accepted too, but only at a word boundary and with enough
  // digits that a folder like `Sound_CD1` cannot be read as a work code.
  const fanzaMatch = name.match(/d_(\d+)/) || name.match(/(?:^|[^a-z0-9])d(\d{4,})/i);
  if (fanzaMatch) return 'd' + fanzaMatch[1];

  return null;
}

/** Directory entries, tolerating the unreadable system folders Windows leaves behind. */
async function readEntries(dirPath, logger) {
  try {
    return await fs.promises.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'EPERM') {
      if (err.path && !err.path.endsWith('System Volume Information')) {
        logger.error(` ! 无法访问 ${err.path}`);
      }
      return [];
    }
    throw err;
  }
}

/**
 * Every direct child that claims itself as a work.
 *
 * A sidecar folder owning such a child would put the same files in two works,
 * so the scan refuses to guess which one wins.
 */
async function findNestedClaims(dirPath, entries, logger) {
  const claims = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const childPath = path.join(dirPath, entry.name);
    if (matchWorkFolderName(entry.name)) {
      claims.push(childPath);
      continue;
    }
    if (findNfoEntry(await readEntries(childPath, logger))) {
      claims.push(childPath);
    }
  }
  return claims;
}

/**
 * 返回一个成员为指定根文件夹下所有音声文件夹对象的数组，
 * 音声文件夹对象 { relativePath: '相对路径', rootFolderName: '根文件夹别名', id: '音声ID' }
 *
 * A folder belongs to exactly one work. A work code in the name claims it, or a
 * `kikoenai.nfo` / `.kikoenai.nfo` sidecar does (see nfo.js). Both at once — or
 * a sidecar folder that contains another claim — throws NfoConflictError and
 * stops the walk: the files would otherwise belong to two works at once.
 *
 * @param {Object} rootFolder 根文件夹对象 { name: '别名', path: '绝对路径' }
 */
async function* getFolderList(rootFolder, current = '', depth = 0, logger = console, entries = null) { // 异步生成器函数 async function*() {}
  const currentEntries = entries || await readEntries(path.join(rootFolder.path, current), logger);

  for (const entry of currentEntries) {
    const name = entry.name;
    const absolutePath = path.resolve(rootFolder.path, current, name);
    const relativePath = path.join(current, name);

    let isDirectory = entry.isDirectory();
    if (!isDirectory && entry.isSymbolicLink()) {
      // stat follows symlinks, so a linked folder still counts -- as it did when
      // every entry was stat'ed here.
      try {
        isDirectory = (await fs.promises.stat(absolutePath)).isDirectory();
      } catch (err) {
        if (err.code !== 'EPERM') throw err;
        if (err.path && !err.path.endsWith('System Volume Information')) {
          logger.error(` ! 无法访问 ${err.path}`);
        }
        continue;
      }
    }
    if (!isDirectory) continue;

    const childEntries = await readEntries(absolutePath, logger);
    const workId = matchWorkFolderName(name);
    const nfoName = findNfoEntry(childEntries);

    if (workId && nfoName) {
      throw new NfoConflictError(
        '文件夹同时有作品编号和 nfo 文件，请移除其中一个后重新扫描',
        [absolutePath, path.join(absolutePath, nfoName)],
      );
    }

    if (nfoName) {
      const claims = await findNestedClaims(absolutePath, childEntries, logger);
      if (claims.length) {
        throw new NfoConflictError(
          '自定义作品文件夹内还有别的作品，请分开后再重新扫描',
          [absolutePath, ...claims],
        );
      }

      yield {
        absolutePath,
        relativePath,
        rootFolderName: rootFolder.name,
        id: customWorkId(rootFolder.name, relativePath),
        // Parsed here so a broken file aborts the scan before anything is written.
        nfoMetadata: readNfoMetadata(absolutePath, nfoName),
      };
      continue;
    }

    if (workId) {
      yield { absolutePath, relativePath, rootFolderName: rootFolder.name, id: workId };
      continue;
    }

    if (depth + 1 < config.scannerMaxRecursionDepth) {
      // 若文件夹名称中不含有RJ号，就进入该文件夹内部
      // Found a folder that's not a work folder, go inside if allowed.
      yield* getFolderList(rootFolder, relativePath, depth + 1, logger, childEntries);
    }
  }
}

/**
 * Generate the cover filename for a given work id and type.
 * @param {String} id Work id (e.g. '123456', '01134567', 'd215444', or a custom uuid)
 * @param {String} type Cover type: 'main', 'sam', '240x240', '360x360'
 * @returns {String} Filename like 'RJ123456_img_main.jpg' or 'd_215444_img_main.jpg'
 *          (on-disk names keep Fanza's own underscore form — see work-id.js).
 *          A custom work has no store code, so its id is the prefix.
 */
function coverFileName(id, type) {
  const prefix = isCustomWorkId(id) ? String(id).toLowerCase() : workno(id);
  return `${prefix}_img_${type}.jpg`;
}

/**
 * Deletes a work's cover image from disk.
 * @param {String} id Work id (e.g. '123456', '01134567', 'd215444').
 */
const deleteCoverImageFromDisk = id => new Promise((resolve, reject) => {
  const types = ['main', 'sam', '240x240', '360x360'];
  types.forEach(type => {
    try {
      fs.unlinkSync(path.join(config.coverFolderDir, coverFileName(id, type)));
    } catch (err) {
      // ENOENT is fine — file may not exist
      if (err.code !== 'ENOENT') {
        reject(err);
      }
    }
  });

  resolve();
});

/**
 * Saves cover image to disk.
 * @param {ReadableStream} stream Image data stream.
 * @param {String} id Work id (e.g. '123456', '01134567', 'd215444').
 * @param {String} type img type: ('main', 'sam', 'sam@2x', 'sam@3x', '240x240', '360x360').
 */
const saveCoverImageToDisk = (stream, id, type) => new Promise((resolve, reject) => {
  // TODO: don't assume image is a jpg?
  try {
    stream.pipe(
      fs.createWriteStream(path.join(config.coverFolderDir, coverFileName(id, type)))
        .on('close', () => resolve())
        .on('error', reject),
    );
  } catch (err) {
    reject(err);
  }
});

/**
 * Collects every image a work page offers.
 * @param {Object} metadata Scraped work metadata.
 * @returns {Array<Object>} [{ kind, url, thumb, width, height }]
 */
function collectWorkImages(metadata) {
  const images = [];
  const seen = new Set();

  const push = (kind, image) => {
    if (!image || !image.url || seen.has(image.url)) return;
    seen.add(image.url);
    images.push({
      kind,
      url: image.url,
      thumb: image.thumb || null,
      width: image.width || null,
      height: image.height || null,
    });
  };

  for (const sample of metadata.sampleImages || []) {
    push('smp', sample);
  }
  for (const part of metadata.descriptionParts || []) {
    for (const url of part.images || []) {
      push('part', { url });
    }
  }

  return images;
}

/**
 * Generate the on-disk filename for one scraped work image.
 *
 * @param {String} id Work id (e.g. '123456', '01134567', 'd215444')
 * @param {String} kind 'smp' for a sample-slider image, 'part' for one embedded in the description
 * @param {Number} index 1-based position within its kind
 * @param {String} [ext='jpg'] File extension, without the dot
 * @returns {String} Filename like 'RJ123456_img_smp1.jpg'
 */
function workImageFileName(id, kind, index, ext = 'jpg') {
  const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : 'jpg';
  const prefix = workno(id);
  return `${prefix}_img_${kind}${index}.${safeExt}`;
}

/**
 * Matches every on-disk image name belonging to a work.
 *
 * @param {String} id Work id (e.g. '123456', '01134567', 'd215444').
 * @returns {RegExp}
 */
function workImageFileNamePattern(id) {
  const prefix = workno(id).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${prefix}_img_(smp|part)\\d+\\.[a-z0-9]+$`, 'i');
}

/**
 * Saves one scraped work image to the image folder.
 * @param {ReadableStream} stream Image data stream.
 * @param {String} fileName Output name, from workImageFileName.
 */
const saveWorkImageToDisk = (stream, fileName) => new Promise((resolve, reject) => {
  try {
    stream.pipe(
      fs.createWriteStream(path.join(config.imageFolderDir, fileName))
        .on('close', () => resolve())
        .on('error', reject),
    );
  } catch (err) {
    reject(err);
  }
});

/**
 * Deletes the scraped images belonging to a work.
 *
 * @param {String} id Work id (e.g. '123456', '01134567', 'd215444').
 * @param {Set<String>} [keep] File names to spare, for pruning after a download.
 * @returns {Promise<Number>} How many files were deleted.
 */
const deleteWorkImagesFromDisk = async (id, keep) => {
  const pattern = workImageFileNamePattern(id);

  let entries;
  try {
    entries = await fs.promises.readdir(config.imageFolderDir);
  } catch (err) {
    if (err.code === 'ENOENT') return 0; // no image folder yet, nothing to delete
    throw err;
  }

  const doomed = entries.filter(name => pattern.test(name) && !(keep && keep.has(name)));

  await Promise.all(doomed.map(async (name) => {
    try {
      await fs.promises.unlink(path.join(config.imageFolderDir, name));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }));

  return doomed.length;
};

/**
 * 格式化 id，适配 8 位、6 位 id
 * @param {number|string} id
 * @return {string}
 */
function formatID(id) {
  if (typeof id === 'string') return id; // already in final form ('123456', '01134567', 'd215444')
  const n = parseInt(id, 10);
  return (n >= 1000000) ? `0${n}`.slice(-8) : `000000${n}`.slice(-6);
}

module.exports = {
  supportedMediaExtList,
  supportedSubtitleExtList,
  getTrackList,
  toTree,
  getFolderList,
  matchWorkFolderName,
  deleteCoverImageFromDisk,
  saveCoverImageToDisk,
  collectWorkImages,
  workImageFileName,
  workImageFileNamePattern,
  saveWorkImageToDisk,
  deleteWorkImagesFromDisk,
  formatID,
  coverFileName,
  probeAudioDurations,
  transcodeFileName,
  transcodeToOpusLimited,
};