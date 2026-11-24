// Cover download: DLsite (with the translated-work cover fallbacks), Fanza, and
// the "only the types that are missing" repair the refresh route runs.
//
// Kept out of scannerModules.js for the same reason workExtras.js is: the route
// needs these, and requiring that module would pull the scan child-process IPC
// plumbing into the server process. The logger is injected the same way.

const axios = require('../scraper/axios');
const { scrapeCoverIdForTranslatedWorkFromDLsite } = require('../scraper/dlsite');
const { scrapeWorkMetadataFromFanza } = require('../scraper/fanza');
const { scrapeWorkMetadataFromAsmrOne } = require('../scraper/asmrOne');
const { isFanzaId, isBooksId, fanzaCid, workno } = require('../work-id');
const { saveCoverImageToDisk, coverFileName, formatID, missingCoverTypes } = require('./utils');

const consoleLogger = {
  info: (id, message) => console.log(`[${workno(id)}] ${message}`),
  warn: (id, message) => console.warn(`[${workno(id)}] ${message}`),
  error: (id, message) => console.error(`[${workno(id)}] ${message}`),
};

/**
 * DLsite stores covers in a folder named after the work id rounded up to the
 * next thousand — a guess, since only the work page holds the real URL.
 * @param {number} cover_from_id download cover from work id, since some translated work are using non-translated work's cover resource
 * @param {String} type img type
 * @returns {String} guessed cover URL
 */
function guessDLsiteCoverUrl(cover_from_id, type) {
  // The books floor keeps its assets under work/books/BJ..., the doujin floor
  // under work/doujin/RJ...; the bucket rule is the same on both.
  const books = isBooksId(cover_from_id);
  const floor = books ? 'books' : 'doujin';
  const codeFor = num => workno(books ? `BJ${formatID(num)}` : formatID(num));

  const n = parseInt(String(cover_from_id).replace(/\D/g, ''), 10);
  const id2 = (n % 1000 === 0) ? n : Math.floor(n / 1000) * 1000 + 1000;

  return (type === '240x240' || type === '360x360')
    ? `https://img.dlsite.jp/resize/images2/work/${floor}/${codeFor(id2)}/${codeFor(n)}_img_main_${type}.jpg`
    : `https://img.dlsite.jp/modpub/images2/work/${floor}/${codeFor(id2)}/${codeFor(n)}_img_${type}.jpg`;
}

/**
 * Download one cover image per type, saving it to the covers 文件夹. Each type
 * falls through its candidate URLs until one downloads, so a source that only
 * knows some of the types does not defeat the others.
 * @param {number} cover_for_id download cover for this work id
 * @param {Array} types img types: ['main', 'sam', 'sam@2x', 'sam@3x', '240x240', '360x360']
 * @param {Function} candidatesFor type => candidate URLs, tried in order (falsy entries skipped)
 * @param {Object} log {info, warn} taking (workId, message)
 * @returns {Promise<Array>} the types that could not be downloaded
 */
async function downloadCovers(cover_for_id, types, candidatesFor, log) {
  const cover_for_rjcode = formatID(cover_for_id);
  const results = await Promise.all(types.map(async (type) => {
    for (const url of candidatesFor(type).filter(Boolean)) {
      try {
        const imageRes = await axios.retryGet(url, { responseType: "stream", retry: {} });
        await saveCoverImageToDisk(imageRes.data, cover_for_rjcode, type);
        log.info(cover_for_rjcode, `封面 ${coverFileName(cover_for_rjcode, type)} 下载成功.`);
        return null;
      } catch (err) {
        log.warn(cover_for_rjcode, `在下载封面 ${coverFileName(cover_for_rjcode, type)} 过程中出错: ${err.message} (URL: ${url})`);
      }
    }
    return type;
  }));

  return results.filter(Boolean);
}

/**
 * Cover URLs from ASMR.one's cover proxy, reusing the ones a metadata scrape
 * already returned when available.
 * @param {number} id work id
 * @param {Object} [known] map of type -> url from a previous ASMR.one scrape
 * @param {Object} log
 * @returns {Promise<Object|null>} map of type -> url, or null when unavailable
 */
