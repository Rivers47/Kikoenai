const cheerio = require('cheerio'); // 解析器

const axios = require('./axios'); // 数据请求
const { nameToUUID, hasLetter } = require('./utils');
const { scrapeWorkMetadataFromHVDB } = require('./hvdb');
const { formatID } = require('../filesystem/utils');
const { workno } = require('../work-id');

// 常に日本語ロケールを使用
const LOCALE_PARAM = '/?locale=ja_JP';
const AGE_RATINGS = '年齢指定';
const GENRE = 'ジャンル';
const VA = '声優';
const ILLUSTRATOR = 'イラスト';
const SCRIPT_WRITER = 'シナリオ';
const RELEASE = '販売日';
const SERIES = 'シリーズ名';
const AUTHOR = '作者';

// DLsite serves asset URLs protocol-relative ("//img.dlsite.jp/..."); make them
// absolute so callers can hand them straight to axios.
const absoluteAssetUrl = (u) => {
  if (!u) return '';
  const trimmed = u.trim();
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return '';
};

// Every row of the 作品情報 block is a <dt> label with its <dd> value beside it.
const DESCRIPTION_SECTION = 'section.c-productContent';

/**
 * The value cell of one 作品情報 row.
 * @param {Function} $ Cheerio instance.
 * @param {String} label Row label, e.g. 声優.
 * @returns {Object} Cheerio selection of the <dd>, empty when there is no such row.
 */
const infoValue = ($, label) => $('dt.c-productInfo__key')
  .filter(function() { return $(this).text().trim() === label; })
  .first()
  .next('dd.c-productInfo__value');

/**
 * The 作品内容 block: the container holding the seller's `.c-productContent`
 * sections. `.c-productInfo__inner` is a shared wrapper, so the sections are
 * what identifies the right one -- the same class inside
 * `.c-productSystemRequirements` holds the spec table.
 * @param {Function} $ Cheerio instance.
 * @returns {Object} Cheerio selection, empty when the work has no description.
 */
const descriptionBlock = ($) => $('.c-productInfo__inner')
  .filter((i, el) => $(el).find(DESCRIPTION_SECTION).length > 0)
  .first();

/**
 * Parses the 作品内容 block into structured parts.
 *
 * The block is a sequence of `.c-productContent` sections: a blurb, a banner
 * with a caption, or a row of images each with its own caption. Sellers mix
 * them freely, so the parts are kept in page order rather than flattened into
 * one string. The text stays in the markup, which is where the page reads it
 * from, so a part carries only what the markup cannot: its heading and the
 * images the downloader has to fetch.
 *
 * The per-track list DLsite used to publish as its own part is gone from the
 * work page: sellers now write the track list as prose inside a section, and
 * the track-title extractor reads it from there.
 * @param {Function} $ Cheerio instance.
 * @returns {Array<Object>} [{ type, heading, images }]
 */
const parseDescriptionParts = ($) => {
  const parts = [];

  $(DESCRIPTION_SECTION).each(function () {
    const $part = $(this);
    const type = $part.find('ul.c-productContent__imageList').length ? 'image_list'
      : ($part.find('.c-productContent__image').length ? 'image' : 'text');

    const heading = $part.find('.headline__title').first().text().trim();

    // Full-size image first: the <a> wrapper points at the original, the <img>
    // inside it may be a resized copy.
    const images = [];
    $part.find('a[href], img[src]').each(function () {
      const el = $(this);
      const raw = el.is('a') ? el.attr('href') : el.attr('src');
      const abs = absoluteAssetUrl(raw);
      if (abs && /\.(jpe?g|png|webp|gif)$/i.test(abs) && !images.includes(abs)) {
        images.push(abs);
      }
    });

    parts.push({
      type,
      heading: heading || null,
      images,
    });
  });

  return parts;
};

/**
 * The 作品内容 block's own markup.
 *
 * Returned unsanitized on purpose: this is the scrape, and the allowlist lives
 * at the serving end (routes/utils/description-html.js) so that tightening it
 * takes effect for the whole library instead of needing every work re-scraped.
 * @param {Function} $ Cheerio instance.
 * @returns {String} Inner HTML of the description block, '' when it has none.
 */
