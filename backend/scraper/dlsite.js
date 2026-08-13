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

/**
 * Scrapes static work metadata from public DLsite page HTML.
 * @param {number} id Work id.
 */
const scrapeStaticWorkMetadataFromDLsite = (id) => new Promise((resolve, reject) => {
  const rjcode = formatID(id);
  const url = `https://www.dlsite.com/maniax/work/=/product_id/RJ${rjcode}.html${LOCALE_PARAM}`;

  const work = { id, tags: [], vas: [], illustrators: [], scriptWriters: [] };

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

  const work = { id, tags: [], vas: [], illustrators: [], scriptWriters: [] };
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
      if (data.creaters.illust) {
        work.illustrators = data.creaters.illust.map((v) => ({
          id: nameToUUID(v.name),
          name: v.name
        }));
      }
      
      // シナリオ
      if (data.creaters.scenario) {
        work.scriptWriters = data.creaters.scenario.map((v) => ({
          id: nameToUUID(v.name),
          name: v.name
        }));
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
};