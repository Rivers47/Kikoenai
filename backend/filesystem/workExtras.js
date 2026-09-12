// Sample/description image download and DLsite review scraping.
//
// Lives outside scannerModules.js because two callers need it: the scanner
// child process, and POST /api/refresh/:id in the web process. Requiring
// scannerModules from a route would drag in the child-process IPC plumbing
// (it reassigns process.send) and the scan concurrency limiter.
//
// The logger is injected so the scanner can route messages to its SCAN_* IPC
// events while the route just writes to the console.

const fs = require('fs');
const LimitPromise = require('limit-promise'); // 限制并发数量

const axios = require('../scraper/axios');
const db = require('../database/db');
const { config } = require('../config');
const { scrapeWorkReviewsFromDLsite } = require('../scraper/dlsite');
const { formatID, workImageFileName, saveWorkImageToDisk, collectWorkImages, deleteWorkImagesFromDisk } = require('./utils');
const { isFanzaId, workno } = require('../work-id');

const displayIdOf = id => (isFanzaId(id) ? id : formatID(id));

// A single-work refresh is the user waiting on a button, and it is the only
// thing running -- unlike a scan, where config.maxParallelism works are already
// in flight and per-work parallelism would multiply out at img.dlsite.jp.
const REFRESH_IMAGE_CONCURRENCY = 4;

const consoleLogger = {
  info: (id, message) => console.log(`[${workno(id)}] ${message}`),
  warn: (id, message) => console.warn(`[${workno(id)}] ${message}`),
};

/**
 * Whether the implicit image download and review scrape are switched off.
 * A missing key counts as "skip", so a config.json predating the setting gets
 * the cheaper behaviour rather than silently keeping the expensive one.
 * @returns {Boolean}
 */
const skipWorkExtras = () => config.skipWorkExtras !== false;

/**
 * Split a run's targets into the ones already on disk and the ones to fetch.
 *
 * An image is reused only when the *previous* list said this same url lives in
 * this same file, and that file is still there. The url match is what makes it
 * safe: names are positional, so `_img_part2` holds a different picture as soon
 * as the description gains or loses one, and "the file exists" alone would keep
 * the wrong bytes forever.
 * @param {Array<Object>} targets Images this run intends to write, with `file` set.
 * @param {Array<Object>} previous Stored sample_images from the last run.
 * @param {Set<String>} onDisk File names currently in the image folder.
 * @returns {{reuse: Array<Object>, fetch: Array<Object>}}
 */
function splitDownloadTargets(targets, previous, onDisk) {
  const fileByUrl = {};
  for (const image of (previous || [])) {
    if (image && image.url && image.file) fileByUrl[image.url] = image.file;
  }

  const reuse = [];
  const fetch = [];
  for (const target of targets) {
    if (fileByUrl[target.url] === target.file && onDisk.has(target.file)) reuse.push(target);
    else fetch.push(target);
  }
  return { reuse, fetch };
}

/**
 * Downloads a work's sample and description images into the image folder and
 * records what landed on disk.
 *
 * Failures are not fatal: DLsite drops assets for old works, and a missing
 * sample image is worth far less than the metadata already stored. Each entry
 * keeps its remote url either way, so a later run can retry.
 * @param {String} id Work id.
 * @param {Object} metadata Scraped work metadata (sampleImages, descriptionParts).
 * @param {Object} [log] Logger with info(id, message) / warn(id, message).
 * @param {Object} [options]
 * @param {Array<Object>} [options.previous] Stored sample_images, so an image
 *   already on disk under the same name is not fetched again.
 * @param {Number} [options.concurrency=1] Images to fetch at once.
 * @returns {Promise<Array<Object>>} The image list, each entry with `file` set or null.
 */