const descriptionHtml = ($) => {
  const html = descriptionBlock($).html();
  return html ? html.trim() : '';
};

/**
 * Parses the work's sample images from the product slider.
 *
 * The slider is server-rendered: one <picture> per slide, with the full-size
 * JPEG as the `<img src>` and a webp twin as its `<source>`.
 *
 * The first slide is the cover (`_img_main`), which the cover download already
 * handles, so it is dropped. Dimensions and the 100x100 thumbnail the old
 * markup carried are not in this one; both are stored as null, and nothing
 * reads them.
 * @param {Function} $ Cheerio instance.
 * @returns {Array<Object>} [{ url, thumb, width, height }]
 */
const parseSampleImages = ($) => {
  const samples = [];
  const seen = new Set();

  $('.key-visual-slider img[src]').each(function () {
    const url = absoluteAssetUrl($(this).attr('src'));
    if (!url || url.includes('_img_main') || seen.has(url)) return;
    seen.add(url);
    samples.push({ url, thumb: null, width: null, height: null });
  });

  return samples;
};

/**
 * Scrapes static work metadata from public DLsite page HTML.
 * @param {number} id Work id.
 */
const scrapeStaticWorkMetadataFromDLsite = (id) => new Promise((resolve, reject) => {
  const code = workno(formatID(id));
  const url = `https://www.dlsite.com/maniax/work/=/product_id/${code}.html${LOCALE_PARAM}`;

  const work = { id, tags: [], vas: [], illustrators: [], scriptWriters: [], authors: [], sampleImages: [] };

  axios.retryGet(url, {
    retry: {}
  })
    .then(response => response.data)
    .then((data) => {
      const $ = cheerio.load(data);

      // 标题
      work.title = $('meta[property="og:title"]').attr('content')
        || $('h1.headline__title').first().text().trim();

      const titlePattern = / \[.+\] \| DLsite$/;
      work.title = work.title.replace(titlePattern, '');

      // 社团
      const circleElement = $('a.c-productInfo__makerName').first();
      const circleUrl = circleElement.attr('href');
      const circleName = circleElement.text().trim();
      work.circle = (circleUrl && circleName) ? { name: circleName } : {};

      // NSFW
      const R18 = infoValue($, AGE_RATINGS).text().trim();
      work.nsfw = R18 === '18禁' || R18 === 'R18';

      // 贩卖日 (YYYY-MM-DD). The month and day are not zero-padded, so the
      // value is read field by field rather than as one run of digits.
      const release = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(infoValue($, RELEASE).text());
      work.release = release
        ? `${release[1]}-${release[2].padStart(2, '0')}-${release[3].padStart(2, '0')}`
        : '';

      // 系列
      const seriesElement = infoValue($, SERIES).find('a').first();
      const seriesUrl = seriesElement.attr('href') || '';
      if (seriesUrl.match(/SRI(\d{10})/)) {
        work.series = {
          id: parseInt(seriesUrl.match(/SRI(\d{10})/)[1]),
          name: seriesElement.text().trim()
        };
      }

      // 标签
      infoValue($, GENRE).find('a').each(function() {
        const tagUrl = $(this).attr('href') || '';
        const tagName = $(this).text();
        if (tagUrl.match(/genre\/(\d{2,4})/)) {
          work.tags.push({
            id: parseInt(tagUrl.match(/genre\/(\d{2,4})/)[1]),
            name: tagName
          });
        }
      });

      // 声优
      infoValue($, VA).find('a').each(function() {
        const vaName = $(this).text().trim();
        work.vas.push({
          id: nameToUUID(vaName),
          name: vaName
        });
      });

      // イラスト
      infoValue($, ILLUSTRATOR).find('a').each(function() {
        const illustratorName = $(this).text().trim();
        work.illustrators.push({
          id: nameToUUID(illustratorName),
          name: illustratorName
        });
      });

      // シナリオ
      infoValue($, SCRIPT_WRITER).find('a').each(function() {
        const scriptWriterName = $(this).text().trim();
        work.scriptWriters.push({
          id: nameToUUID(scriptWriterName),
          name: scriptWriterName
        });
      });

      // 作者 — the creator credit on works that have no separate VA/illustrator
      // /scenario breakdown (mostly manga and older voice works). Rarely set.
      infoValue($, AUTHOR).find('a').each(function() {
        const authorName = $(this).text().trim();
        if (authorName) {
          work.authors.push({
            id: nameToUUID(authorName),
            name: authorName
          });
        }
      });

      // 作品内容 (description) and the sample images from the product slider
      work.descriptionParts = parseDescriptionParts($);
      // The column holds the seller's markup now, not a flattened copy of it.
      // Flattening here is what used to cost the formatting and the position of
      // every inline image; the one consumer that wants text
      // (scripts/extract-track-titles.js) flattens it itself, and the work page
      // renders it through the sanitizer in routes/utils/description-html.js.
      // Rows scraped before this hold plain text and stay that way until the
      // work is scanned or refreshed again.
      work.description = descriptionHtml($);
      work.sampleImages = parseSampleImages($);

      if (work.tags.length === 0 && work.vas.length === 0) {
        reject(new Error('Couldn\'t parse data from DLsite work page.'));
      }
    })
    .then(() => {
      if (work.vas.length === 0) { 
        scrapeWorkMetadataFromHVDB(id)
          .then((metadata) => {
            if (metadata.vas.length <= 1) {
              work.vas = metadata.vas;
            } else {
              metadata.vas.forEach(function(va) {
                if (!hasLetter(va.name)) {
                  work.vas.push(va);
                }
              });
            }
  
            resolve(work);
          })
          .catch((error) => {
            reject(new Error(error.message));
          });
      } else {
        resolve(work);
      } 
    })
    .catch((error) => {
      if (error.response) {
        reject(new Error(`Couldn't request work page HTML (${url}), received: ${error.response.status}.`));
      } else {
        reject(error);
      }
    });
});

