const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { config } = require('../config');
const db = require('../database/db');
const { isValidRequest, workIdParam } = require('./utils/validate');
const { resolveTrack } = require('./utils/track');

// Report per-track playback progress (Phase 2)
// The track is addressed the same way the media routes address it, so the
// frontend posts to `/api/track-progress/${trackId}` and carries no second
// identifier. Resolving through resolveTrack also rejects a path that is not
// actually a file of this work, rather than writing a row keyed by junk.
router.put('/:id/*path',
  workIdParam(),
  body('seconds').isFloat({ min: 0 }),
  body('completed').isBoolean(),
  async (req, res, next) => {
    if(!isValidRequest(req, res)) return;

    const username = config.auth ? req.user.name : 'admin';
    try {
      const resolved = await resolveTrack(req, res);
      if (!resolved) return;

      await db.upsertTrackProgress(
        username,
        req.params.id,
        resolved.track.shortFilePath,
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
