/* eslint-disable n/no-unpublished-require */
// The allowlist that stands between seller-authored markup and v-html

process.env.FREEZE_CONFIG_FILE = '1';

const chai = require('chai');
const expect = chai.expect;

const { config } = require('../config');
const { sanitizeDescriptionHtml, looksLikeHtml } = require('../routes/utils/description-html');

const IMAGES = [
  { url: 'https://img.dlsite.jp/parts/aaa.jpg', file: 'RJ123456_img_part1.jpg' },
  { url: 'https://img.dlsite.jp/parts/bbb.jpg', file: null },
];

const clean = html => sanitizeDescriptionHtml(html, '123456', IMAGES);

describe('looksLikeHtml', function () {
  it('tells a scraped blurb from a row that predates the markup', function () {
    expect(looksLikeHtml('<p>text</p>')).to.be.true;
    expect(looksLikeHtml('前<br>後')).to.be.true;
    // Plain text, including the JSON fallback's intro_s and text that merely
    // contains angle brackets.
    expect(looksLikeHtml('キャラ紹介\n・Lカップ')).to.be.false;
    expect(looksLikeHtml('5 < 6 > 4')).to.be.false;
    expect(looksLikeHtml('')).to.be.false;
    expect(looksLikeHtml(null)).to.be.false;
  });
});

describe('sanitizeDescriptionHtml', function () {
  it('keeps the structure and emphasis a blurb is made of', function () {
    const out = clean('<p>一行目<br>二行目</p><ul><li><b>太字</b>と<em>斜体</em></li></ul>');
    expect(out).to.equal('<p>一行目<br>二行目</p><ul><li><b>太字</b>と<em>斜体</em></li></ul>');
  });

  it('removes scripts and their content outright', function () {
    const out = clean('<p>前</p><script>alert(1)</script><style>body{}</style><p>後</p>');
    expect(out).to.equal('<p>前</p><p>後</p>');
  });

  it('drops event handlers and unknown attributes, keeping the element', function () {
    const out = clean('<p class="work_parts" onclick="steal()" data-x="1">text</p>');
    expect(out).to.equal('<p>text</p>');
  });

  it('unwraps an unknown tag rather than losing its text', function () {
    expect(clean('<marquee>読んで</marquee>')).to.equal('読んで');
  });

  it('strips colours but keeps layout declarations', function () {
    const out = clean('<span style="color:#ff00ff;background:#000;font-size:20px;text-align:center">x</span>');
    expect(out).to.equal('<span style="font-size:20px; text-align:center">x</span>');
  });

  it('refuses a style value that fetches something', function () {
    expect(clean('<p style="font-size:url(http://evil/x)">x</p>')).to.equal('<p>x</p>');
  });

  it('points a downloaded image at the local file', function () {
    const out = clean('<img src="https://img.dlsite.jp/parts/aaa.jpg" alt="a">');
    expect(out).to.equal('<img src="/api/image/123456/RJ123456_img_part1.jpg" alt="a" loading="lazy">');
  });

  it('matches the stored url however the markup spells the scheme', function () {
    // What DLsite actually serves: protocol-relative, while the scraper stored
    // the absolutized form.
    expect(clean('<img src="//img.dlsite.jp/parts/aaa.jpg">'))
      .to.equal('<img src="/api/image/123456/RJ123456_img_part1.jpg" loading="lazy">');
    expect(clean('<img src="http://img.dlsite.jp/parts/aaa.jpg">'))
      .to.equal('<img src="/api/image/123456/RJ123456_img_part1.jpg" loading="lazy">');
  });

  it('falls back to the full-size url the <a> wrapper carries', function () {
    // DLsite links the original around a resized copy, and the scraper stores
    // the href, so the <img src> alone would find nothing.
    const out = clean('<a href="//img.dlsite.jp/parts/aaa.jpg"><img src="//img.dlsite.jp/resize/aaa_600x600.jpg"></a>');
    expect(out).to.contain('src="/api/image/123456/RJ123456_img_part1.jpg"');
  });

  it('sends a click on the picture to the local copy, not to DLsite', function () {
    const out = clean('<a href="//img.dlsite.jp/parts/aaa.jpg"><img src="//img.dlsite.jp/parts/aaa.jpg"></a>');
    expect(out).to.equal('<a href="/api/image/123456/RJ123456_img_part1.jpg" target="_blank" rel="noopener noreferrer">'
      + '<img src="/api/image/123456/RJ123456_img_part1.jpg" loading="lazy"></a>');
    expect(out).to.not.contain('dlsite.jp');
  });

  it('drops a link that wrapped nothing but an undownloaded image', function () {
    expect(clean('<p>a</p><a href="//img.dlsite.jp/parts/bbb.jpg"><img src="//img.dlsite.jp/parts/bbb.jpg"></a>'))
      .to.equal('<p>a</p>');
  });

  it('keeps a labelled link to an image it does not hold', function () {
    // Not a picture, a worded link: the label is prose, and the destination is
    // an ordinary external link.
    const out = clean('<a href="https://img.dlsite.jp/parts/bbb.jpg">大きい画像</a>');
    expect(out).to.equal('<a href="https://img.dlsite.jp/parts/bbb.jpg" target="_blank" rel="noopener noreferrer">大きい画像</a>');
  });

  it('drops an image that was never downloaded, rather than hotlinking it', function () {
    expect(clean('<p>a</p><img src="https://img.dlsite.jp/parts/bbb.jpg">')).to.equal('<p>a</p>');
    expect(clean('<img src="https://img.dlsite.jp/parts/unknown.jpg">')).to.equal('');
  });

  it('carries the deploy prefix into image urls', function () {
    const original = config.basePath;
    config.basePath = '/kikoeru';
    try {
      expect(clean('<img src="https://img.dlsite.jp/parts/aaa.jpg">'))
        .to.equal('<img src="/kikoeru/api/image/123456/RJ123456_img_part1.jpg" loading="lazy">');
    } finally {
      config.basePath = original;
    }
  });

  it('keeps an http link, marked safe to open', function () {
    expect(clean('<a href="https://example.com">x</a>'))
      .to.equal('<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>');
  });

  it('unwraps a javascript: link, keeping its label', function () {
    expect(clean('<a href="javascript:alert(1)">押して</a>')).to.equal('押して');
    expect(clean('<a href="data:text/html,x">押して</a>')).to.equal('押して');
  });

  it('survives empty and malformed input', function () {
    expect(clean('')).to.equal('');
    expect(clean(null)).to.equal('');
    expect(clean('<p>unclosed')).to.equal('<p>unclosed</p>');
  });
});