async function getAsmrOneCoverUrls(id, known, log) {
  if (known && (known.main || known.sam || known['240x240'])) {
    return known;
  }

  try {
    const meta = await scrapeWorkMetadataFromAsmrOne(id);
    return {
      main: meta.mainCoverUrl,
      sam: meta.samCoverUrl,
      '240x240': meta.thumbnailCoverUrl,
    };
  } catch (err) {
    log.warn(formatID(id), `尝试从 ASMR.one 获取封面 URL 失败: ${err.message}`);
    return null;
  }
}

/**
 * 从 DLsite 下载封面图片，处理翻译作品本身没有封面的情况，并保存到 covers 文件夹，
 * 返回一个 Promise 对象，处理结果: 'added' 'failed' 'skipped' return skipped means work do not have cover in dlsite by default
 *
 * Each type is tried against DLsite first — the real URL parsed from the work
 * page, then the guessed path — and only falls back to the ASMR.one cover
 * proxy when DLsite yields nothing. The guessed path 404s for translated and
 * newer works, whose covers live under the original work id.
 * @param {number} id work id
 * @param {Array} types img types: ['main', 'sam', 'sam@2x', 'sam@3x', '240x240', '360x360']
 * @param {Object} [asmrOneCoverUrls] cover urls already known from an ASMR.one metadata scrape
 * @param {Object} [log] {info, warn, error} taking (workId, message)
 * @returns {Promise<String>} 'added' | 'failed' | 'skipped'
 */
async function getCoverImageForTranslated(id, types, asmrOneCoverUrls, log = consoleLogger) {
  const rjcode = formatID(id); // zero-pad to 6/8 digits
  let coverFromId = rjcode; // 默认就使用原始的作品id
  let isNoImgMain = false;
  let realCoverUrls = {};

  try {
    // 抓取一次网页，检查当前作品封面到底使用的哪一个id
    // 因为有些翻译作品id自身没有封面文件，而是使用原版日文作品id对应的封面
    const tryScrapResult = await scrapeCoverIdForTranslatedWorkFromDLsite(rjcode);
    coverFromId = tryScrapResult.coverFromId;
    isNoImgMain = tryScrapResult.isNoImgMain;
    // Modern translated works carry the real cover URLs on a
    // <translation-product-slider> (see dlsite.js); prefer them over the guess.
    realCoverUrls = tryScrapResult.coverUrls || {};
    if (coverFromId != rjcode) {
      log.info(rjcode, `当前作品${workno(rjcode)}似乎不包含封面资源，例如一些翻译作品。从 DLsite 对应的原始作品${workno(coverFromId)}下载封面...`);
    }
  } catch (err) {
    log.error(rjcode, `在获取真实的封面id（适配那些翻译作品的封面问题） 过程中出错: ${err.message}`);
  }

  log.info(rjcode, `从 DLsite 下载封面...`);
  let failedTypes = await downloadCovers(id, types, (type) => [
    realCoverUrls[type],
    guessDLsiteCoverUrl(coverFromId, type),
  ], log);

  if (failedTypes.length) {
    const urls = await getAsmrOneCoverUrls(id, asmrOneCoverUrls, log);
    if (urls) {
      log.info(rjcode, `DLsite 封面下载失败，尝试从 ASMR.one 下载...`);
      failedTypes = await downloadCovers(id, failedTypes, (type) => [urls[type]], log);
    }
  }

  if (!failedTypes.length) {
    return 'added';
  }

  if (isNoImgMain) {
    log.warn(rjcode, `作品本身在DlSite上没有封面图片，无法抓取封面`);
    return 'skipped';
  }

  return 'failed';
}

