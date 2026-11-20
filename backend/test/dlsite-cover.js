/* eslint-disable n/no-unpublished-require */
// Which work id a DLsite page's cover is filed under — translated works point
// at the original, and the guessed path from the translated id is a 404

process.env.FREEZE_CONFIG_FILE = '1';

const chai = require('chai');
const expect = chai.expect;

const axios = require('../scraper/axios');
const { scrapeCoverIdForTranslatedWorkFromDLsite } = require('../scraper/dlsite');

const ORIGINAL_COVER = 'https://img.dlsite.jp/modpub/images2/work/doujin/RJ01605000/RJ01604150_img_main.jpg';

// The slider serves its images protocol-relative; og:image carries the same
// URL absolute. Both are on every real page of this markup.
const currentPage = (coverUrl) => `<html><head>
    <meta property="og:image" content="${coverUrl}">
  </head><body>
    <div class="key-visual-slider">
      <picture><img src="${coverUrl.replace(/^https:/, '')}"></picture>
      <picture><img src="//img.dlsite.jp/modpub/images2/work/doujin/RJ01615000/RJ01614412_img_smp1.jpg"></picture>
    </div>
  </body></html>`;

const legacyPage = (coverUrl) => `<html><body>
    <ul class="work_edition_linklist type_trans">
      <li><a class="work_edition_linklist_item" href="/maniax/work/=/product_id/RJ01604150.html">日本語版</a></li>
    </ul>
    <img srcset="${coverUrl.replace(/^https:/, '')}">
  </body></html>`;

describe('DLsite cover source id', function () {
  const originalRetryGet = axios.retryGet;
  let html = '';

  before(function () { axios.retryGet = async () => ({ data: html }); });
  after(function () { axios.retryGet = originalRetryGet; });

  const scrape = (pageHtml, id = '01614412') => {
    html = pageHtml;
    return scrapeCoverIdForTranslatedWorkFromDLsite(id);
  };

  it('follows the rendered cover URL to the original work of a translation', async function () {
    const result = await scrape(currentPage(ORIGINAL_COVER));

    expect(result.coverFromId).to.equal('01604150');
    expect(result.coverUrls.main).to.equal(ORIGINAL_COVER);
    expect(result.coverUrls.sam).to.equal(ORIGINAL_COVER.replace('_img_main', '_img_sam'));
    expect(result.isNoImgMain).to.be.false;
  });

  it('keeps the work id when the page renders its own cover', async function () {
    const own = 'https://img.dlsite.jp/modpub/images2/work/doujin/RJ01615000/RJ01614412_img_main.jpg';
    const result = await scrape(currentPage(own));

    expect(result.coverFromId).to.equal('01614412');
    expect(result.coverUrls.main).to.equal(own);
  });

  it('reports a page that renders only the no-cover placeholder', async function () {
    const placeholder = 'https://img.dlsite.jp/modpub/images2/work/doujin/no_img_main.jpg';
    const result = await scrape(currentPage(placeholder));

    expect(result.isNoImgMain).to.be.true;
    expect(result.coverFromId).to.equal('01614412');
    expect(result.coverUrls).to.be.undefined;
  });

  it('keeps the BJ prefix of a books-floor cover', async function () {
    const cover = 'https://img.dlsite.jp/modpub/images2/work/books/BJ01605000/BJ01604150_img_main.jpg';
    const result = await scrape(currentPage(cover), 'BJ01614412');

    expect(result.coverFromId).to.equal('BJ01604150');
    expect(result.coverUrls.main).to.equal(cover);
  });

  it('still reads the edition list of the older markup', async function () {
    const result = await scrape(legacyPage(ORIGINAL_COVER));

    expect(result.coverFromId).to.equal('01604150');
  });
});
