const express = require('express');
const router = express.Router();

const { config } = require('../config');
const { runBackfill } = require('../scripts/backfill-progress');

// POST /api/backfill/progress  { dryRun?: boolean }
// Admin-only: rewrites t_review (listened) and seeds t_track_progress from
// existing play history. Returns the per-run log lines and summary counters.
router.post('/progress', async (req, res, next) => {
  // Same admin gate as /api/config/admin
  if (config.auth && req.user.name !== 'admin') {
    return res.status(403).send({ error: '只有 admin 账号能执行回填操作.' });
  }
  const dryRun = !!req.body?.dryRun;
  const logs = [];
  try {
    const summary = await runBackfill({ dryRun, log: (m) => logs.push(m) });
    res.send({ logs, summary });
  } catch (err) {
    console.error('[backfill] route error:', err);
    res.status(500).send({ error: '回填执行失败', logs });
  }
});

module.exports = router;
