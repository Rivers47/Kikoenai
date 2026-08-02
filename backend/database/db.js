const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const { makeQueries } = require('./queries');

const databaseExist = fs.existsSync(path.join(config.databaseFolderDir, 'db.sqlite3'));

// knex 操作数据库
const connEnv = process.env.KNEX_ENV || process.env.NODE_ENV || 'development';
const conn = require('./knexfile')[connEnv];
const knex = require('knex')(conn);

const queries = makeQueries(knex);

/**
 * @param {Number} nsfw 0所有年龄分级，1仅全年龄，2仅十八禁
 */
function nsfwFilter(nsfw, knexQuery) {
  switch(nsfw) {
    case 1: return knexQuery.where('nsfw', '=', false); // 全年龄
    case 2: return knexQuery.where('nsfw', '=', true); // 仅R18
    default: return knexQuery; // 无年龄限制
  }
}

module.exports = {
  knex,
  databaseExist,
  nsfwFilter,
  ...queries,
};
