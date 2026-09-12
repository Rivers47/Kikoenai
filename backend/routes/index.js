const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  res.send('OK');
});

router.use('/auth', require('./auth'));
router.use('/credentials', require('./credentials'));
router.use('/version', require('./version'));
router.use('/config', require('./config'));
router.use('/media', require('./media'));
router.use('/review', require('./review'));
router.use('/history', require('./play_history'));
router.use('/track-progress', require('./track_progress'));
// Other routes
router.use('/', require('./metadata'));

module.exports = router;