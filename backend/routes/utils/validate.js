const { validationResult } = require('express-validator');
const { canonicalizeWorkId } = require('../../work-id');

const isValidRequest = (req, res, sendMessage = true) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    if (sendMessage) {
      res.status(400).json({ errors: errors.array() });
    }
    return false;
  } else {
    return true;
  }
};

/**
 * Pre-migration databases stored DLsite ids as bare integers, so 7-digit ids
 * (which since migration 20260802000000 are stored zero-padded to 8 digits)
 * may still arrive from stale client caches (PWA service worker, localStorage)
 * or old bookmarks. A 7-digit string is never a canonical work id — formatID
 * pads to either 6 or 8 digits — so padding it here is always safe and lets
 * legacy ids self-heal on every route using these validators.
 */
const padLegacyId = (id) => (/^\d{7}$/.test(id) ? `0${id}` : id);

/**
 * Sanitizer for every work-id route parameter: pads a legacy 7-digit DLsite id
 * and folds Fanza's underscore spelling onto the canonical one, so a URL held
 * by an old bookmark or a stale PWA cache (`/work/d_215444`) keeps resolving
 * after migration 20260828000000. See work-id.js.
 */
const normalizeWorkId = (id) => canonicalizeWorkId(padLegacyId(id));

/**
 * Returns an express-validator chain for a work id param (route param).
 * DLsite ids are \d{6,8} (zero-padded 6 or 8 digits), Fanza ids are d\d+ —
 * the legacy d_\d+ spelling is accepted and sanitized to the canonical form.
 */
const workIdParam = () => require('express-validator').param('id').isString().matches(/^(\d{6,8}|d_?\d+)$/).customSanitizer(normalizeWorkId);

/**
 * Returns an express-validator chain for a work_id body field.
 */
const workIdBody = () => require('express-validator').body('work_id').isString().matches(/^(\d{6,8}|d_?\d+)$/).customSanitizer(normalizeWorkId);

/**
 * Returns an express-validator chain for a work_id query parameter.
 */
const workIdQuery = () => require('express-validator').query('work_id').isString().matches(/^(\d{6,8}|d_?\d+)$/).customSanitizer(normalizeWorkId);

module.exports = { isValidRequest, workIdParam, workIdBody, workIdQuery };