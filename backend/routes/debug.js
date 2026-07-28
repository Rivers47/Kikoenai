const express = require('express');
const router = express.Router();

// Debug endpoint for mobile background playback testing
// Logs debug events from the frontend to the server console
router.post('/playback',
  (req, res, next) => {
    const { event, source, track, time, duration } = req.body;
    console.log(`[DEBUG PLAYBACK] ${event} | track=${track} | time=${time} | duration=${duration} | source=${source}`);
    res.json({ ok: true });
  }
);

module.exports = router;