const scrapeStaticWorkMetadataFromDLsiteJson = (id) => new Promise((resolve, reject) => {
  const code = workno(formatID(id));
  const url = `https://www.dlsite.com/maniax/api/=/product.json?workno=${code}`;

  const work = { id, tags: [], vas: [], illustrators: [], scriptWriters: [], authors: [], sampleImages: [] };
  axios.retryGet(url, {
    retry: {}
  })
    .then(response => response.data)
    .then((jsonObj) => {
      const data = jsonObj[0];

      work.title = data.product_name;
      const titlePattern = / \[.+\] \| DLsite$/;
      work.title = work.title.replace(titlePattern, '');

      work.circle = { name: data.maker_name };

      work.nsfw = data.age_category == 3;
      work.release = /\d{4}-\d{2}-\d{2}/.exec(data.regist_date);

      // 系列
      if (data.series_id) {
        work.series = { name: data.series_name };
      }
      
      work.tags = data.genres.map((v) => ({
        id: v.id,
        name: v.name
      }));
      
      work.vas = data.creaters.voice_by.map((v) => ({
        id: nameToUUID(v.name),
        name: v.name
      }));
      
      // イラスト
      if (data.creaters.illust_by) {
        work.illustrators = data.creaters.illust_by.map((v) => ({
          id: nameToUUID(v.name),
          name: v.name
        }));
      }
      
      // シナリオ
      if (data.creaters.scenario_by) {
        work.scriptWriters = data.creaters.scenario_by.map((v) => ({
          id: nameToUUID(v.name),
          name: v.name
        }));
      }

      // 作者
      if (data.creaters.created_by) {
        work.authors = data.creaters.created_by.map((v) => ({
          id: nameToUUID(v.name),
          name: v.name
        }));
      }

      // The JSON API carries no description markup — intro_s is a plain-text
      // summary, already truncated by DLsite. Good enough for this fallback
      // path; the HTML scraper is the one that returns the full blurb, the
      // per-part structure and the track list.
      work.description = (data.intro_s || '').trim();
      work.descriptionParts = work.description
        ? [{ type: 'text', heading: null, text: work.description, images: [], tracks: [] }]
        : [];

      if (Array.isArray(data.image_samples)) {
        work.sampleImages = data.image_samples
          .map((img) => ({
            url: absoluteAssetUrl(img.url),
            thumb: null,
            width: parseInt(img.width, 10) || null,
            height: parseInt(img.height, 10) || null,
          }))
          .filter(img => img.url);
      }

      if (work.tags.length === 0 && work.vas.length === 0) {
        reject(new Error('Couldn\'t parse data from DLsite work page.'));
      }
    })
    .then(() => {
      if (work.vas.length === 0) { 
        scrapeWorkMetadataFromHVDB(id)
          .then((metadata) => {
            if (metadata.vas.length <= 1) {
              work.vas = metadata.vas;
            } else {
              metadata.vas.forEach(function(va) {
                if (!hasLetter(va.name)) {
                  work.vas.push(va);
                }
              });
            }
  
            resolve(work);
          })
          .catch((error) => {
            reject(new Error(error.message));
          });
      } else {
        resolve(work);
      } 
    })
    .catch((error) => {
      if (error.response) {
        reject(new Error(`Couldn't request work json (${url}), received: ${error.response.status}.`));
      } else {
        reject(error);
      }
    });
});

