const fs = require('fs');
const { md5 } = require('../auth/utils');
const knexMigrate = require('./knex-migrate');
const { databaseExist, createUser, knex } = require('./db');
const pjson = require('../package.json');
const compareVersions = require('compare-versions');
const { config, updateConfig } = require('../config');
const { applyFix } = require('../upgrade');
const { createSchema } = require('./schema');


/**
 * Create or recreate the staticMetadata view using the open-source definition
 * (without the closed-source lyric_status / original_work_id columns).
 */
async function createStaticMetadataView() {
  await knex.raw('DROP VIEW IF EXISTS staticMetadata');
  await knex.raw(`
    CREATE VIEW IF NOT EXISTS staticMetadata AS
    SELECT baseQueryWithVA.*,
      json_object('tags', json_group_array(json_object('id', t_tag.id, 'name', t_tag.name))) AS tagObj
    FROM (
      SELECT baseQuery.*,
        json_object('vas', json_group_array(json_object('id', t_va.id, 'name', t_va.name))) AS vaObj
      FROM (
        SELECT t_work.id, 
          t_work.created_at,
          t_work.updated_at,
          t_work.title,
          t_work.circle_id,
          t_circle.name,
          json_object('id', t_work.circle_id, 'name', t_circle.name) AS circleObj,
          t_work.nsfw,
          t_work.release,
          t_work.dl_count,
          t_work.price,
          t_work.review_count,
          t_work.rate_count,
          t_work.rate_average_2dp,
          t_work.rate_count_detail,
          t_work.rank
        FROM t_work
        JOIN t_circle ON t_circle.id = t_work.circle_id
      ) AS baseQuery
      JOIN r_va_work ON r_va_work.work_id = baseQuery.id
      JOIN t_va ON t_va.id = r_va_work.va_id
      GROUP BY baseQuery.id
    ) AS baseQueryWithVA
    LEFT JOIN r_tag_work ON r_tag_work.work_id = baseQueryWithVA.id
    LEFT JOIN t_tag ON t_tag.id = r_tag_work.tag_id
    GROUP BY baseQueryWithVA.id;
  `);
}

const initApp = async () => {
  let configVersion = config.version;
  let currentVersion = pjson.version;

  
  async function runMigrations () {
    const log = ({ action, migration }) => console.log('Doing ' + action + ' on ' + migration);
    await knexMigrate('up', {}, log);
  }

  async function skipMigrations () {
    await knexMigrate('skipAll', {});
  }

  // Fix a nasty bug introduced in v0.5.1
  async function fixMigrations () {
    if (compareVersions.compare(configVersion, 'v0.5.1', '>=') && compareVersions.compare(configVersion, 'v0.5.3', '<')) {
      await knexMigrate('skipAll', {to: '20210108093032'});
    }
  }

  function initDatabaseDir () {
    const databaseFolderDir = config.databaseFolderDir;
    if (!fs.existsSync(databaseFolderDir)) {
      try {
        fs.mkdirSync(databaseFolderDir, { recursive: true });
      } catch(err) {
        console.error(` ! 在创建存放数据库文件的文件夹时出错: ${err.message}`);
      }
    }
  }

  // 迁移或创建数据库结构
  if (databaseExist && compareVersions.compare(currentVersion, configVersion, '>')) {
    console.log('升级中');
    const oldVersion = config.version;
    try {
      await applyFix(oldVersion);
      await fixMigrations();
      await runMigrations();
      updateConfig();
    } catch (error) {
      console.log('升级迁移过程中出错，请在GitHub issues中报告作者');
      console.error(error);
    }
  } else if (!databaseExist) {
    initDatabaseDir();
    await createSchema();
    try { // 创建内置的管理员账号
      await createUser({
        name: 'admin',
        password: md5('admin'),
        group: 'administrator'
      });
    } catch(err) {{
        console.error(err.message);
        process.exit(1);
      }
    }
    try {
      await skipMigrations();
    } catch (err) {
      console.error(` ! 在构建数据库结构过程中出错: ${err.message}`);
      process.exit(1);
    }
    if (compareVersions.compare(currentVersion, configVersion, '>')) {
      // Update config only. Do not apply fix to database.
      updateConfig();
    }
  }

  // Always ensure the staticMetadata view exists (handles closed-source db leftovers)
  if (databaseExist) {
    await createStaticMetadataView();
  }
};

module.exports = { initApp };