/**
 * Download cover images from Fanza (DMM) for a Fanza work.
 * @param {String} id Work id (e.g. 'd215444')
 * @param {Array} types img types: ['main', 'sam', '240x240']
 * @param {Object} [coverUrls] URLs scraped from the work page ({ main, sam }).
 *        The asset path segment varies by content type (digital/doujin,
 *        digital/cg_game, ...), so prefer these over the guessed fallback.
 * @param {Object} [log] {info, warn} taking (workId, message)
 * @returns {Promise<String>} 'added' or 'failed'
 */
async function getFanzaCoverImage(id, types, coverUrls, log = consoleLogger) {
  const cid = fanzaCid(id);
  if (!coverUrls) {
    try {
      const metadata = await scrapeWorkMetadataFromFanza(id);
      coverUrls = metadata.coverUrls;
    } catch (err) {
      log.warn(id, `重新抓取 Fanza 页面以获取封面 URL 失败: ${err.message}，将尝试推测的封面 URL`);
    }
  }
  // Fallback only: wrong for works whose assets are not under digital/doujin.
  // Fanza doujin only serves pl/pr cover variants (no ps), and pl == pr.
  const mainUrl = (coverUrls && coverUrls.main) || `https://doujin-assets.dmm.co.jp/digital/doujin/${cid}/${cid}pl.jpg`;
  const samUrl = (coverUrls && coverUrls.sam) || `https://doujin-assets.dmm.co.jp/digital/doujin/${cid}/${cid}pl.jpg`;
  log.info(id, `从 Fanza 下载封面...`);
  const results = await Promise.all(types.map(async (type) => {
    let url;
    if (type === 'main') {
      url = mainUrl;
    } else if (type === 'sam' || type === '240x240') {
      url = samUrl;
    } else {
      return 'failed';
    }

    try {
      const imageRes = await axios.retryGet(url, { responseType: "stream", retry: {} });
      // DMM serves a 302 to a now_printing.jpg placeholder for nonexistent
      // cover variants (axios follows it silently). Never save that as a cover.
      const finalUrl = imageRes.request && imageRes.request.res && imageRes.request.res.responseUrl;
      if (finalUrl && finalUrl.includes('now_printing')) {
        log.warn(id, `封面 ${coverFileName(id, type)} 不存在（FANZA 返回了占位图，URL: ${url}）`);
        return 'failed';
      }
      await saveCoverImageToDisk(imageRes.data, id, type);
      log.info(id, `封面 ${coverFileName(id, type)} 下载成功.`);
      return 'added';
    } catch(err) {
      log.warn(id, `在下载封面 ${coverFileName(id, type)} 过程中出错: ${err.message} (URL: ${url})`);
      return 'failed';
    }
  }));

  return results.includes("failed") 
      ? "failed" 
      : "added";
}

/**
 * Downloads only the cover types a work is missing, from the same sources a
 * scan uses. A scan is the only other repair path, and a library scan is not
 * something a user with one broken cover wants to run.
 * @param {String} workId
 * @param {Object} [coverUrls] cover URLs from the metadata scrape ({ main, sam, '240x240' })
 * @param {Object} [log] {info, warn} taking (workId, message)
 * @returns {Promise<{missing: String[], downloaded: String[], failed: String[]}>}
 */
async function repairMissingCovers(workId, coverUrls, log = consoleLogger) {
  const missing = missingCoverTypes(workId);
  if (!missing.length) return { missing, downloaded: [], failed: [] };

  log.info(workId, `封面图片缺失（${missing.join(', ')}），重新下载...`);
  if (isFanzaId(workId)) {
    await getFanzaCoverImage(workId, missing, coverUrls, log);
  } else {
    await getCoverImageForTranslated(workId, missing, coverUrls, log);
  }

  // Each downloader reports its own result, but only the filesystem says what
  // actually landed — a type can be reported saved and still leave nothing.
  const failed = missingCoverTypes(workId);
  return { missing, downloaded: missing.filter(type => !failed.includes(type)), failed };
}

module.exports = {
  getCoverImageForTranslated,
  getFanzaCoverImage,
  repairMissingCovers,
  guessDLsiteCoverUrl,
};
