/*
 * Makes a scraped 作品内容 block safe to hand to the browser.
 *
 * `t_work.description` holds the seller's markup exactly as DLsite served it,
 * so nothing may reach a page from here unfiltered. Sanitizing when the
 * work is *served* rather than when it is scraped is deliberate: an allowlist
 * always needs adjusting, and doing it here fixes the whole library at once,
 * while a scrape-time filter would leave every already-stored work carrying
 * whatever the old rules let through until it was scraped again.
 *
 * Everything is denied unless listed. Unknown elements are unwrapped rather
 * than dropped -- their text is the blurb -- while the few whose *content* is
 * never prose (script, style, iframe, …) are removed outright.
 */

const cheerio = require('cheerio');

const { config } = require('../../config');

// Structure and emphasis, which is what a seller's blurb is made of.
const ALLOWED_TAGS = new Set([
  'p', 'div', 'span', 'br', 'hr',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del', 'ins', 'mark', 'small', 'sub', 'sup', 'font',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption',
  'blockquote', 'pre', 'code',
  'a', 'img',
]);

// Removed with their subtree: nothing inside is text worth keeping.
const DROPPED_TAGS = ['script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'form', 'input', 'button', 'select', 'textarea', 'link', 'meta', 'base', 'noscript', 'template', 'svg', 'math'];

const ALLOWED_ATTRS = {
  a: new Set(['href', 'title']),
  // `loading` is ours, set by the image pass; the attribute walk runs after it
  // and would otherwise strip it back off.
  img: new Set(['src', 'alt', 'width', 'height', 'loading']),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan']),
};

// Layout and emphasis survive; anything that paints does not. Sellers pick
// colours for DLsite's white page, and this app has a dark theme -- see
// frontend/AGENTS.md §2.7.
const ALLOWED_STYLE_PROPS = new Set([
  'text-align', 'text-decoration', 'font-weight', 'font-style', 'font-size',
  'line-height', 'letter-spacing', 'vertical-align',
]);

const SAFE_HREF = /^(https?:)?\/\//i;

/**
 * Key an image url so the stored entry and the markup agree.
 *
 * They do not agree as written: DLsite serves the block with protocol-relative
 * sources (`//img.dlsite.jp/…`) while `absoluteAssetUrl` in scraper/dlsite.js
 * stores the absolutized form, so matching the two verbatim finds nothing and
 * drops every image as "never downloaded".
 * @param {String} url
 * @returns {String}
 */
const imageKey = url => String(url || '').trim().replace(/^https?:/i, '');

/** Where this server serves one downloaded image from. */
const localImageUrl = (workId, file) =>
  `${config.basePath}/api/image/${encodeURIComponent(workId)}/${encodeURIComponent(file)}`;

// A row written before the scraper kept the markup, or by the JSON fallback
// (intro_s is plain text DLsite already flattened). Those render down the old
// plain-text path instead, which keeps their line breaks and the images and
// track list the scraper pulled out separately. They become markup the next
// time the work is scanned or refreshed.
const HTML_TAG = /<[a-z][^>]*>/i;

/**
 * Whether a stored description is markup rather than plain text.
 * @param {String} description
 * @returns {Boolean}
 */
const looksLikeHtml = description => HTML_TAG.test(String(description || ''));

/**
 * Keep only the declarations that lay text out, never the ones that colour it.
 * @param {String} style Raw style attribute.
 * @returns {String} Filtered style attribute, '' when nothing survives.
 */
const filterStyle = (style) => String(style)
  .split(';')
  .map(declaration => declaration.trim())
  .filter((declaration) => {
    const name = declaration.split(':')[0];
    if (!name) return false;
    // url() in any value is a fetch the page did not ask for.
    if (/url\s*\(/i.test(declaration)) return false;
    return ALLOWED_STYLE_PROPS.has(name.trim().toLowerCase());
  })
  .join('; ');

/**
 * Sanitize one work's description markup, pointing its images at local files.
 *
 * @param {String} html Raw `description`, when it is markup.
 * @param {String} workId Work id, for building image urls.
 * @param {Array<Object>} [sampleImages] `t_work.sample_images`; supplies the
 *   downloaded file for each remote url.
 * @returns {String} Markup safe for v-html, '' when nothing is left.
 */
function sanitizeDescriptionHtml(html, workId, sampleImages = []) {
  if (!html) return '';

  // Remote url -> local file name, for the images that were downloaded.
  const fileByUrl = {};
  for (const image of sampleImages) {
    if (image && image.url && image.file) fileByUrl[imageKey(image.url)] = image.file;
  }

  const $ = cheerio.load(html, null, false);
  const localPrefix = `${config.basePath}/api/image/`;

  $(DROPPED_TAGS.join(',')).remove();
  $('comment').remove();

  // Images first, and with them the links DLsite wraps around them, so the
  // link pass below sees a local url rather than rewriting one to img.dlsite.jp.
  $('img').each(function () {
    const img = $(this);
    const link = img.parent('a');
    const linkedFile = fileByUrl[imageKey(link.attr('href'))];

    // Local copies only, matching the rest of the page: an image nobody
    // downloaded is dropped rather than hotlinked from img.dlsite.jp.
    //
    // The wrapping <a> is the second place to look for the file: DLsite links
    // the full-size original around a resized <img>, and parseDescriptionParts
    // prefers that href, so the download can be keyed by it.
    const file = fileByUrl[imageKey(img.attr('src'))] || linkedFile;
    if (!file) {
      // An <a> that held nothing but this image is now an empty click target.
      if (link.length && !link.text().trim() && link.children().length <= 1) link.remove();
      else img.remove();
      return;
    }

    img.attr('src', localImageUrl(workId, file));
    img.attr('loading', 'lazy');

    // Clicking the picture must not leave for DLsite either: point the link at
    // the copy this server holds. A link to something we do not have stays as
    // it is and is handled as an ordinary external link below.
    if (linkedFile) link.attr('href', localImageUrl(workId, linkedFile));
  });

  $('*').each(function () {
    const el = $(this);
    const tag = (this.tagName || '').toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      // Unwrap: the tag goes, its text stays where the seller put it.
      el.replaceWith(el.contents());
      return;
    }

    const allowed = ALLOWED_ATTRS[tag] || new Set();
    for (const name of Object.keys(this.attribs || {})) {
      const lower = name.toLowerCase();
      if (lower === 'style') {
        const style = filterStyle(this.attribs[name]);
        if (style) el.attr('style', style);
        else el.removeAttr(name);
        continue;
      }
      if (!allowed.has(lower)) el.removeAttr(name);
    }

    if (tag === 'a') {
      const href = el.attr('href');
      // A link already pointing at this server is one the image pass rewrote.
      if (href && href.startsWith(localPrefix)) {
        el.attr('target', '_blank');
        el.attr('rel', 'noopener noreferrer');
        return;
      }
      if (!href || !SAFE_HREF.test(href)) {
        // javascript:, data:, and relative links into a site that is not this
        // one. The label is still prose, so unwrap rather than remove.
        el.replaceWith(el.contents());
        return;
      }
      el.attr('target', '_blank');
      el.attr('rel', 'noopener noreferrer');
    }
  });

  return $.html().trim();
}

module.exports = { sanitizeDescriptionHtml, looksLikeHtml };
