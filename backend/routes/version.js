const express = require('express');
const router = express.Router();
const { updateLock } = require('../upgrade');
const pjson = require('../package.json');

const lockReason = '新版解决了旧版扫描时将かの仔和こっこ识别为同一个人的问题，建议进行扫描以自动修复这一问题';

// Local server info only -- no external calls, so this stays instant.
//
// This route used to ask the GitHub releases API whether a newer version existed,
// inline on every request. That was removed rather than repaired, because every
// part of it was wrong:
//   - it compared against umonaca/kikoeru-express, the upstream project, not this
//     fork, so `update_available` was answering a question nobody asked;
//   - its throttle never worked (`lastGitHubCheck` was assigned only when null, so
//     it was set once and never updated), leaving it to call GitHub on nearly
//     every page load against a 60/hour unauthenticated limit;
//   - the `checkUpdate` config flag only labelled the response, it never gated the
//     request, so turning the setting off changed nothing;
//   - and it did all of it on the request path, measured at ~580ms with the
//     browser waiting.
// The frontend only ever read the lock-file fields below.
router.get('/', (req, res) => {
  res.send({
    current: pjson.version,
    lockFileExists: updateLock.isLockFilePresent,
    lockReason: updateLock.isLockFilePresent ? lockReason : null
  });
});

module.exports = router;
