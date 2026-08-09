const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
// Replacement for recursive-readdir: returns all files recursively as absolute paths
// Uses sync glob since the walked directories are bounded and the result is needed immediately.
const recursiveReaddir = (dir) => {
  return fs.globSync('**/*', { cwd: dir }).map(f => path.resolve(dir, f));
};
const { orderBy } = require('natural-orderby');
const { joinFragments } = require('../routes/utils/url');
const { config } = require('../config');
const { isFanzaId, fanzaCid } = require('../work-id');

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
 * Compute CRC32 hex digest of a file's contents, streamed chunk-by-chunk
 * (zlib.crc32 takes a running CRC so this mirrors the old SHA-256 streaming).
 * ponytail: CRC32 (2^32) is not collision-resistant globally, but it doesn't
 * need to be — t_track_progress PK is (user, work, track_key) so uniqueness
 * only needs to hold within one work (~tens of tracks, birthday ~3e-7).
 * Benchmark on the self-hosted matrix (NFS+fast CPU warm): crc32 ~1.6s,
 * xxh3 ~1.9s, sha256 ~4.5s, blake2s256 ~9s over 7.5GB — crc32 wins, ships with
 * Node (no dep, no WASM to allow/disallow on locked-down embedded runtimes).
 * @param {String} filePath Absolute path to the file.
 * @returns {Promise<String>} 8-char CRC32 hex string.
 */
const getContentHash = (filePath) => {
  return new Promise((resolve, reject) => {
    let crc = 0;
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => { crc = zlib.crc32(chunk, crc); });
    stream.on('end', () => resolve((crc >>> 0).toString(16).padStart(8, '0')));
    stream.on('error', (err) => reject(err));
  });
};
// Bound concurrency the same way getAudioFileDurationLimited does, so a work
// with many tracks doesn't spike disk I/O by hashing everything at once.
const getContentHashLimited = (filePath) => limitP.call(getContentHash, filePath);

// Transcoding is CPU-heavy and this runs on modest self-hosted hardware
// (NAS/RPi), so it gets its own, smaller, dedicated concurrency budget --
// deliberately separate from limitP (sized by maxParallelism), which bounds
// cheap I/O-bound work (ffprobe, hashing), not CPU-bound encoding.
const transcodeLimitP = new LimitPromise(config.transcodeMaxConcurrent || 1);

/**
 * Deterministic cache filename for a transcoded (Opus) copy of a track.
 * Content-hash-addressed: cache invalidation is automatic -- a changed source
 * file produces a different hash, so a new cache filename is derived and the
 * old one is simply orphaned, mirroring how coverFileName's id+type keying
 * needs no explicit invalidation step either.
 * @param {String} id Work id (e.g. '123456', 'd_215444').
 * @param {String} contentHash CRC32 hex digest of the source file.
 * @returns {String} e.g. '123456_a1b2c3d4.opus'
 */
function transcodeFileName(id, contentHash) {
  return `${id}_${contentHash}.opus`;
}

/**
 * Transcode an audio file to Opus at the given bitrate, writing through a
 * temp file + rename so a concurrent request for the same track never sees a
 * partially-written cache file -- unlike ffprobe's sub-second probe, a
 * transcode can take minutes, so a plain write is a real corruption risk here.
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
 * Lazily compute CRC32 content hashes for a work's audio files at tree-build time.
 * Reuses memo.hash[relPath] when the file's mtime is unchanged; computes
 * and caches otherwise. Never called at scan time — hashing only happens on
 * first tree-build after the feature ships, or on genuine file modification.
 * @param {String} work_id
 * @param {String} dir Work directory (absolute path).
 * @param {Object} oldMemo Existing memo ({ duration, mtime, contentHash }).
 * @returns {Promise<{memo: Object, changed: Boolean, files: Array}>}
 */