/**
 * Requests dynamic work metadata from public DLsite API.
 * @param {number} id Work id.
 */
const scrapeDynamicWorkMetadataFromDLsite = id => new Promise((resolve, reject) => {
  const code = workno(formatID(id));
  const url = `https://www.dlsite.com/maniax-touch/product/info/ajax?product_id=${code}`;

  axios.retryGet(url, { retry: {} })
    .then(response => response.data[code])
    .then((data) => {
      const work = {};
      work.dl_count = data.dl_count ? data.dl_count : "0";
      work.rate_average_2dp = data.rate_average_2dp ? data.rate_average_2dp : 0.0;
      work.rate_count = data.rate_count ? data.rate_count : 0;
      work.rate_count_detail = data.rate_count_detail;
      work.review_count = data.review_count;
      work.price = data.price;
      if (data.rank.length) {
        work.rank = data.rank;
      }
      console.log(`[${code}] 成功从 DLSite 抓取Dynamic元数据...`);
      resolve(work);
    })
    .catch((error) => {
      if (error.response) {
        reject(new Error(`Couldn't request work page HTML (${url}), received: ${error.response.status}.`));
      } else {
        reject(error);
      }
    });
});

/**
 * Scrapes work metadata from public DLsite page HTML.
 * @param {number} id Work id.
 */
const scrapeWorkMetadataFromDLsite = (id) => {
  return Promise.all([
    scrapeStaticWorkMetadataFromDLsite(id),
    scrapeDynamicWorkMetadataFromDLsite(id)
  ])
    .then((res) => {
      const work = {};
      return Object.assign(work, res[0], res[1]);
    });
};

/**
 * Scrapes work metadata from public DLsite project json api.
 * https://www.dlsite.com/maniax/api/=/product.json?workno=RJ00000000
 * @param {number} id Work id.
 */
const scrapeWorkMetadataFromDLsiteJson = (id) => {
  return Promise.all([
    scrapeStaticWorkMetadataFromDLsiteJson(id),
    scrapeDynamicWorkMetadataFromDLsite(id)
  ])
    .then((res) => {
      const work = {};
      return Object.assign(work, res[0], res[1]);
    });
};

// Reviews are rendered client-side by a Vue component, so they are absent from
// the work page HTML. This is the endpoint that component calls.
const REVIEW_PAGE_SIZE = 50;
const REVIEW_MAX_PAGES = 20; // 1000 reviews; a broken response can't loop forever
// Wall-clock cap. Paging is sequential, and every request can burn
// dlsiteTimeout x retry attempts before it gives up -- which on a rate-limited
// connection is minutes per page. Without a budget one work stalls its whole
// scan task, and because a task only leaves the scanner's in-flight list when
// processFolder resolves, the UI sits on that work's last log line forever.
const REVIEW_TIME_BUDGET_MS = 120 * 1000;

