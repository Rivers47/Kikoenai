// Re-run the VA alias merge for entries added to scraper/va-aliases.json after
// 20260814000000_merge_va_aliases.js (琴音有波 / 紅月ことね → 琴音有波(紅月ことね)).
// The merge is idempotent: variants already folded no longer have a t_va row.

exports.up = require('./20260814000000_merge_va_aliases').up;

exports.down = async function() {};
