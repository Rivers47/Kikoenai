const express = require('express');
const router = express.Router();
const { updateLock } = require('../upgrade');
const pjson = require('../package.json');

const lockReason = '新版解决了旧版扫描时将かの仔和こっこ识别为同一个人的问题，建议进行扫描以自动修复这一问题';

router.get('/', (req, res) => {
  res.send({
    current: pjson.version,
    lockFileExists: updateLock.isLockFilePresent,
    lockReason: updateLock.isLockFilePresent ? lockReason : null
  });
});

module.exports = router;
