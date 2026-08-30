const express = require('express');
const { config } = require('../config');
const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.send('OK');
});

// Eliminate error message from old PWA
// Will be deleted in the future
router.get('/me', (req, res) => {
  res.redirect(`${config.basePath}/api/auth/me`);
});

router.use('/auth', require('./auth'));
router.use('/credentials', require('./credentials'));
router.use('/version', require('./version'));
router.use('/config', require('./config'));
router.use('/media', require('./media'));
router.use('/review', require('./review'));
router.use('/history', require('./play_history'));
router.use('/track-progress', require('./track_progress'));
router.use('/backfill', require('./backfill'));
// Other routes
router.use('/', require('./metadata'));
router.use('/debug', require('./debug'));

module.exports = router;