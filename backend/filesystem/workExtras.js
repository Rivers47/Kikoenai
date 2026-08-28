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

const axios = require('../scraper/axios');
const db = require('../database/db');
const { config } = require('../config');
const { scrapeWorkReviewsFromDLsite } = require('../scraper/dlsite');
const { formatID, workImageFileName, saveWorkImageToDisk } = require('./utils');
const { isFanzaId } = require('../work-id');

const displayIdOf = id => (isFanzaId(id) ? id : formatID(id));

const consoleLogger = {
  info: (id, message) => console.log(`[${id}] ${message}`),
  warn: (id, message) => console.warn(`[${id}] ${message}`),
};

/**
 * Whether the implicit image download and review scrape are switched off.
 * A missing key counts as "skip", so a config.json predating the setting gets
 * the cheaper behaviour rather than silently keeping the expensive one.
 * @returns {Boolean}
 */
const skipWorkExtras = () => config.skipWorkExtras !== false;

/**
 * Collects every image a work page offers, in the order they should be
 * numbered on disk: the sample slider first, then the ones embedded in the
 * description blocks.
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
 * Downloads a work's sample and description images into the image folder and
 * records what landed on disk.
 *
 * Failures are not fatal: DLsite drops assets for old works, and a missing
 * sample image is worth far less than the metadata already stored. Each entry
 * keeps its remote url either way, so a later run can retry.
 * @param {String} id Work id.
 * @param {Object} metadata Scraped work metadata (sampleImages, descriptionParts).
 * @param {Object} [log] Logger with info(id, message) / warn(id, message).
 * @returns {Promise<Array<Object>>} The image list, each entry with `file` set or null.
 */
async function downloadWorkImages(id, metadata, log = consoleLogger) {
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

  log.info(displayId, `从 DLsite 下载作品图片 (${targets.length} 张)...`);

  // Sequential, deliberately. The scanner already runs config.maxParallelism
  // works at once, so a Promise.all here multiplies out: 16 works x 10 images
  // was ~160 concurrent requests at img.dlsite.jp, well above the ~48 the cover
  // downloads ever produced, and enough to get the whole scan rate-limited.
  // One at a time per work keeps the ceiling at maxParallelism.
  const results = [];
  for (const target of targets) {
    try {
      const imageRes = await axios.retryGet(target.url, { responseType: 'stream', retry: {} });
      await saveWorkImageToDisk(imageRes.data, target.file);
      results.push(target);
    } catch (err) {
      log.warn(displayId, `在下载作品图片 ${target.file} 过程中出错: ${err.message} (URL: ${target.url})`);
      results.push({ ...target, file: null });
    }
  }

  const downloaded = results.filter(r => r.file).length;
  log.info(displayId, `作品图片下载完成: ${downloaded}/${targets.length}`);

  return results;
}

/**
 * Downloads a work's images and stores the resulting list, swallowing errors
 * the same way the cover download does.
 * @param {String} id Work id.
 * @param {Object} metadata Scraped work metadata.
 * @param {Object} [log] Logger with info(id, message) / warn(id, message).
 * @returns {Promise<Number>} Number of images that reached disk.
 */
async function saveWorkImages(id, metadata, log = consoleLogger) {
  const displayId = displayIdOf(id);
  try {
    const images = await downloadWorkImages(id, metadata, log);
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
  collectWorkImages,
  downloadWorkImages,
  saveWorkImages,
  saveWorkReviews,
};
