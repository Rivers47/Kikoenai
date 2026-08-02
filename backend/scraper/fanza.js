const cheerio = require('cheerio');
const axios = require('./axios');
const { nameToUUID } = require('./utils');

// The ジャンル row mixes in storefront section and sale-status markers that
// carry no genre information; skip them.
const IGNORED_TAGS = new Set(['旧作', '新作', '成人向け', '男性向け', '女性向け']);

/**
 * Scrape work metadata from Fanza (DMM) doujin detail page.
 * @param {string} cid Content ID, e.g. 'd_215444'
 * @returns {Promise<Object>} Work metadata object.
 */
const scrapeWorkMetadataFromFanza = (cid) => new Promise((resolve, reject) => {
  const url = `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=${cid}/`;

  const work = {
    id: cid,
    title: '',
    circle: {},
    nsfw: true,
    release: '',
    tags: [],
    vas: [],
    illustrators: [],
    scriptWriters: [],
    series: null,
    price: null,
    rate_average_2dp: null,
    rate_count: null,
    review_count: null,
    dl_count: null,
    rank: null,
    rate_count_detail: null,
  };

  axios.retryGet(url, {
    retry: {},
    headers: {
      cookie: 'age_check_done=1; dc_doujin_age_check_done=1',
    },
  })
    .then(response => response.data)
    .then((data) => {
      const $ = cheerio.load(data);

      // Title
      const titleEl = $('h1.productTitle__txt');
      // Strip child span (sale badge)
      titleEl.children('span').remove();
      work.title = titleEl.text().trim();

      // Circle (the doujin "maker", e.g. FANZA同人オリジナル).
      // .first(): some page variants render the circle name more than once
      // and .text() would concatenate all matches.
      const circleEl = $('.circleName__txt').first();
      if (circleEl.length) {
        work.circle = { name: circleEl.text().trim() };
      }

      // Information table: walk rows generically
      const infoItems = $('div.m-productInformation div.productInformation__item');
      infoItems.each(function () {
        const header = $(this).find('dt.informationList__ttl').text().trim();
        const valueEl = $(this).find('dd.informationList__txt, dd.informationList__item');

        switch (header) {
          case '配信開始日': // digital doujin pages
          case '販売日': {
            const dateText = valueEl.text().trim();
            const match = dateText.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
            if (match) {
              work.release = `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
            }
            break;
          }
          case 'ジャンル': {
            valueEl.find('a').each(function () {
              const tagName = $(this).text().trim();
              if (tagName && !IGNORED_TAGS.has(tagName)) {
                work.tags.push({ name: tagName });
              }
            });
            break;
          }
          case 'シリーズ': {
            const seriesName = valueEl.find('a').first().text().trim();
            if (seriesName) {
              work.series = { name: seriesName };
            }
            break;
          }
          case '声優': {
            valueEl.find('a').each(function () {
              const vaName = $(this).text().trim();
              if (vaName) {
                work.vas.push({ id: nameToUUID(vaName), name: vaName });
              }
            });
            break;
          }
          case 'イラスト': {
            valueEl.find('a').each(function () {
              const illusName = $(this).text().trim();
              if (illusName) {
                work.illustrators.push({ id: nameToUUID(illusName), name: illusName });
              }
            });
            break;
          }
          case 'シナリオ':
          case '原作': {
            valueEl.find('a').each(function () {
              const swName = $(this).text().trim();
              if (swName) {
                work.scriptWriters.push({ id: nameToUUID(swName), name: swName });
              }
            });
            break;
          }
          case '価格': {
            const priceText = valueEl.text().trim();
            const priceMatch = priceText.match(/(\d[\d,]*)\s*円/);
            if (priceMatch) {
              work.price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
            }
            break;
          }
          default:
            break;
        }
      });

      // Price: lives in the purchase box, not the information table.
      // e.g. <p class="priceList__main">1,650<span class="priceList__main--small">円</span></p>
      const priceEl = $('p.priceList__main').first().clone();
      if (priceEl.length) {
        priceEl.children('span').remove();
        const priceMatch = priceEl.text().trim().match(/(\d[\d,]*)/);
        if (priceMatch) {
          work.price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
        }
      }

      // Cumulative sales count (累計販売数), e.g. <span class="numberOfSales__txt">2,717</span>
      const salesEl = $('span.numberOfSales__txt').first();
      if (salesEl.length) {
        const salesMatch = salesEl.text().trim().match(/(\d[\d,]*)/);
        if (salesMatch) {
          work.dl_count = parseInt(salesMatch[1].replace(/,/g, ''), 10);
        }
      }

      // Rating, rating count, review (comment) count, and rating distribution.
      // Preferred source: the review section (.dcd-review), which carries exact values:
      //   平均評価 <strong>4.89</strong> / 総評価数 <strong>9</strong>（3件のコメント）
      const averageEl = $('.dcd-review__average strong').first();
      if (averageEl.length) {
        const avg = parseFloat(averageEl.text().trim());
        if (!Number.isNaN(avg)) {
          work.rate_average_2dp = avg;
        }
      }
      const evaluatesText = $('.dcd-review__evaluates').first().text();
      const totalMatch = evaluatesText.match(/総評価数\s*(\d[\d,]*)/);
      if (totalMatch) {
        work.rate_count = parseInt(totalMatch[1].replace(/,/g, ''), 10);
      }
      const commentMatch = evaluatesText.match(/（(\d[\d,]*)件のコメント）/);
      if (commentMatch) {
        work.review_count = parseInt(commentMatch[1].replace(/,/g, ''), 10);
      }
      // Per-star distribution, stored in the same shape as DLsite's API:
      // [{review_point: 1, count, ratio}, ..., {review_point: 5, count, ratio}]
      const detail = [];
      $('.dcd-review__rating_map > div').each(function () {
        const starClass = $(this).find('span[class*="dcd-review-rating-"]').first().attr('class') || '';
        const starMatch = starClass.match(/dcd-review-rating-(\d)0/);
        const countMatch2 = $(this).text().match(/(\d+)件/);
        if (starMatch && countMatch2) {
          detail.push({ review_point: parseInt(starMatch[1], 10), count: parseInt(countMatch2[1], 10) });
        }
      });
      if (detail.length) {
        const total = detail.reduce((sum, d) => sum + d.count, 0);
        work.rate_count_detail = detail
          .sort((a, b) => a.review_point - b.review_point)
          .map((d) => ({
            review_point: d.review_point,
            count: d.count,
            ratio: total > 0 ? Math.round((d.count / total) * 100) : 0,
          }));
      }

      // Fallback: star icon + count next to the work title when the review
      // section is absent (e.g. <span class="u-common__ico--review45"></span> ( 9 件))
      const reviewItem = $('div.userReview__item');
      if (reviewItem.length) {
        if (work.rate_average_2dp === null) {
          const ratingSpan = reviewItem.find('a span[class*="u-common__ico--review"]');
          if (ratingSpan.length) {
            const classList = ratingSpan.attr('class') || '';
            const ratingMatch = classList.match(/review(\d{1,2})/);
            if (ratingMatch) {
              work.rate_average_2dp = parseInt(ratingMatch[1], 10) / 10;
            }
          }
        }
        if (work.rate_count === null) {
          const countMatch3 = reviewItem.find('.userReview__txt').text().match(/(\d[\d,]*)\s*件/);
          if (countMatch3) {
            work.rate_count = parseInt(countMatch3[1].replace(/,/g, ''), 10);
          }
        }
      }

      if (!work.title && work.tags.length === 0 && work.vas.length === 0) {
        reject(new Error('Could not parse data from Fanza work page.'));
        return;
      }

      resolve(work);
    })
    .catch((error) => {
      if (error.response) {
        reject(new Error(`Could not request Fanza work page (${url}), received: ${error.response.status}.`));
      } else {
        reject(error);
      }
    });
});

module.exports = {
  scrapeWorkMetadataFromFanza,
};
