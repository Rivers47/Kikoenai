const { knex } = require('./db');

const dbVersion = '20260814000000';

// 数据库结构
const createSchema = () => knex.schema
  .createTable('t_circle', (table) => {
    table.string('id').notNullable(); // UUID v5, based on name
    table.string('name').notNullable(); // VARCHAR 类型 [社团名称]
    table.primary('id');
  })
  .createTable('t_work', (table) => {
    table.string('id').notNullable(); // TEXT PK: DLsite id (RJ-padded), Fanza id (d_XXXXXX)
    table.timestamps(true, true); // 时间戳created_at, updated_at
    table.string('root_folder').notNullable(); // VARCHAR 类型 [根文件夹别名]
    table.string('dir').notNullable(); // VARCHAR 类型 [相对存储路径]
    table.string('title').notNullable(); // VARCHAR 类型 [音声名称]
    table.string('circle_id').notNullable(); // UUID 类型 [社团id]
    table.boolean('nsfw'); // BOOLEAN 类型
    table.string('release');  // VARCHAR 类型 [贩卖日 (YYYY-MM-DD)]

    table.integer('dl_count'); // INTEGER 类型 [售出数]
    table.integer('price'); // INTEGER 类型 [价格]
    table.integer('review_count'); // INTEGER 类型 [评论数量]
    table.integer('rate_count'); // INTEGER 类型 [评价数量]
    table.float('rate_average_2dp'); // FLOAT 类型 [平均评价]
    table.text('rate_count_detail'); // TEXT 类型 [评价分布明细]
    table.text('rank'); // TEXT 类型 [历史销售业绩]

    table.json('memo'); // 关于这个作品的各种信息记录,音频文件,音频文件时长,歌词映射
    
    table.primary('id');
    table.foreign('circle_id').references('id').inTable('t_circle'); // FOREIGN KEY 外键
    table.index(['circle_id', 'release', 'dl_count', 'review_count', 'price', 'rate_average_2dp'], 't_work_index'); // INDEX 索引
  })
  .createTable('t_tag', (table) => {
    table.string('id').notNullable(); // UUID v5, based on name
    table.string('name').notNullable(); // VARCHAR 类型 [标签名称]
    table.primary('id');
  })
  .createTable('t_va', (table) => {
    table.string('id'); // UUID v5, 基于name生成的固定值
    table.string('name').notNullable(); // VARCHAR 类型 [声优名称]
    table.primary('id');
  })
  .createTable('r_tag_work', (table) => {
    table.string('tag_id');
    table.string('work_id');
    table.foreign('tag_id').references('id').inTable('t_tag'); // FOREIGN KEY 外键
    table.foreign('work_id').references('id').inTable('t_work'); // FOREIGN KEY 外键
    table.primary(['tag_id', 'work_id']); // PRIMARY KEYprimary 主键
  })
  .createTable('r_va_work', (table) => {
    table.string('va_id');
    table.string('work_id');
    table.foreign('va_id').references('id').inTable('t_va').onUpdate('CASCADE').onDelete('CASCADE'); // FOREIGN KEY 外键
    table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE'); // FOREIGN KEY 外键
    table.primary(['va_id', 'work_id']); // PRIMARY KEYprimary 主键
  })
  .createTable('t_illustrator', (table) => {
    table.string('id'); // UUID v5, 基于name生成的固定值
    table.string('name').notNullable(); // VARCHAR 类型 [イラスト名称]
    table.primary('id');
  })
  .createTable('r_illustrator_work', (table) => {
    table.string('illustrator_id');
    table.string('work_id');
    table.foreign('illustrator_id').references('id').inTable('t_illustrator').onUpdate('CASCADE').onDelete('CASCADE');
    table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
    table.primary(['illustrator_id', 'work_id']);
  })
  .createTable('t_script_writer', (table) => {
    table.string('id'); // UUID v5, 基于name生成的固定值
    table.string('name').notNullable(); // VARCHAR 类型 [シナリオ名称]
    table.primary('id');
  })
  .createTable('r_script_writer_work', (table) => {
    table.string('script_writer_id');
    table.string('work_id');
    table.foreign('script_writer_id').references('id').inTable('t_script_writer').onUpdate('CASCADE').onDelete('CASCADE');
    table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
    table.primary(['script_writer_id', 'work_id']);
  })
  .createTable('t_series', (table) => {
    table.string('id').notNullable(); // UUID v5, based on name
    table.string('name').notNullable(); // VARCHAR 类型 [シリーズ名称]
    table.primary('id');
  })
  .createTable('r_series_work', (table) => {
    table.string('series_id');
    table.string('work_id');
    table.foreign('series_id').references('id').inTable('t_series').onUpdate('CASCADE').onDelete('CASCADE');
    table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
    table.primary(['series_id', 'work_id']);
  })
  .createTable('t_user', (table) => {
    table.string('name').notNullable();
    table.string('password').notNullable();
    table.string('group').notNullable(); // USER ADMIN guest
    table.primary(['name']); // PRIMARY KEYprimary 主键
  })
  .createTable('t_review', (table) => {
    table.string('user_name').notNullable();
    table.string('work_id').notNullable();
    table.integer('rating'); // 用户评分1-5
    table.string('review_text'); // 用户评价文字
    table.timestamps(true, true); // 时间戳created_at, updated_at
    table.string('progress'); // ['marked', 'listening', 'listened', 'replay'，'postponed', null]
    table.foreign('user_name').references('name').inTable('t_user').onDelete('CASCADE'); // FOREIGN KEY 
    table.foreign('work_id').references('id').inTable('t_work').onDelete('CASCADE'); // FOREIGN KEY 
    table.primary(['user_name', 'work_id']); // PRIMARY KEY
  })
  .createTable('t_play_history', (table) => {
    table.string('user_name').notNullable();
    table.string('work_id').notNullable();
    table.timestamps(true, true); // 时间戳created_at, updated_at
    table.string('state').notNullable(); // 播放状态，一个json字符串，从前端村粗的状态，记录了当前播放的队列文件、播放序号、播放时间等

    table.foreign('user_name').references('name').inTable('t_user').onDelete('CASCADE'); // FOREIGN KEY 
    table.foreign('work_id').references('id').inTable('t_work').onDelete('CASCADE'); // FOREIGN KEY 外键

    table.primary(['user_name', 'work_id']); // PRIMARY KEY
  })
  .createTable('t_track_progress', (table) => {
    table.string('user_name').notNullable();
    table.string('work_id').notNullable();
    table.string('track_key').notNullable(); // SHA-256 hex
    table.float('seconds').notNullable().defaultTo(0);
    table.boolean('completed').notNullable().defaultTo(false);
    table.timestamps(true, true);

    table.foreign('user_name').references('name').inTable('t_user').onDelete('CASCADE');
    table.foreign('work_id').references('id').inTable('t_work').onDelete('CASCADE');
    table.primary(['user_name', 'work_id', 'track_key']);
  })
  .createTable('t_session', (table) => {
    table.string('id').notNullable(); // sha256 of the session secret, never the secret itself
    table.string('user_name').notNullable();
    // Epoch milliseconds, not a datetime column: knex's sqlite3 dialect does not
    // serialize Date objects consistently, so an integer keeps `where expires_at > ?`
    // unambiguous.
    table.bigInteger('expires_at').notNullable();
    table.timestamps(true, true);

    table.foreign('user_name').references('name').inTable('t_user').onDelete('CASCADE');
    table.primary(['id']);
    table.index('expires_at');
  })
  .then(() => {
    console.log(' * 成功构建数据库结构.');
  })
  .catch((err) => {
    if (err.toString().indexOf('table `t_circle` already exists') !== -1) {
      console.log(' * 数据库结构已经存在.');
    } else {
      throw err;
    }
  });

module.exports = { createSchema, dbVersion };
