const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { config } = require('../config');
const db = require('../database/db');
const { isValidRequest, workIdBody } = require('./utils/validate');

// Report per-track playback progress (Phase 2)
// Fire-and-forget write: keyed directly by the contentHash the frontend
// already carries — no file read, no hash computation at write time.
router.put('/',
  workIdBody(),
  body('contentHash').isString().isLength({ min: 64, max: 64 }),
  body('seconds').isFloat({ min: 0 }),
  body('completed').isBoolean(),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    const username = config.auth ? req.user.name : 'admin';
    try {
      await db.upsertTrackProgress(
        username,
        req.body.work_id,
        req.body.contentHash,
        req.body.seconds,
        req.body.completed
      );
      res.send({ message: '更新进度成功' });
    } catch (err) {
      console.error(err);
      res.status(500).send({ error: '更新进度失败' });
    }
  }
);

module.exports = router;