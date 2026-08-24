const cheerio = require('cheerio'); // 解析器

const axios = require('./axios'); // 数据请求
const { nameToUUID, hasLetter } = require('./utils');
const { scrapeWorkMetadataFromHVDB } = require('./hvdb');
const { formatID } = require('../filesystem/utils');

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

/**
 * Plain text of an element, preserving the line structure the markup implies.
 * Cheerio's .text() drops <br> and runs block elements together, which turns a
 * seller's formatted blurb into one unreadable line.
 * @param {Function} $ Cheerio instance.
 * @param {Object} el Element to render.
 * @returns {String}
 */
const elementText = ($, el) => {
  const $el = $(el).clone();
  // A sentinel, not a bare '\n': DLsite writes "<br />\n" so a literal newline
  // usually follows the tag in the source, and turning the <br> into a newline
  // of its own would double every line break. The sentinel swallows that one
  // following source newline, leaving "<br /><br />" as the only way to get a
  // blank line.
  $el.find('br').replaceWith('\u0000');
  $el.find('p, div, li, tr, h1, h2, h3, h4, h5, h6').append('\u0000');
  return $el.text()
    .replace(/\r/g, '')
    .replace(/[ \t]*\u0000[ \t]*\n?/g, '\n')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

/**
 * Parses the 作品内容 block into structured parts.
 *
 * The block is a sequence of `.work_parts` sections, each tagged by a
 * `type_*` class: `type_text` (a blurb), `type_image` (a banner plus caption)
 * and `type_tracklist` (the per-track titles, which the files on disk usually
 * lack). Sellers mix them freely, so the parts are kept in page order rather
 * than flattened into one string.
 * @param {Function} $ Cheerio instance.
 * @returns {Array<Object>} [{ type, heading, text, images, tracks }]
 */
const parseDescriptionParts = ($) => {
  const parts = [];

  $('div[itemprop="description"] .work_parts').each(function () {
    const $part = $(this);
    const typeClass = ($part.attr('class') || '').split(/\s+/).find(c => c.startsWith('type_'));
    const type = typeClass ? typeClass.replace('type_', '') : 'text';

    const heading = $part.children('.work_parts_heading').text().trim();
    const $area = $part.children('.work_parts_area');

    // Full-size image first: the <a> wrapper points at the original, the <img>
    // inside it may be a resized copy.
    const images = [];
    $area.find('a[href], img[src]').each(function () {
      const el = $(this);
      const raw = el.is('a') ? el.attr('href') : el.attr('src');
      const abs = absoluteAssetUrl(raw);
      if (abs && /\.(jpe?g|png|webp|gif)$/i.test(abs) && !images.includes(abs)) {
        images.push(abs);
      }
    });

    const tracks = [];
    $area.find('ul.work_tracklist li.work_tracklist_item').each(function () {
      const title = $(this).children('.title').text().trim();
      const time = $(this).children('.time').text().trim();
      if (title) tracks.push({ title, time });
    });

    // The tracklist is returned structurally; leaving it in the prose too
    // would duplicate every title.
    const $text = $area.clone();
    $text.find('ul.work_tracklist').remove();

    parts.push({
      type,
      heading: heading || null,
      text: elementText($, $text),
      images,
      tracks,
    });
  });

  return parts;
};

/**
 * Flattens description parts into the plain prose blob.
 * @param {Array<Object>} parts Output of parseDescriptionParts.
 * @returns {String}
 */
const descriptionToText = parts => parts
  .map(part => [part.heading, part.text].filter(Boolean).join('\n'))
  .filter(Boolean)
  .join('\n\n')
  .trim();

/**
 * Parses the work's sample images from the product slider.
 *
 * `.product-slider-data` holds one empty <div> per slide carrying the real
 * asset URL, dimensions and thumbnail — the visible <img> tags are rendered
 * client-side by Vue and are not in the HTML. The first slide is the cover
 * (`_img_main`), which the cover download already handles, so it is dropped.
 * @param {Function} $ Cheerio instance.
 * @returns {Array<Object>} [{ url, thumb, width, height }]
 */
const parseSampleImages = ($) => {
  const samples = [];

  $('.product-slider-data div[data-src]').each(function () {
    const el = $(this);
    const url = absoluteAssetUrl(el.attr('data-src'));
    if (!url || url.includes('_img_main')) return;

    const width = parseInt(el.attr('data-width'), 10);
    const height = parseInt(el.attr('data-height'), 10);
    samples.push({
      url,
      thumb: absoluteAssetUrl(el.attr('data-thumb')) || null,
      width: Number.isNaN(width) ? null : width,
      height: Number.isNaN(height) ? null : height,
    });
  });

  return samples;
};

/**
 * Scrapes static work metadata from public DLsite page HTML.
 * @param {number} id Work id.
 */
const scrapeStaticWorkMetadataFromDLsite = (id) => new Promise((resolve, reject) => {
  const rjcode = formatID(id);
  const url = `https://www.dlsite.com/maniax/work/=/product_id/RJ${rjcode}.html${LOCALE_PARAM}`;

  const work = { id, tags: [], vas: [], illustrators: [], scriptWriters: [], authors: [], sampleImages: [] };

  axios.retryGet(url, {
    retry: {}
  })
    .then(response => response.data)
    .then((data) => {
      const $ = cheerio.load(data);

      // 标题
      work.title = $('meta[property="og:title"]').attr('content');
      // fallback
      if (work.title === undefined) {
        work.title = $(`a[href="${url}"] span`).text();
      }
      
      const titlePattern = / \[.+\] \| DLsite$/;
      work.title = work.title.replace(titlePattern, '');

      // 社团
      const circleElement = $('span[class="maker_name"]').children('a');
      const circleUrl = circleElement.attr('href');
      const circleName = circleElement.text();
      work.circle = (circleUrl && circleName)
        ? { id: parseInt(circleUrl.substr(-10,5)), name: circleName }
        : {};

      const workOutline = $('#work_outline');
      // NSFW
      const R18 = workOutline.children('tbody').children('tr').children('th')
        .filter(function() {
          return $(this).text() === AGE_RATINGS;
        }).parent().children('td').find('span:first').text();
      work.nsfw = R18 === '18禁' || R18 === 'R18';

      // 贩卖日 (YYYY-MM-DD)
      const release = workOutline.children('tbody').children('tr').children('th')
        .filter(function() {
          return $(this).text() === RELEASE;
        }).parent().children('td').text().replace(/[^0-9]/ig,'');
      work.release = (release.length >= 8)
        ? `${release.slice(0, 4)}-${release.slice(4, 6)}-${release.slice(6, 8)}`
        : '';

      // 系列
      const seriesElement = workOutline.children('tbody').children('tr').children('th')
        .filter(function() {
          return $(this).text() === SERIES;
        }).parent().children('td').children('a');
      if (seriesElement.length) {
        const seriesUrl = seriesElement.attr('href');
        if (seriesUrl.match(/SRI(\d{10})/)) {
          work.series = {
            id: parseInt(seriesUrl.match(/SRI(\d{10})/)[1]),
            name: seriesElement.text()
          };
        }
      }
      
      // 标签
        workOutline.children('tbody').children('tr').children('th')
        .filter(function() {
          return $(this).text() === GENRE;
        }).parent().children('td').children('div').children('a').each(function() {
          const tagUrl = $(this).attr('href');
          const tagName = $(this).text();
          if (tagUrl.match(/genre\/(\d{3})/)) {
            work.tags.push({
              id: parseInt(tagUrl.match(/genre\/(\d{3})/)[1]),
              name: tagName
            });
          }
        });
      
      // 声优
        workOutline.children('tbody').children('tr').children('th')
        .filter(function() {
          return $(this).text() === VA;
        }).parent().children('td').children('a').each(function() {
          const vaName = $(this).text().trim();
          work.vas.push({
            id: nameToUUID(vaName),
            name: vaName
          });
        });
      
      // イラスト
        workOutline.children('tbody').children('tr').children('th')
        .filter(function() {
          return $(this).text() === ILLUSTRATOR;
        }).parent().children('td').children('a').each(function() {
          const illustratorName = $(this).text().trim();
          work.illustrators.push({
            id: nameToUUID(illustratorName),
            name: illustratorName
          });
        });
      
      // シナリオ
        workOutline.children('tbody').children('tr').children('th')
        .filter(function() {
          return $(this).text() === SCRIPT_WRITER;
        }).parent().children('td').children('a').each(function() {
          const scriptWriterName = $(this).text().trim();
          work.scriptWriters.push({
            id: nameToUUID(scriptWriterName),
            name: scriptWriterName
          });
        });

      // 作者 — the creator credit on works that have no separate VA/illustrator
      // /scenario breakdown (mostly manga and older voice works). Rarely set.
        workOutline.children('tbody').children('tr').children('th')
        .filter(function() {
          return $(this).text() === AUTHOR;
        }).parent().children('td').children('a').each(function() {
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
      work.description = descriptionToText(work.descriptionParts);
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
  const rjcode = formatID(id);
  const url = `https://www.dlsite.com/maniax/api/=/product.json?workno=RJ${rjcode}`;

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

      work.circle = {
        id: parseInt(data.maker_id.replace("RG", "")),
        name: data.maker_name
      };

      work.nsfw = data.age_category == 3;
      work.release = /\d{4}-\d{2}-\d{2}/.exec(data.regist_date);

      // 系列
      if (data.series_id) {
        work.series = {
          id: parseInt(data.series_id.replace('SRI', '')),
          name: data.series_name
        };
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
  const rjcode = formatID(id);
  const url = `https://www.dlsite.com/maniax-touch/product/info/ajax?product_id=RJ${rjcode}`;

  axios.retryGet(url, { retry: {} })
    .then(response => response.data[`RJ${rjcode}`])
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
      console.log(`[RJ${rjcode}] 成功从 DLSite 抓取Dynamic元数据...`);
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
const REVIEW_MAX_PAGES = 200; // hard stop, so a broken response can't loop forever

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
  const rjcode = formatID(id);
  const order = options.order || 'regist_d';
  const limit = options.limit || REVIEW_PAGE_SIZE;
  const maxPages = options.maxPages || REVIEW_MAX_PAGES;

  const reviews = [];
  const seen = new Set();

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `https://www.dlsite.com/maniax/api/review?product_id=RJ${rjcode}`
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
      throw new Error(`Couldn't parse reviews for RJ${rjcode}: ${(data && data.error_msg) || 'unexpected response'}.`);
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
  const rjcode = formatID(id_translated);
  const url = `https://www.dlsite.com/maniax/work/=/product_id/RJ${rjcode}.html${LOCALE_PARAM}`;

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
            if (realCoverFromId !== rjcode && !hit_id_list.includes(realCoverFromId)) {
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