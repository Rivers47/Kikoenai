// Multi-select list filters shared by /api/works, /api/search and /api/history.

const RATING_VALUES = ['sfw', 'nsfw'];
// `unmarked` is not a t_review.progress value: it stands for a work with no
// progress at all (no t_review row, or a rating-only row).
const PROGRESS_VALUES = ['marked', 'listened', 'postponed', 'unmarked'];
// `has` = the user starred the work or left a review text on it; `none` = they
// did neither. Status is NOT part of this (it has its own list), so a work can
// be `progress=marked` and `review=none` at once. Not row existence: t_review
// can hold an all-NULL row, which means no more than a missing row does.
const REVIEW_VALUES = ['has', 'none'];

const INVALID_FILTER_MESSAGE =
  `筛选参数无效，rating 仅接受 ${RATING_VALUES.join(',')}，progress 仅接受 ${PROGRESS_VALUES.join(',')}，` +
  `review 仅接受 ${REVIEW_VALUES.join(',')}`;

/**
 * Comma-separated query value -> array of allowed values. Absent means "no
 * restriction"; a value outside `allowed` invalidates the whole list, so the
 * caller can answer 400 rather than silently filtering everything out.
 * @returns {String[]|undefined|null} null when invalid
 */
const parseFilterList = (raw, allowed) => {
  if (raw === undefined || raw === '') return undefined;
  const values = String(raw).split(',').map((v) => v.trim()).filter(Boolean);
  if (!values.length || values.some((v) => !allowed.includes(v))) return null;
  return values;
};

module.exports = { RATING_VALUES, PROGRESS_VALUES, REVIEW_VALUES, INVALID_FILTER_MESSAGE, parseFilterList };
