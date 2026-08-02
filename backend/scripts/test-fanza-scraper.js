/**
 * Manual test for the Fanza scraper.
 *
 * Usage:
 *   node scripts/test-fanza-scraper.js d_215444 [d_XXXXXX ...]
 *
 * Prints every field scraped from the Fanza doujin detail page.
 * Proxy settings from config/config.json (httpProxyHost/httpProxyPort) apply.
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

(async () => {
  let failed = 0;
  for (const id of ids) {
    console.log(`\nScraping ${id} ...`);
    try {
      const work = await scrapeWorkMetadataFromFanza(id);
      printWork(work);
    } catch (err) {
      failed += 1;
      console.error(`FAILED ${id}: ${err.message}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
})();
