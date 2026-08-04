const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
// Replacement for recursive-readdir: returns all files recursively as absolute paths
// Uses sync glob since the walked directories are bounded and the result is needed immediately.
const recursiveReaddir = (dir) => {
  return fs.globSync('**/*', { cwd: dir }).map(f => path.resolve(dir, f));
};
const { orderBy } = require('natural-orderby');
const { joinFragments } = require('../routes/utils/url');
const { config } = require('../config');

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

/**
 * Compute SHA-256 hex digest of a file's contents.
 * @param {String} filePath Absolute path to the file.
 * @returns {Promise<String>} SHA-256 hex string.
 */
const getContentHash = (filePath) => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
};
// Bound concurrency the same way getAudioFileDurationLimited does, so a work
// with many tracks doesn't spike disk I/O by hashing everything at once.
const getContentHashLimited = (filePath) => limitP.call(getContentHash, filePath);

/**
 * Lazily compute SHA-256 hashes for a work's audio files at tree-build time.
 * Reuses memo.hash[relPath] when the file's mtime is unchanged; computes
 * and caches otherwise. Never called at scan time — hashing only happens on
 * first tree-build after the feature ships, or on genuine file modification.
 * @param {String} work_id
 * @param {String} dir Work directory (absolute path).
 * @param {Object} oldMemo Existing memo ({ duration, mtime, hash }).
 * @returns {Promise<{memo: Object, changed: Boolean}>}
 */
async function scrapeWorkHashes(work_id, dir, oldMemo) {
  const files = await recursiveReaddir(dir);
  // oldMemo may be null for works never scraped (t_work.memo NULL). Be
  // null-safe like getTrackList's readMemo.duration || {} pattern, otherwise
  // a single unscanned work throws and 500s the whole tree endpoint.
  const safeMemo = oldMemo || {};
  const oldMemoHash = safeMemo.hash || {};
  const oldMemoMtime = safeMemo.mtime || {};
  const memo = { ...safeMemo, hash: { ...oldMemoHash } };
  let changed = false;

  const audioFiles = files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return supportedMediaExtList.includes(ext);
  });

  await Promise.all(audioFiles.map(async (file) => {
    const shortPath = file.replace(path.join(dir, '/'), '');
    // Async stat (not statSync): on a network mount each stat is a network
    // round-trip, and a sync stat blocks the event loop per file — serializing
    // N RTTs and stalling the parallel hash reads. Promise.all lets them overlap.
    const fstat = await fs.promises.stat(file);
    const newMTime = Math.round(fstat.mtime.getTime());
    const oldMTime = oldMemoMtime[shortPath];
    if (oldMemoHash[shortPath] !== undefined && oldMTime === newMTime) {
      return; // cached and unchanged — reuse
    }
    const hash = await getContentHashLimited(file);
    memo.hash[shortPath] = hash;
    memo.mtime[shortPath] = newMTime;
    changed = true;
  }));

  // Return the walked file list so the caller can hand it to getTrackList and
  // avoid a second recursiveReaddir of the same directory.
  return { memo, changed, files };
}

// 从文件系统，抓取单个作品本地文件的杂项信息：
//  * 音频文件对应的时长
//  * TODO：文件hash
// work_id: number
// dir: string, absolute path
// return json object:
//  {
//    duration: {
//      'relative/path/to/audio1.mp3': 334.23, // seconds
//      'relative/path/to/audio2.mp3': 34.3, // seconds
//      'relative/directory/to/audio2.wav': 34.23, // seconds
//    }
//  }
async function scrapeWorkMemo(work_id, dir, oldMemo) {
  const files = await recursiveReaddir(dir);
  // Filter out any files not matching these extensions
  const oldMemoMtime = oldMemo.mtime || {};
  const oldMemoDuration = oldMemo.duration || {};
  const memo = { duration: {}, isContainLyric: false, mtime: {} };
  await Promise.all(files
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      if (supportedSubtitleExtList.includes(ext)) {
        memo.isContainLyric = true;
      }
      return supportedMediaExtList.includes(ext);
    }) // filter
    .map((file) => ({
        fullPath: file,
        shortPath: file.replace(path.join(dir, '/'), '')
      })
    ) // map
    .map(async (fileDict) => {
      const fstat = fs.statSync(fileDict.fullPath);
      const newMTime = Math.round(fstat.mtime.getTime());
      const oldMTime = oldMemoMtime[fileDict.shortPath];
      const oldDuration = oldMemoDuration[fileDict.shortPath];
      
      if (oldMTime === undefined // 音频文件是新增的
        || oldDuration === undefined // 此前没有更新过这个文件的duration
        || oldMTime !== newMTime // 或者音频文件的最后修改时间和之前的memo记录不一致，说明文件有修改
      ) { // 更新duration和mtime
        console.log(`work[${work_id}] update data on file: ${fileDict.fullPath}, fstate.mtime: ${fstat.mtime.getTime()}, `);
        memo.mtime[fileDict.shortPath] = newMTime;
        const duration = await getAudioFileDurationLimited(fileDict.fullPath);
        if (! isNaN(duration) && typeof(duration) === 'number') {
          memo.duration[fileDict.shortPath] = duration;
        }
      } else { // 使用老的文件信息
        memo.mtime[fileDict.shortPath] = oldMTime;
        memo.duration[fileDict.shortPath] = oldDuration;
      }
    }) // map get duration
  ); // Promise.all
  return memo;
}

