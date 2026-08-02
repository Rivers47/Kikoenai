const { validationResult } = require('express-validator');

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
 * Returns an express-validator chain for a work id param (route param).
 * DLsite ids are \d{6,8} (zero-padded 6 or 8 digits), Fanza ids are d_\d+.
 */
const workIdParam = () => require('express-validator').param('id').isString().matches(/^(\d{6,8}|d_\d+)$/);

/**
 * Returns an express-validator chain for a work_id body field.
 */
const workIdBody = () => require('express-validator').body('work_id').isString().matches(/^(\d{6,8}|d_\d+)$/);

/**
 * Returns an express-validator chain for a work_id query parameter.
 */
const workIdQuery = () => require('express-validator').query('work_id').isString().matches(/^(\d{6,8}|d_\d+)$/);

module.exports = { isValidRequest, workIdParam, workIdBody, workIdQuery };