const cheerio = require('cheerio');
const axios = require('./axios');
const { nameToUUID } = require('./utils');

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

      // Circle
      const circleEl = $('.circleName__txt');
      if (circleEl.length) {
        work.circle = { name: circleEl.text().trim() };
      }

      // Information table: walk rows generically
      const infoItems = $('div.m-productInformation div.productInformation__item');
      infoItems.each(function () {
        const header = $(this).find('dt.informationList__ttl').text().trim();
        const valueEl = $(this).find('dd.informationList__txt, dd.informationList__item');

        switch (header) {
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
              if (tagName) {
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

      // Rating / review_count from review element
      const reviewItem = $('div.userReview__item');
      if (reviewItem.length) {
        // Rating: look for span with class matching u-common__ico--reviewNN
        const ratingSpan = reviewItem.find('a span[class*="u-common__ico--review"]');
        if (ratingSpan.length) {
          const classList = ratingSpan.attr('class') || '';
          const ratingMatch = classList.match(/review(\d{1,2})/);
          if (ratingMatch) {
            work.rate_average_2dp = parseInt(ratingMatch[1], 10) / 10;
          }
        }
        // Review count from link text
        const reviewLink = reviewItem.find('a');
        const reviewLinkText = reviewLink.text().trim();
        const countMatch = reviewLinkText.match(/(\d+)/);
        if (countMatch) {
          work.review_count = parseInt(countMatch[1], 10);
        }
        work.rate_count = work.review_count;
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