/**
 * Normalizes one raw review from the DLsite review API.
 * @param {Object} raw
 * @returns {Object}
 */
const normalizeReview = (raw) => {
  const toInt = (v) => {
    const n = parseInt(v, 10);
    return Number.isNaN(n) ? null : n;
  };

  return {
    id: String(raw.member_review_id),
    workno: raw.workno,
    reviewerId: raw.reviewer_id || null,
    reviewerName: raw.nick_name || null,
    // 1-5 stars. The list endpoint reports them 1-5, unlike rate_average_star
    // elsewhere in the DLsite API, which is x10.
    rate: toInt(raw.rate),
    title: raw.review_title || null,
    text: raw.review_text || null,
    spoiler: raw.spoiler === '1' || raw.spoiler === 1,
    recommend: !!toInt(raw.recommend),
    isPurchased: !!toInt(raw.is_purchased),
    goodReview: toInt(raw.good_review) || 0,
    badReview: toInt(raw.bad_review) || 0,
    // Genres the *reviewer* picked, keyed by DLsite genre id. These are
    // independent of the seller-chosen work genres.
    genres: raw.genre && typeof raw.genre === 'object'
      ? Object.entries(raw.genre).map(([genreId, name]) => ({ id: genreId, name }))
      : [],
    entryDate: raw.entry_date || null,
    registDate: raw.regist_date || null,
  };
};

/**
 * Scrapes every user review of a work from DLsite's review API, paginating
 * until the site stops returning rows.
 * @param {number|string} id Work id.
 * @param {Object} [options]
 * @param {String} [options.order='regist_d'] Sort order accepted by the API.
 * @param {Number} [options.limit=50] Page size.
 * @param {Number} [options.maxPages=200] Safety cap on pages fetched.
 * @returns {Promise<Array<Object>>} Normalized reviews, de-duplicated by id.
 */
const scrapeWorkReviewsFromDLsite = async (id, options = {}) => {
  const code = workno(formatID(id));
  const order = options.order || 'regist_d';
  const limit = options.limit || REVIEW_PAGE_SIZE;
  const maxPages = options.maxPages || REVIEW_MAX_PAGES;

  const budgetMs = options.budgetMs || REVIEW_TIME_BUDGET_MS;
  const deadline = Date.now() + budgetMs;

  const reviews = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page += 1) {
    if (Date.now() > deadline) {
      console.log(`[${code}] 评论抓取超时，已获取 ${reviews.length} 条，停止翻页.`);
      break;
    }
    const url = `https://www.dlsite.com/maniax/api/review?product_id=${code}`
      + `&order=${order}&limit=${limit}&page=${page}&locale=ja_JP`;

    let data;
    try {
      const response = await axios.retryGet(url, { retry: {} });
      data = response.data;
    } catch (error) {
      if (error.response) {
        throw new Error(`Couldn't request work reviews (${url}), received: ${error.response.status}.`);
      }
      throw error;
    }

    if (!data || data.is_success !== true) {
      throw new Error(`Couldn't parse reviews for ${code}: ${(data && data.error_msg) || 'unexpected response'}.`);
    }

    const rows = Array.isArray(data.review_list) ? data.review_list : [];
    if (rows.length === 0) break;

    for (const raw of rows) {
      // A review promoted to "pickup" is repeated across pages; keep one copy.
      const review = normalizeReview(raw);
      if (review.id && !seen.has(review.id)) {
        seen.add(review.id);
        reviews.push(review);
      }
    }

    if (rows.length < limit) break;
  }

  return reviews;
};

/**
 * Scrapes the source cover work id which holds the cover image, 
 * since some translated work(id_translated) in dlsite do not has its own cover, 
 * but share the cover from original cover work(id_source).
 * @param {number} id_translated Work id.
 */