/**
 * Returns list of playable tracks in a given folder. Track is an object
 * containing 'title', 'subtitle' and 'hash'.
 * @param {String} id Work identifier (e.g. '123456', '01134567', 'd_215444').
 * @param {String} dir Work directory (absolute).
 * @param {readMemo} at least a empty object, or { duration: { "relative/path/audio.mp3": 33, "audio2.mp3": 22 }} for storage audio file duration
 */
const getTrackList = async function (id, dir, readMemo, files) {
  try {
    // Reuse a caller-provided file list (e.g. from scrapeWorkHashes) to avoid
    // walking the same directory twice during a single tree-build.
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
      const shortFilePath = file.replace(path.join(dir, '/'), '');
      const dirName = path.dirname(shortFilePath);

      return {
        title: path.basename(file),
        subtitle: dirName === '.' ? null : dirName,
        ext: path.extname(file).toLowerCase(),
        fullPath: file, // 给后面获取音频时长提供文件的全路径
        shortFilePath,
      };
    }), [v => v.subtitle, v => v.title, v => v.ext]);

    // Add hash to each file
    const sortedHashedFiles = sortedFiles.map(
      (file, index) => ({
        title: file.title,
        subtitle: file.subtitle,
        hash: `${id}/${index}`,
        ext: file.ext,
        fullPath: file.fullPath, // 给后面获取音频时长提供文件的全路径
        shortFilePath: file.shortFilePath,
      }),
    );

    const durationMemo = readMemo.duration || { /* fallback */ };
    const hashMemo = readMemo.hash || {};
    // add duration and contentHash for each audio
    const filesAddAudioDuration = await Promise.all(sortedHashedFiles.map(async (file) => {
      if (supportedMediaExtList.includes(file.ext)) {
        if (undefined !== durationMemo[file.shortFilePath]) {
          file.duration = durationMemo[file.shortFilePath];
        }
        if (undefined !== hashMemo[file.shortFilePath]) {
          file.contentHash = hashMemo[file.shortFilePath];
        }
      }
      // relPath (shortFilePath) is kept on the track so toTree can expose it
      // on audio nodes — the frontend uses it as the stable key to merge
      // late-arriving contentHash values from the /api/work/:id/memo endpoint.
      delete file.fullPath;

      return file;
    }));

    return filesAddAudioDuration;
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
    const pathParts = track.subtitle ? track.subtitle.split(path.sep) : [];
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
    const pathParts = track.subtitle ? track.subtitle.split(path.sep) : [];
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
  
    const textBaseUrl = '/api/media/stream/';
    const mediaStreamBaseUrl = '/api/media/stream/';
    const mediaDownloadBaseUrl = '/api/media/download/';
    const textStreamBaseUrl = textBaseUrl + track.hash;    // Handle charset detection internally with jschardet
    const textDownloadBaseUrl = config.offloadMedia ? offloadDownloadUrl : mediaDownloadBaseUrl + track.hash;
    const mediaStreamUrl = config.offloadMedia ? offloadStreamUrl : mediaStreamBaseUrl + track.hash;
    const mediaDownloadUrl = config.offloadMedia ? offloadDownloadUrl : mediaDownloadBaseUrl + track.hash;

    if (track.ext === '.txt' || track.ext === '.lrc' || track.ext === '.srt' || track.ext === '.ass' || track.ext === '.vtt') {
      fatherFolder.push({
        type: 'text',
        hash: track.hash,
        title: track.title,
        workTitle,
        mediaStreamUrl: textStreamBaseUrl,
        mediaDownloadUrl: textDownloadBaseUrl
      });
    } else if (track.ext === '.jpg' || track.ext === '.jpeg' || track.ext === '.png' || track.ext === '.webp' ) {
      fatherFolder.push({
        type: 'image',
        hash: track.hash,
        title: track.title,
        workTitle,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    } else if (track.ext === '.pdf') {
      fatherFolder.push({
        type: 'other',
        hash: track.hash,
        title: track.title,
        workTitle,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    } else {
      fatherFolder.push({
        type: 'audio',
        hash: track.hash,
        contentHash: track.contentHash,
        relPath: track.shortFilePath,
        title: track.title,
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
 * 返回一个成员为指定根文件夹下所有包含 RJ 号或 d_ 前缀的音声文件夹对象的数组，
 * 音声文件夹对象 { relativePath: '相对路径', rootFolderName: '根文件夹别名', id: '音声ID' }
 * @param {Object} rootFolder 根文件夹对象 { name: '别名', path: '绝对路径' }
 */
async function* getFolderList(rootFolder, current = '', depth = 0, logger = console ) { // 异步生成器函数 async function*() {}
  // 浅层遍历
  const folders = await fs.promises.readdir(path.join(rootFolder.path, current));    

  for (const folder of folders) {
    const absolutePath = path.resolve(rootFolder.path, current, folder);
    const relativePath = path.join(current, folder);

    try {
    // eslint-disable-next-line no-await-in-loop
      if ((await fs.promises.stat(absolutePath)).isDirectory()) { // 检查是否为文件夹
          const rjMatch = folder.match(/RJ(\d+)/);
          const fanzaMatch = folder.match(/d_(\d+)/);
          if (rjMatch) {
            // Found a DLsite work folder
            yield { absolutePath, relativePath, rootFolderName: rootFolder.name, id: formatID(parseInt(rjMatch[1], 10)) };
          } else if (fanzaMatch) {
            // Found a Fanza work folder
            yield { absolutePath, relativePath, rootFolderName: rootFolder.name, id: 'd_' + fanzaMatch[1] };
          } else if (depth + 1 < config.scannerMaxRecursionDepth) {
            // 若文件夹名称中不含有RJ号，就进入该文件夹内部
            // Found a folder that's not a work folder, go inside if allowed.
            yield* getFolderList(rootFolder, relativePath, depth + 1);
          }
        }
    } catch (err) {
      if (err.code === 'EPERM') {
        if (err.path && !err.path.endsWith('System Volume Information')) {
          logger.error(` ! 无法访问 ${err.path}`);
        }
      } else {
        throw err;
      }
    }
  }
}

/**
 * Generate the cover filename for a given work id and type.
 * @param {String} id Work id (e.g. '123456', '01134567', 'd_215444')
 * @param {String} type Cover type: 'main', 'sam', '240x240', '360x360'
 * @returns {String} Filename like 'RJ123456_img_main.jpg' or 'd_215444_img_main.jpg'
 */
function coverFileName(id, type) {
  if (String(id).startsWith('d_')) {
    return `${id}_img_${type}.jpg`;
  }
  return `RJ${id}_img_${type}.jpg`;
}

/**
 * Deletes a work's cover image from disk.
 * @param {String} id Work id (e.g. '123456', '01134567', 'd_215444').
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
 * @param {String} id Work id (e.g. '123456', '01134567', 'd_215444').
 * @param {String} type img type: ('main', 'sam', 'sam@2x', 'sam@3x', '240x240', '360x360').
 */
const saveCoverImageToDisk = (stream, id, type) => new Promise((resolve, reject) => {
  // TODO: don't assume image is a jpg?
  try {
    stream.pipe(
      fs.createWriteStream(path.join(config.coverFolderDir, coverFileName(id, type)))
        .on('close', () => resolve()),
    );
  } catch (err) {
    reject(err);
  }
});

/**
 * 格式化 id，适配 8 位、6 位 id
 * @param {number|string} id
 * @return {string}
 */
function formatID(id) {
  if (typeof id === 'string') return id; // already in final form ('123456', '01134567', 'd_215444')
  const n = parseInt(id, 10);
  return (n >= 1000000) ? `0${n}`.slice(-8) : `000000${n}`.slice(-6);
}

module.exports = {
  getTrackList,
  toTree,
  getFolderList,
  deleteCoverImageFromDisk,
  saveCoverImageToDisk,
  formatID,
  coverFileName,
  scrapeWorkMemo,
  getContentHash,
  scrapeWorkHashes,
};