const express = require('express');
const router = express.Router();

// Debug endpoint for mobile background playback testing
// Logs debug events from the frontend to the server console
router.post('/playback',
  (req, res, next) => {
    const body = req.body || {};
    const { event, source, track, time, duration } = body;
    // Log standard fields as before
    if (event && track !== undefined) {
      console.log(`[DEBUG PLAYBACK] ${event} | track=${track} | time=${time} | duration=${duration} | source=${source}`);
    } else {
      // Log custom event payloads (onEnded_state, onEnded_after, etc.)
      console.log(`[DEBUG PLAYBACK] ${JSON.stringify(body)}`);
    }
    res.json({ ok: true });
  }
);

module.exports = router;