async function downloadWorkImages(id, metadata, log = consoleLogger, options = {}) {
  const { previous = [], concurrency = 1 } = options;
  const displayId = displayIdOf(id);
  const images = collectWorkImages(metadata);
  if (!images.length) return [];

  // performScan creates the image folder, but /api/refresh/:id can be the
  // first thing to write there after an upgrade — an existing library never
  // rescanned still has no images/ directory.
  await fs.promises.mkdir(config.imageFolderDir, { recursive: true });

  const counters = {};
  const targets = images.map((image) => {
    counters[image.kind] = (counters[image.kind] || 0) + 1;
    const ext = (image.url.split('?')[0].split('.').pop() || 'jpg');
    return { ...image, file: workImageFileName(id, image.kind, counters[image.kind], ext) };
  });

  // Images are ~1MB each and arrive one at a time, so refetching a work's whole
  // set is the bulk of what a refresh costs. Anything already on disk under the
  // name this run would give it is the same picture, and is kept.
  const onDisk = new Set(await fs.promises.readdir(config.imageFolderDir).catch(() => []));
  const { reuse, fetch } = splitDownloadTargets(targets, previous, onDisk);

  if (!fetch.length) {
    log.info(displayId, `作品图片已是最新 (${reuse.length} 张), 无需下载.`);
  } else {
    log.info(displayId, `从 DLsite 下载作品图片 (${fetch.length} 张`
      + `${reuse.length ? `, 跳过已有 ${reuse.length} 张` : ''})...`);
  }

  // One at a time by default, and the default is what the scanner gets: it
  // already runs config.maxParallelism works at once, so fetching a work's
  // images in parallel multiplies out -- 16 works x 10 images was ~160
  // concurrent requests at img.dlsite.jp, well above the ~48 the cover
  // downloads ever produced, and enough to get the whole scan rate-limited.
  // A single-work refresh has nothing to multiply with and passes a real
  // concurrency instead; images are ~1MB each, so the wait is transfer time.
  const limit = new LimitPromise(Math.max(1, concurrency));
  const fetchOne = async (target) => {
    try {
      const imageRes = await axios.retryGet(target.url, { responseType: 'stream', retry: {} });
      await saveWorkImageToDisk(imageRes.data, target.file);
      return target;
    } catch (err) {
      log.warn(displayId, `在下载作品图片 ${target.file} 过程中出错: ${err.message} (URL: ${target.url})`);
      return { ...target, file: null };
    }
  };

  const results = [...reuse, ...await Promise.all(fetch.map(target => limit.call(fetchOne, target)))];

  if (fetch.length) {
    const downloaded = results.filter(r => r.file).length;
    log.info(displayId, `作品图片下载完成: ${downloaded}/${targets.length}`);
  }

  // Page order, not fetch order: the stored list doubles as the render order.
  const byUrl = new Map(results.map(result => [result.url, result]));
  const ordered = targets.map(target => byUrl.get(target.url) || { ...target, file: null });

  const pruned = await deleteWorkImagesFromDisk(id, new Set(targets.map(target => target.file)));
  if (pruned) log.info(displayId, `清理无用的作品图片 ${pruned} 张.`);

  return ordered;
}

/**
 * Downloads a work's images and stores the resulting list, swallowing errors
 * the same way the cover download does.
 * @param {String} id Work id.
 * @param {Object} metadata Scraped work metadata.
 * @param {Object} [log] Logger with info(id, message) / warn(id, message).
 * @param {Object} [options] Passed to downloadWorkImages (concurrency).
 * @returns {Promise<Number>} Number of images that reached disk.
 */
async function saveWorkImages(id, metadata, log = consoleLogger, options = {}) {
  const displayId = displayIdOf(id);
  try {
    const stored = await db.getWorkExtras(id);
    const images = await downloadWorkImages(id, metadata, log, {
      ...options,
      previous: stored ? stored.sampleImages : [],
    });
    if (!images.length) return 0;
    await db.setWorkSampleImages(id, images);
    return images.filter(image => image.file).length;
  } catch (err) {
    log.warn(displayId, `在保存作品图片过程中出错: ${err.message}`);
    return 0;
  }
}

/**
 * Scrapes every DLsite user review of a work and replaces the stored set.
 *
 * Reviews are the one part of the work page that grows without bound, so this
 * runs only where it is asked for: a newly added work, a single-work refresh,
 * or an explicit `--includeReviews` update. Never fatal — a work with no
 * reviews is normal.
 * @param {String} id Work id.
 * @param {Object} [log] Logger with info(id, message) / warn(id, message).
 * @returns {Promise<Number>} Number of reviews stored.
 */
async function saveWorkReviews(id, log = consoleLogger) {
  if (isFanzaId(id)) return 0; // Fanza reviews are not scraped

  const rjcode = formatID(id);
  try {
    const reviews = await scrapeWorkReviewsFromDLsite(id);
    await db.replaceWorkDlsiteReviews(id, reviews);
    log.info(rjcode, `抓取到 ${reviews.length} 条 DLsite 用户评论.`);
    return reviews.length;
  } catch (err) {
    log.warn(rjcode, `在抓取 DLsite 用户评论过程中出错: ${err.message}`);
    return 0;
  }
}

module.exports = {
  skipWorkExtras,
  splitDownloadTargets,
  REFRESH_IMAGE_CONCURRENCY,
  downloadWorkImages,
  saveWorkImages,
  saveWorkReviews,
};
