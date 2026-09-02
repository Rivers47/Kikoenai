/**
 * E-Hentai style advanced search query parsing.
 *
 * Grammar — whitespace separates terms, every term must match (AND):
 *
 *   term      := ['-'] [ namespace ':' ] value
 *   value     := '"' anything '"' | bare
 *   bare      := run of non-whitespace; each '_' stands for a space
 *
 * A trailing '$' (inside or right after the quotes) anchors the value: it has
 * to match the whole name instead of any substring. A leading '-' negates the
 * term. A term without a namespace keeps the old behaviour — it is matched
 * against every metadata field at once.
 *
 * An unknown namespace is not special: `foo:bar` searches for the literal text
 * "foo:bar", so titles containing a colon still work.
 *
 *   va:"space separated name$"   circle:underscore_name   -tag:NTR
 *
 * This module is the only definition of the grammar. The frontend renders the
 * same terms the backend matches on, so it imports this file directly rather
 * than mirroring it (`FilterTerms.vue`, `src/utils.js`). Keep it free of
 * `require`s and of anything Node-only, or the browser bundle breaks.
 */

/** Accepted namespaces (lower-cased) → canonical field name. */
const FIELD_ALIASES = {
  circle: 'circle', group: 'circle',
  tag: 'tag', tags: 'tag',
  va: 'va', cv: 'va', voice: 'va',
  illustrator: 'illustrator', illust: 'illustrator',
  script_writer: 'script_writer', scriptwriter: 'script_writer',
  scenario: 'script_writer', script: 'script_writer',
  series: 'series',
  author: 'author',
  title: 'title',
  id: 'id',
};

/** Canonical field → the tables that link a work to that name. */
const RELATION_FIELDS = {
  tag: { nameTable: 't_tag', relTable: 'r_tag_work', key: 'tag_id' },
  va: { nameTable: 't_va', relTable: 'r_va_work', key: 'va_id' },
  illustrator: { nameTable: 't_illustrator', relTable: 'r_illustrator_work', key: 'illustrator_id' },
  script_writer: { nameTable: 't_script_writer', relTable: 'r_script_writer_work', key: 'script_writer_id' },
  series: { nameTable: 't_series', relTable: 'r_series_work', key: 'series_id' },
  author: { nameTable: 't_author', relTable: 'r_author_work', key: 'author_id' },
};

const isSpace = (char) => char === undefined || /\s/.test(char);

/**
 * Split a raw search box string into filter terms.
 * @param {String} filter
 * @returns {Array<{field: ?String, value: String, raw: String, exact: Boolean, negate: Boolean}>}
 *          `field` is null for a free-text term; terms are ANDed by the caller.
 *          `raw` is the value before underscores become spaces — work codes
 *          such as `d_123456` have to be read off that one.
 */
const parseSearchQuery = (filter) => {
  const input = String(filter || '');
  const terms = [];
  let i = 0;

  while (i < input.length) {
    if (isSpace(input[i])) { i += 1; continue; }

    let negate = false;
    if (input[i] === '-' && !isSpace(input[i + 1])) {
      negate = true;
      i += 1;
    }

    let field = null;
    const prefix = /^([A-Za-z_]+):/.exec(input.slice(i));
    if (prefix && FIELD_ALIASES[prefix[1].toLowerCase()]) {
      field = FIELD_ALIASES[prefix[1].toLowerCase()];
      i += prefix[0].length;
    }

    let value;
    const quoted = input[i] === '"';
    if (quoted) {
      const end = input.indexOf('"', i + 1);
      value = (end === -1) ? input.slice(i + 1) : input.slice(i + 1, end);
      i = (end === -1) ? input.length : end + 1;
    } else {
      let end = i;
      while (end < input.length && !isSpace(input[end])) end += 1;
      value = input.slice(i, end);
      i = end;
    }

    // '$' anchors the match, whether it sits inside or after the quotes
    let exact = false;
    while (input[i] === '$') { exact = true; i += 1; }
    if (value.endsWith('$')) {
      exact = true;
      value = value.slice(0, -1);
    }

    const raw = value.trim();
    if (!quoted) value = value.replace(/_/g, ' ');
    value = value.trim();
    if (value) terms.push({ field, value, raw, exact, negate });
  }

  return terms;
};

/**
 * Render one term back into query syntax — the inverse of parseSearchQuery,
 * used by the frontend to build a filter from a clicked label and to drop a
 * term from an existing one.
 *
 * The value is always quoted, so it survives verbatim: the bare form rewrites
 * '_' as a space, which would silently retarget any name containing one.
 * @param {{field: ?String, value: String, exact: Boolean, negate: Boolean}} term
 * @returns {String}
 */
const formatSearchTerm = ({ field, value, exact = false, negate = false }) =>
  `${negate ? '-' : ''}${field ? `${field}:` : ''}"${value}${exact ? '$' : ''}"`;

/** Join terms back into a single search box string. */
const formatSearchQuery = (terms) => terms.map(formatSearchTerm).join(' ');

module.exports = {
  parseSearchQuery,
  formatSearchTerm,
  formatSearchQuery,
  FIELD_ALIASES,
  RELATION_FIELDS,
};
