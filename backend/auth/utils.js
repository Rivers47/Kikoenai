const md5 = require('md5');

const { config } = require('../config');

const cmd5 = (str) => md5(str + config.md5secret);

module.exports = {
  md5: cmd5,
};
