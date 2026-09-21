const path = require('path');
const urljoin = require('url-join');

// work.dir and track.subtitle may contain '/' or '\' if they have subfolders
// ["RJ123456", "画像/好きな人?"] => ["RJ123456", "%E7%94%BB%E5%83%8F", "%E5%A5%BD%E3%81%8D%E3%81%AA%E4%BA%BA%3F"]
const encodeSplitFragments = (fragments) => {
  // On windows, replace "dir\RJ123456" => "dir/RJ123456"
  const expandedFragments = fragments.map(fragment => fragment.replace(/\\/g, '/').split('/'));
  return expandedFragments.flat().map(fragment => encodeURIComponent(fragment));
};

const joinFragments = (baseUrl, ...fragments) => {
  const pattern = new RegExp(/^https?:\/\//);
  const encodedFragments = encodeSplitFragments(fragments);

  // http(s)://example.com/
  if (pattern.test(baseUrl)) {
    return urljoin(baseUrl, ...encodedFragments);
  } else {
    // /media/stream/
    //
    // Deliberately NOT encoded, and pinned that way by test/urljoin.js: this
    // addresses the reverse proxy's own virtual directory, and the operator's
    // alias/root mapping is what has to agree with it. It carries the same
    // latent '#' defect encodeTrackId fixes for /api/media/* -- a work whose
    // files start with '#' will 404 under config.offloadMedia -- but changing
    // it is a change to someone's proxy contract, not a bug fix.
    return path.join(baseUrl, ...fragments).replace(/\\/g, '/');
  }
};

/**
 * Percent-encode a trackId for use as URL path segments.
 *
 * A trackId is `${workId}/${relPath}` and relPath is a real file name, so it
 * routinely contains characters that are *syntax* in a URL. `#` is the one
 * that bites: a name like `#1.序章.opus` truncated the path at the fragment
 * marker, the server received `/api/media/stream/<id>/` with no file, and
 * playback 404'd on a file that was sitting right there. `?` and `%` are the
 * same class of problem.
 *
 * Per segment, so the `/` separators survive. `encodeURI` is *not* enough --
 * it deliberately leaves `#` and `?` alone as reserved syntax.
 *
 * Non-ASCII was never actually broken: a browser percent-encodes those itself
 * before sending. Encoding here just makes the string we hand out match the
 * request that comes back.
 */
const encodeTrackId = (trackId) => String(trackId).split('/').map(encodeURIComponent).join('/');

module.exports = { joinFragments, encodeTrackId };