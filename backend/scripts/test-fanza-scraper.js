/**
 * Manual test for the Fanza scraper.
 *
 * Usage:
 *   node scripts/test-fanza-scraper.js d_215444 [d_XXXXXX ...]
 *   node scripts/test-fanza-scraper.js --dump d_215444
 *
 * Prints every field scraped from the Fanza doujin detail page.
 * Proxy settings from config/config.json (httpProxyHost/httpProxyPort) apply.
 *
 * --dump also saves the raw page HTML to ./fanza-<cid>.html and prints a
 * diagnostic view of the product-information table and price-ish elements,
 * for debugging selector mismatches.
 */

// Prevent writing config files (side effect of config.js)
process.env.FREEZE_CONFIG_FILE = '1';

const args = process.argv.slice(2);

// --no-proxy: ignore the proxy from config/config.json (scraper/axios.js
// reads it at module-load time, so clear it before requiring the scraper)
if (args.includes('--no-proxy')) {
  const { config } = require('../config');
  config.httpProxyHost = '';
  config.httpProxyPort = null;
}

const { scrapeWorkMetadataFromFanza } = require('../scraper/fanza');

const dump = args.includes('--dump');
const ids = args.filter((a) => !a.startsWith('--'));

if (ids.length === 0) {
  console.error('Usage: node scripts/test-fanza-scraper.js d_215444 [d_XXXXXX ...]');
  process.exit(1);
}

const printWork = (work) => {
  console.log('─'.repeat(60));
  console.log(`id:                ${work.id}`);
  console.log(`title:             ${work.title}`);
  console.log(`circle:            ${work.circle ? work.circle.name : '(none)'}`);
  console.log(`release:           ${work.release}`);
  console.log(`nsfw:              ${work.nsfw}`);
  console.log(`price:             ${work.price}`);
  console.log(`tags:              ${(work.tags || []).map((t) => t.name).join(', ') || '(none)'}`);
  console.log(`vas:               ${(work.vas || []).map((v) => v.name).join(', ') || '(none)'}`);
  console.log(`illustrators:      ${(work.illustrators || []).map((i) => i.name).join(', ') || '(none)'}`);
  console.log(`scriptWriters:     ${(work.scriptWriters || []).map((s) => s.name).join(', ') || '(none)'}`);
  console.log(`series:            ${work.series ? work.series.name : '(none)'}`);
  console.log(`rate_average_2dp:  ${work.rate_average_2dp}`);
  console.log(`rate_count:        ${work.rate_count}`);
  console.log(`review_count:      ${work.review_count}`);
  console.log(`dl_count:          ${work.dl_count}`);
  console.log(`rank:              ${work.rank}`);
  console.log(`rate_count_detail: ${work.rate_count_detail}`);
  console.log('─'.repeat(60));
  console.log('Raw object:');
  console.dir(work, { depth: null });
  console.log();
};

const dumpPage = async (id) => {
  const path = require('path');
  const fs = require('fs');
  const cheerio = require('cheerio');
  const axios = require('../scraper/axios');

  const url = `https://www.dmm.co.jp/dc/doujin/-/detail/=/cid=${id}/`;
  const response = await axios.retryGet(url, {
    retry: {},
    headers: { cookie: 'age_check_done=1; dc_doujin_age_check_done=1' },
  });
  const html = response.data;
  const file = path.resolve(`fanza-${id}.html`);
  fs.writeFileSync(file, html);
  console.log(`HTML saved to: ${file} (${html.length} bytes)`);

  const $ = cheerio.load(html);

  console.log('\nProduct-information rows found:');
  const items = $('div.m-productInformation div.productInformation__item');
  console.log(`  (selector matched ${items.length} rows)`);
  items.each(function () {
    const header = $(this).find('dt.informationList__ttl').text().trim();
    const value = $(this).find('dd').text().trim().replace(/\s+/g, ' ');
    console.log(`  [${header}] = ${value}`);
  });

  console.log('\nPrice-ish elements (text content):');
  ['.m-productPrice', '.productPrice', '.productPrice__txt', '.m-productDetailPrice', '#price', '.price'].forEach((sel) => {
    $(sel).each(function () {
      const text = $(this).text().trim().replace(/\s+/g, ' ');
      if (text) console.log(`  ${sel}: ${text.slice(0, 120)}`);
    });
  });
  console.log('');
};

(async () => {
  let failed = 0;
  for (const id of ids) {
    console.log(`\nScraping ${id} ...`);
    try {
      if (dump) {
        await dumpPage(id);
      }
      const work = await scrapeWorkMetadataFromFanza(id);
      printWork(work);
    } catch (err) {
      failed += 1;
      console.error(`FAILED ${id}: ${err.message}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
})();