async function scrapeWorkHashes(work_id, dir, oldMemo) {
  const files = await recursiveReaddir(dir);
  // oldMemo may be null for works never scraped (t_work.memo NULL). Be
  // null-safe like getTrackList's readMemo.duration || {} pattern, otherwise
  // a single unscanned work throws and 500s the whole tree endpoint.
  const safeMemo = oldMemo || {};
  // Read-side compat: new memos store contentHash, old memos may have hash.
  const oldMemoHash = safeMemo.contentHash || safeMemo.hash || {};
  const oldMemoMtime = safeMemo.mtime || {};
  const memo = { ...safeMemo, contentHash: { ...oldMemoHash }, mtime: { ...oldMemoMtime } };
  // Remove the old `hash` key if present (migrate to contentHash in-memory;
  // the next setWorkMemo will persist the new key).
  if (memo.hash) delete memo.hash;
  let changed = false;

  const audioFiles = files.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return supportedMediaExtList.includes(ext);
  });

  await Promise.all(audioFiles.map(async (file) => {
    const shortPath = file.replace(path.join(dir, '/'), '');
    // Skip files we cannot read. This runs inside GET /api/tracks/:id, so a
    // throw here would fail the whole file list. The node just gets no hash.
    try {
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
      memo.contentHash[shortPath] = hash;
      memo.mtime[shortPath] = newMTime;
      changed = true;
    } catch (err) {
      console.error(`work[${work_id}] hash failed, file = ${file}`, err);
    }
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
  const oldMemoMtime = (oldMemo || {}).mtime || {};
  const oldMemoDuration = (oldMemo || {}).duration || {};
  // Callers pass the object below to db.setWorkMemo(), which replaces the whole
  // t_work.memo JSON column. So copy oldMemo into it: an object literal holding
  // only the keys this function fills in would drop the ones other code writes,
  // contentHash and trackTitles, on every rescan. duration and mtime are
  // rebuilt further down, so they start empty.
  const memo = { ...(oldMemo || {}), duration: {}, isContainLyric: false, mtime: {} };
  // The spread above is shallow, so memo.contentHash is still oldMemo's object.
  // Copy it, because the loop below deletes stale entries from it.
  if (memo.contentHash) memo.contentHash = { ...memo.contentHash };
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
        // The file changed, so its old contentHash is stale. Drop it, or the
        // mtime written on the line above would make scrapeWorkHashes treat
        // that stale hash as valid. Test the mtime again here instead of
        // relying on the enclosing if: that condition also passes when only
        // the duration is missing, which says nothing about the contents.
        // A file with no old mtime is new and has no hash to drop.
        if (oldMTime !== undefined && oldMTime !== newMTime && memo.contentHash) {
          delete memo.contentHash[fileDict.shortPath];
        }
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
 * containing 'title', 'subtitle' and 'trackId'.
 * @param {String} id Work identifier (e.g. '123456', '01134567', 'd215444').
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

    // Add trackId (file handle) to each file
    const sortedHashedFiles = sortedFiles.map(
      (file, index) => ({
        title: file.title,
        subtitle: file.subtitle,
        trackId: `${id}/${index}`,
        ext: file.ext,
        fullPath: file.fullPath, // 给后面获取音频时长提供文件的全路径
        shortFilePath: file.shortFilePath,
      }),
    );

    const durationMemo = readMemo.duration || { /* fallback */ };
    const hashMemo = readMemo.contentHash || readMemo.hash || {};
    // Human-readable track names, keyed by relPath like the two memos above.
    // Populated out-of-band (see backend/scripts/extract-track-titles.js) for
    // works whose files are named "01.mp3", "#2.wav" and the like. Kept in a
    // field of its own rather than overwriting `title`: `title` is the real
    // filename and toTree builds the stream/download URLs from it.
    const trackTitleMemo = readMemo.trackTitles || {};
    // add duration, contentHash and track title for each audio
    const filesAddAudioDuration = await Promise.all(sortedHashedFiles.map(async (file) => {
      if (supportedMediaExtList.includes(file.ext)) {
        if (undefined !== durationMemo[file.shortFilePath]) {
          file.duration = durationMemo[file.shortFilePath];
        }
        if (undefined !== hashMemo[file.shortFilePath]) {
          file.contentHash = hashMemo[file.shortFilePath];
        }
        if (trackTitleMemo[file.shortFilePath]) {
          file.trackTitle = trackTitleMemo[file.shortFilePath];
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
  
    // These go to the browser as <audio>/<a href> sources, so they carry the
    // deploy prefix. The offload URLs above deliberately do not: they address
    // the reverse proxy's own virtual directories, which the operator names in
    // offloadStreamPath/offloadDownloadPath.
    const textBaseUrl = `${config.basePath}/api/media/stream/`;
    const mediaStreamBaseUrl = `${config.basePath}/api/media/stream/`;
    const mediaDownloadBaseUrl = `${config.basePath}/api/media/download/`;
    const textStreamBaseUrl = textBaseUrl + track.trackId;    // Handle charset detection internally with jschardet
    const textDownloadBaseUrl = config.offloadMedia ? offloadDownloadUrl : mediaDownloadBaseUrl + track.trackId;
    const mediaStreamUrl = config.offloadMedia ? offloadStreamUrl : mediaStreamBaseUrl + track.trackId;
    const mediaDownloadUrl = config.offloadMedia ? offloadDownloadUrl : mediaDownloadBaseUrl + track.trackId;

    if (track.ext === '.txt' || track.ext === '.lrc' || track.ext === '.srt' || track.ext === '.ass' || track.ext === '.vtt') {
      fatherFolder.push({
        type: 'text',
        trackId: track.trackId,
        title: track.title,
        workTitle,
        mediaStreamUrl: textStreamBaseUrl,
        mediaDownloadUrl: textDownloadBaseUrl
      });
    } else if (track.ext === '.jpg' || track.ext === '.jpeg' || track.ext === '.png' || track.ext === '.webp' ) {
      fatherFolder.push({
        type: 'image',
        trackId: track.trackId,
        title: track.title,
        workTitle,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    } else if (track.ext === '.pdf') {
      fatherFolder.push({
        type: 'other',
        trackId: track.trackId,
        title: track.title,
        workTitle,
        mediaStreamUrl,
        mediaDownloadUrl
      });
    } else {
      fatherFolder.push({
        type: 'audio',
        trackId: track.trackId,
        contentHash: track.contentHash,
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
     
      if ((await fs.promises.stat(absolutePath)).isDirectory()) { // 检查是否为文件夹
          const rjMatch = folder.match(/RJ(\d+)/);
          // Fanza names its folders after the cid (`d_215444`); the
          // underscore-free spelling is accepted too, but only at a word
          // boundary and with enough digits that a folder like `Sound_CD1`
          // cannot be read as a work code.
          const fanzaMatch = folder.match(/d_(\d+)/) || folder.match(/(?:^|[^a-z0-9])d(\d{4,})/i);
          if (rjMatch) {
            // Found a DLsite work folder
            yield { absolutePath, relativePath, rootFolderName: rootFolder.name, id: formatID(parseInt(rjMatch[1], 10)) };
          } else if (fanzaMatch) {
            // Found a Fanza work folder
            yield { absolutePath, relativePath, rootFolderName: rootFolder.name, id: 'd' + fanzaMatch[1] };
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
 * @param {String} id Work id (e.g. '123456', '01134567', 'd215444')
 * @param {String} type Cover type: 'main', 'sam', '240x240', '360x360'
 * @returns {String} Filename like 'RJ123456_img_main.jpg' or 'd_215444_img_main.jpg'
 *          (on-disk names keep Fanza's own underscore form — see work-id.js)
 */
function coverFileName(id, type) {
  if (isFanzaId(id)) {
    return `${fanzaCid(id)}_img_${type}.jpg`;
  }
  return `RJ${id}_img_${type}.jpg`;
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
        .on('close', () => resolve()),
    );
  } catch (err) {
    reject(err);
  }
});

/**
 * Generate the on-disk filename for one scraped work image.
 *
 * Named by position rather than by the remote basename: description images
 * are served under opaque md5-ish names that collide across works, and the
 * sample slider's own names are only stable while DLsite keeps them.
 * @param {String} id Work id (e.g. '123456', '01134567', 'd215444')
 * @param {String} kind 'smp' for a sample-slider image, 'part' for one embedded in the description
 * @param {Number} index 1-based position within its kind
 * @param {String} [ext='jpg'] File extension, without the dot
 * @returns {String} Filename like 'RJ123456_img_smp1.jpg'
 */
function workImageFileName(id, kind, index, ext = 'jpg') {
  const safeExt = /^[a-z0-9]{1,5}$/i.test(ext) ? ext.toLowerCase() : 'jpg';
  const prefix = isFanzaId(id) ? fanzaCid(id) : `RJ${id}`;
  return `${prefix}_img_${kind}${index}.${safeExt}`;
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
 * Deletes every scraped image belonging to a work.
 *
 * Matched by pattern rather than from the stored list, so images left behind
 * by an earlier scrape (a work whose sample count shrank) go too. The match is
 * deliberately narrow — a deployment that points imageFolderDir at the cover
 * folder must not lose its covers here.
 * @param {String} id Work id (e.g. '123456', '01134567', 'd215444').
 */
const deleteWorkImagesFromDisk = async (id) => {
  const prefix = isFanzaId(id) ? fanzaCid(id) : `RJ${id}`;
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_img_(smp|part)\\d+\\.[a-z0-9]+$`, 'i');

  let entries;
  try {
    entries = await fs.promises.readdir(config.imageFolderDir);
  } catch (err) {
    if (err.code === 'ENOENT') return; // no image folder yet, nothing to delete
    throw err;
  }

  await Promise.all(entries
    .filter(name => pattern.test(name))
    .map(async (name) => {
      try {
        await fs.promises.unlink(path.join(config.imageFolderDir, name));
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }));
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
  getTrackList,
  toTree,
  getFolderList,
  deleteCoverImageFromDisk,
  saveCoverImageToDisk,
  workImageFileName,
  saveWorkImageToDisk,
  deleteWorkImagesFromDisk,
  formatID,
  coverFileName,
  scrapeWorkMemo,
  getContentHash,
  getContentHashLimited,
  scrapeWorkHashes,
  transcodeFileName,
  transcodeToOpusLimited,
};