const scrapeCoverIdForTranslatedWorkFromDLsite = (id_translated) => new Promise((resolve, reject) => {
  const code = workno(formatID(id_translated));
  const url = `https://www.dlsite.com/maniax/work/=/product_id/${code}.html${LOCALE_PARAM}`;

  axios.retryGet(url, {
    retry: {}
  })
    .then(response => response.data)
    .then((data) => {
      const $ = cheerio.load(data);

      const linked_id_list = $('.work_edition_linklist.type_trans a.work_edition_linklist_item').get()
        .map(l => l.attribs['href'])
        .filter(h => typeof h === 'string')
        .map(h => /RJ(\d{6,8})/.exec(h))
        .filter(r => r != null && r.length >= 2)
        .map(r =>r[1]);
      
      let isNoImgMain = false;

      const possible_image_id_list = $('img').get()
        .map(e => e.attribs['srcset'])
        .filter(h => typeof h === 'string')
        .map(h => {
          if (h.includes('no_img_main')) {
            isNoImgMain = true;
          }
          return /RJ(\d{6,8})[_\w.]+$/.exec(h);
        })
        .filter(r => r != null && r.length >= 2)
        .map(r => r[1]);

      const hit_id_list = linked_id_list.filter(id => possible_image_id_list.includes(id));

      // New-style pages replace the work_edition_linklist markup with a
      // <translation-product-slider> component that carries the real cover
      // URLs directly (under the original work id). When present, expose them
      // so the caller can download without guessing paths.
      const realCoverUrls = {};
      const slider = $('translation-product-slider').first();
      if (slider.length) {
        const sliderSrc = slider.attr('src') || '';
        const sliderThumb = slider.attr('thumb') || '';
        // src/thumb may be protocol-relative or root-relative; resolve against
        // the work page so a malformed value can't throw out of the scrape.
        // Anything that doesn't resolve to an image path is not a cover — a
        // placeholder like "#" would otherwise resolve to the page itself.
        const toAbsolute = (u) => {
          try {
            const resolved = new URL(u, url);
            return /\.(jpe?g|png|webp|gif)$/i.test(resolved.pathname) ? resolved.href : '';
          } catch {
            return '';
          }
        };
        const mainUrl = sliderSrc && toAbsolute(sliderSrc);
        if (mainUrl) {
          realCoverUrls.main = mainUrl;
          // DLsite names the variants by suffix, whatever the extension is.
          const samUrl = mainUrl.replace('_img_main', '_img_sam');
          if (samUrl !== mainUrl) realCoverUrls.sam = samUrl;
          if (sliderThumb) {
            const thumbUrl = toAbsolute(sliderThumb);
            if (thumbUrl) realCoverUrls['240x240'] = thumbUrl;
          }

          // The cover usually belongs to the original (Japanese) work; prefer
          // its id for the guessed-path fallback in guessDLsiteCoverUrl.
          const mainUrlMatch = /RJ(\d{6,8})[_\w.]+$/.exec(new URL(mainUrl).pathname);
          if (mainUrlMatch) {
            const realCoverFromId = mainUrlMatch[1];
            if (realCoverFromId !== formatID(id_translated) && !hit_id_list.includes(realCoverFromId)) {
              hit_id_list.unshift(realCoverFromId);
            }
          }
        }
      }

      const result = {
        coverFromId: hit_id_list.length > 0 ? hit_id_list[0] : id_translated,
        isNoImgMain,
        coverUrls: Object.keys(realCoverUrls).length > 0 ? realCoverUrls : undefined,
      };
      resolve(result);
    })
    .catch((error) => {
      if (error.response) {
        reject(new Error(`Couldn't request work page HTML (${url}), received: ${error.response.status}.`));
      } else {
        reject(error);
      }
    });
});

module.exports = {
  scrapeWorkMetadataFromDLsite,
  scrapeWorkMetadataFromDLsiteJson,
  scrapeDynamicWorkMetadataFromDLsite,
  scrapeCoverIdForTranslatedWorkFromDLsite,
  scrapeWorkReviewsFromDLsite,
};