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

module.exports = {
  knex,
  databaseExist,
  ...queries,
};
