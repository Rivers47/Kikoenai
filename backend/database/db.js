const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { config } = require('../config');
const { nameToUUID } = require('../scraper/utils');

const databaseExist = fs.existsSync(path.join(config.databaseFolderDir, 'db.sqlite3'));

// knex 操作数据库
const connEnv = process.env.KNEX_ENV || process.env.NODE_ENV || 'development';
const conn = require('./knexfile')[connEnv];
const knex = require('knex')(conn);

/**
 * Takes a work metadata object and inserts it into the database.
 * @param {Object} work Work object.
 */
// Using trx as a query builder:
const insertWorkMetadata = work => knex.transaction(trx => trx.raw(
  trx('t_circle')
    .insert({
      id: work.circle.id,
      name: work.circle.name,
    }).toString().replace('insert', 'insert or ignore'),
)
  .then(() => trx('t_work')
    .insert({
      id: work.id,
      root_folder: work.rootFolderName,
      dir: work.dir,
      title: work.title,
      circle_id: work.circle.id,
      nsfw: work.nsfw,
      release: work.release,

      dl_count: work.dl_count,
      price: work.price,
      review_count: work.review_count,
      rate_count: work.rate_count,
      rate_average_2dp: work.rate_average_2dp,
      rate_count_detail: JSON.stringify(work.rate_count_detail),
      rank: work.rank ? JSON.stringify(work.rank) : null,
    }))
  .then(() => {
    // Now that work is in the database, insert relationships
    const promises = [];

    for (let i = 0; i < work.tags.length; i += 1) {
      promises.push(trx.raw(
        trx('t_tag')
          .insert({
            id: work.tags[i].id,
            name: work.tags[i].name,
          }).toString().replace('insert', 'insert or ignore'),
      )
        .then(() => trx('r_tag_work')
          .insert({
            tag_id: work.tags[i].id,
            work_id: work.id,
          })));
    }

    for (let i = 0; i < work.vas.length; i += 1) {
      promises.push(trx.raw(
        trx('t_va')
          .insert({
            id: work.vas[i].id,
            name: work.vas[i].name,
          }).toString().replace('insert', 'insert or ignore'),
      )
        .then(() => trx.raw(
          trx('r_va_work')
            .insert({
              va_id: work.vas[i].id,
              work_id: work.id,
            }).toString().replace('insert', 'insert or ignore'))));
    }

    // イラスト
    if (work.illustrators) {
      for (let i = 0; i < work.illustrators.length; i += 1) {
        promises.push(trx.raw(
          trx('t_illustrator')
            .insert({
              id: work.illustrators[i].id,
              name: work.illustrators[i].name,
            }).toString().replace('insert', 'insert or ignore'),
        )
          .then(() => trx.raw(
            trx('r_illustrator_work')
              .insert({
                illustrator_id: work.illustrators[i].id,
                work_id: work.id,
              }).toString().replace('insert', 'insert or ignore'))));
      }
    }

    // シナリオ
    if (work.scriptWriters) {
      for (let i = 0; i < work.scriptWriters.length; i += 1) {
        promises.push(trx.raw(
          trx('t_script_writer')
            .insert({
              id: work.scriptWriters[i].id,
              name: work.scriptWriters[i].name,
            }).toString().replace('insert', 'insert or ignore'),
        )
          .then(() => trx.raw(
            trx('r_script_writer_work')
              .insert({
                script_writer_id: work.scriptWriters[i].id,
                work_id: work.id,
              }).toString().replace('insert', 'insert or ignore'))));
      }
    }

    // シリーズ
    if (work.series && work.series.id) {
      promises.push(trx.raw(
        trx('t_series')
          .insert({
            id: work.series.id,
            name: work.series.name,
          }).toString().replace('insert', 'insert or ignore'),
      )
        .then(() => trx.raw(
          trx('r_series_work')
            .insert({
              series_id: work.series.id,
              work_id: work.id,
            }).toString().replace('insert', 'insert or ignore'))));
    }

    return Promise.all(promises)
      .then(() => trx);
  }));

/**
 * 更新音声的动态元数据
 * @param {Object} work Work object.
 */
const updateWorkMetadata = (work, options = {}) => knex.transaction(async (trx) => {
  await trx('t_work')
    .where('id', '=', work.id)
    .update({
      dl_count: work.dl_count,
      price: work.price,
      review_count: work.review_count,
      rate_count: work.rate_count,
      rate_average_2dp: work.rate_average_2dp,
      rate_count_detail: JSON.stringify(work.rate_count_detail),
      rank: work.rank ? JSON.stringify(work.rank) : null,
    });

  // VA: delete only when includeVA flag explicitly set; insert always if includeVA or refreshAll
  if (options.includeVA) {
    await trx('r_va_work').where('work_id', work.id).del();
  }
  if (options.includeVA || options.refreshAll) {
    for (const va of work.vas) {
      await trx.raw('INSERT OR IGNORE INTO t_va(id, name) VALUES (?, ?)', [va.id, va.name]);
      await trx.raw('INSERT OR IGNORE INTO r_va_work(va_id, work_id) VALUES (?, ?)', [va.id, work.id]);
    }
  }
  // Illustrator: delete only when includeIllustrator flag explicitly set; insert always if includeIllustrator or refreshAll
  if (options.includeIllustrator) {
    await trx('r_illustrator_work').where('work_id', work.id).del();
  }
  if (options.includeIllustrator || options.refreshAll) {
    if (work.illustrators) {
      for (const illustrator of work.illustrators) {
        await trx.raw('INSERT OR IGNORE INTO t_illustrator(id, name) VALUES (?, ?)', [illustrator.id, illustrator.name]);
        await trx.raw('INSERT OR IGNORE INTO r_illustrator_work(illustrator_id, work_id) VALUES (?, ?)', [illustrator.id, work.id]);
      }
    }
  }
  // ScriptWriter: delete only when includeScriptWriter flag explicitly set; insert always if includeScriptWriter or refreshAll
  if (options.includeScriptWriter) {
    await trx('r_script_writer_work').where('work_id', work.id).del();
  }
  if (options.includeScriptWriter || options.refreshAll) {
    if (work.scriptWriters) {
      for (const sw of work.scriptWriters) {
        await trx.raw('INSERT OR IGNORE INTO t_script_writer(id, name) VALUES (?, ?)', [sw.id, sw.name]);
        await trx.raw('INSERT OR IGNORE INTO r_script_writer_work(script_writer_id, work_id) VALUES (?, ?)', [sw.id, work.id]);
      }
    }
  }
  // Series: delete only when includeSeries flag explicitly set; insert always if includeSeries or refreshAll
  if (options.includeSeries) {
    await trx('r_series_work').where('work_id', work.id).del();
  }
  if (options.includeSeries || options.refreshAll) {
    if (work.series && work.series.id) {
      await trx.raw('INSERT OR IGNORE INTO t_series(id, name) VALUES (?, ?)', [work.series.id, work.series.name]);
      await trx.raw('INSERT OR IGNORE INTO r_series_work(series_id, work_id) VALUES (?, ?)', [work.series.id, work.id]);
    }
  }
  if (options.includeTags || options.refreshAll) {
    if (options.purgeTags) {
      await trx('r_tag_work').where('work_id', work.id).del();
    }
    for (const tag of work.tags) {
      await trx.raw('INSERT OR IGNORE INTO t_tag(id, name) VALUES (?, ?)', [tag.id, tag.name]);
      await trx.raw('INSERT OR IGNORE INTO r_tag_work(tag_id, work_id) VALUES (?, ?)', [tag.id, work.id]);
    }
  }

  // Fix a bug caused by DLsite changes
  if (options.includeNSFW) {
    await trx('t_work')
    .where('id', '=', work.id)
    .update({
      nsfw: work.nsfw
    });
  }

  if (options.refreshAll) {
    // Gap-fill: only update title/nsfw/release if the current value is empty/null
    const cur = await trx('t_work').select('title', 'nsfw', 'release').where('id', work.id).first();
    const patch = {};
    if (!cur.title && work.title) patch.title = work.title;
    if (cur.nsfw == null && work.nsfw != null) patch.nsfw = work.nsfw;
    if (!cur.release && work.release) patch.release = work.release;
    if (Object.keys(patch).length) {
      await trx('t_work').where('id', work.id).update(patch);
    }
  }
});

/**
 * Hash a string to a 32-bit signed integer using MD5.
 * @param {String} name
 * @returns {Number}
 */
const hash32 = (name) => {
  const buf = crypto.createHash('md5').update(name).digest();
  return buf.readInt32BE(0);
};

/**
 * Resolve or create a circle by name. Returns the id.
 * @param {import('knex').Knex.Transaction} trx
 * @param {String} name
 * @returns {Promise<Number>}
 */
const resolveCircle = async (trx, name) => {
  let row = await trx('t_circle').select('id').where('name', name).first();
  if (!row) {
    const [id] = await trx('t_circle').insert({ name });
    return id;
  }
  return row.id;
};

/**
 * Resolve or create a tag by name. Returns the id.
 * @param {import('knex').Knex.Transaction} trx
 * @param {String} name
 * @returns {Promise<Number>}
 */
const resolveTag = async (trx, name) => {
  let row = await trx('t_tag').select('id').where('name', name).first();
  if (!row) {
    const [id] = await trx('t_tag').insert({ name });
    return id;
  }
  return row.id;
};

/**
 * Resolve or create a VA/illustrator/script_writer by name (UUID-based id).
 * @param {import('knex').Knex.Transaction} trx
 * @param {String} tableName 't_va' | 't_illustrator' | 't_script_writer'
 * @param {String} name
 * @returns {Promise<String>} UUID id
 */
const resolveUUIDLabel = async (trx, tableName, name) => {
  const id = nameToUUID(name);
  await trx.raw('INSERT OR IGNORE INTO ??(id, name) VALUES (?, ?)', [tableName, id, name]);
  return id;
};

/**
 * Resolve or create a series by name. Generates a negative id for new series.
 * @param {import('knex').Knex.Transaction} trx
 * @param {String} name
 * @returns {Promise<Number>}
 */
const resolveSeries = async (trx, name) => {
  let row = await trx('t_series').select('id').where('name', name).first();
  if (!row) {
    let id = -(hash32(name) & 0x7FFFFFFF);
    // On collision with an existing id whose name differs, decrement until free
    while (true) {
      const existing = await trx('t_series').select('name').where('id', id).first();
      if (!existing) break;
      if (existing.name === name) return id; // should not happen but handle gracefully
      id -= 1;
    }
    await trx('t_series').insert({ id, name });
    return id;
  }
  return row.id;
};

/**
 * Manually edit a work's descriptive metadata (full replace semantics).
 * Runs in one transaction. Updates t_work, resolves-or-creates labels,
 * replaces relational links, and cleans up orphaned labels.
 * @param {Number} workId
 * @param {Object} data
 * @param {String} data.title
 * @param {Boolean} data.nsfw
 * @param {String} data.release
 * @param {String} data.circle - circle name
 * @param {Array<{id?:Number, name:String}>} data.tags
 * @param {Array<{id?:String, name:String}>} data.vas
 * @param {Array<{id?:String, name:String}>} data.illustrators
 * @param {Array<{id?:String, name:String}>} data.scriptWriters
 * @param {Object|null} data.series - {id?:Number, name:String} or null
 * @returns {Promise<void>}
 */
const editWorkMetadata = async (workId, data) => knex.transaction(async (trx) => {
  // 1. Update t_work core fields
  const patch = {};
  if (data.title !== undefined) patch.title = data.title;
  if (data.nsfw !== undefined) patch.nsfw = data.nsfw;
  if (data.release !== undefined) patch.release = data.release;
  if (Object.keys(patch).length) {
    await trx('t_work').where('id', workId).update(patch);
  }

  // 2. Circle
  const prevWork = await trx('t_work').select('circle_id').where('id', workId).first();
  const prevCircleId = prevWork ? prevWork.circle_id : null;
  const newCircleId = await resolveCircle(trx, data.circle);
  await trx('t_work').where('id', workId).update({ circle_id: newCircleId });

  // 3. Tags
  const prevTagRows = await trx('r_tag_work').select('tag_id').where('work_id', workId);
  const prevTagIds = prevTagRows.map(r => r.tag_id);
  await trx('r_tag_work').where('work_id', workId).del();
  const newTagIds = [];
  for (const tag of data.tags) {
    const id = await resolveTag(trx, tag.name);
    newTagIds.push(id);
    await trx.raw('INSERT OR IGNORE INTO r_tag_work(tag_id, work_id) VALUES (?, ?)', [id, workId]);
  }
  const removedTagIds = prevTagIds.filter(id => !newTagIds.includes(id));

  // 4. VAs
  const prevVaRows = await trx('r_va_work').select('va_id').where('work_id', workId);
  const prevVaIds = prevVaRows.map(r => r.va_id);
  await trx('r_va_work').where('work_id', workId).del();
  const newVaIds = [];
  for (const va of data.vas) {
    const id = await resolveUUIDLabel(trx, 't_va', va.name);
    newVaIds.push(id);
    await trx.raw('INSERT OR IGNORE INTO r_va_work(va_id, work_id) VALUES (?, ?)', [id, workId]);
  }
  const removedVaIds = prevVaIds.filter(id => !newVaIds.includes(id));

  // 5. Illustrators
  const prevIllustratorRows = await trx('r_illustrator_work').select('illustrator_id').where('work_id', workId);
  const prevIllustratorIds = prevIllustratorRows.map(r => r.illustrator_id);
  await trx('r_illustrator_work').where('work_id', workId).del();
  const newIllustratorIds = [];
  for (const illus of data.illustrators) {
    const id = await resolveUUIDLabel(trx, 't_illustrator', illus.name);
    newIllustratorIds.push(id);
    await trx.raw('INSERT OR IGNORE INTO r_illustrator_work(illustrator_id, work_id) VALUES (?, ?)', [id, workId]);
  }
  const removedIllustratorIds = prevIllustratorIds.filter(id => !newIllustratorIds.includes(id));

  // 6. Script writers
  const prevSwRows = await trx('r_script_writer_work').select('script_writer_id').where('work_id', workId);
  const prevSwIds = prevSwRows.map(r => r.script_writer_id);
  await trx('r_script_writer_work').where('work_id', workId).del();
  const newSwIds = [];
  for (const sw of data.scriptWriters) {
    const id = await resolveUUIDLabel(trx, 't_script_writer', sw.name);
    newSwIds.push(id);
    await trx.raw('INSERT OR IGNORE INTO r_script_writer_work(script_writer_id, work_id) VALUES (?, ?)', [id, workId]);
  }
  const removedSwIds = prevSwIds.filter(id => !newSwIds.includes(id));

  // 7. Series
  const prevSeriesRows = await trx('r_series_work').select('series_id').where('work_id', workId);
  const prevSeriesIds = prevSeriesRows.map(r => r.series_id);
  await trx('r_series_work').where('work_id', workId).del();
  let removedSeriesIds = prevSeriesIds;
  if (data.series && data.series.name) {
    const id = await resolveSeries(trx, data.series.name);
    await trx.raw('INSERT OR IGNORE INTO r_series_work(series_id, work_id) VALUES (?, ?)', [id, workId]);
    removedSeriesIds = prevSeriesIds.filter(sid => sid !== id);
  }

  // 8. Cleanup orphans
  const trxProvider = () => Promise.resolve(trx);
  await cleanupOrphans(
    trxProvider,
    prevCircleId,
    removedTagIds,
    removedVaIds,
    removedIllustratorIds,
    removedSwIds,
    removedSeriesIds,
  );
});


/**
 * Fetches metadata for a specific work id.
 * @param {Number} id Work identifier.
 * @param {String} username 'admin' or other usernames for current user
 */
const getWorkMetadata = async (id, username) => {
  // TODO: do this all in a single transaction?
  // <= Yes, WTF is this
  // I think we are done.

    const ratingSubQuery = knex('t_review')
    .select(['t_review.work_id', 't_review.rating AS userRating', 't_review.review_text', 't_review.progress', knex.raw('strftime(\'%Y-%m-%d %H-%M-%S\', t_review.updated_at, \'localtime\') AS updated_at'), 't_review.user_name'])
    .join('t_work', 't_work.id', 't_review.work_id')
    .where('t_review.user_name', username).as('userrate');

    const histroyQuery = knex('t_play_histroy')
      .select([
        't_play_histroy.work_id',
        't_play_histroy.state AS state',
        't_play_histroy.updated_at AS play_updated_at'
      ])
      .join('t_work', 't_work.id', 't_play_histroy.work_id')
      .where('t_play_histroy.user_name', "=", username).as('histroy');

    let query = () => knex('staticMetadata')
      .select(['staticMetadata.*', 'userrate.userRating', 'userrate.review_text', 'userrate.progress', 'userrate.updated_at', 'userrate.user_name', 'histroy.state', 'histroy.play_updated_at'])
      .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
      .leftJoin(histroyQuery, 'histroy.work_id', 'staticMetadata.id')
      .where('id', '=', id);

    const work = await query();
    if (work.length === 0) throw new Error(`There is no work with id ${id} in the database.`);
    return work;
};

/**
 * Tests if the given circle, tags, VAs, illustrators, script writers and series are orphans and if so, removes them.
 * @param {*} trx Knex transaction object.
 * @param {*} circle Circle id to check.
 * @param {*} tags Array of tag ids to check.
 * @param {*} vas Array of VA ids to check.
 * @param {*} illustrators Array of illustrator ids to check.
 * @param {*} scriptWriters Array of script writer ids to check.
 * @param {*} series Array of series ids to check.
 */
const cleanupOrphans = async (trxProvider, circle, tags, vas, illustrators = [], scriptWriters = [], series = [])  => {
  const trx = await trxProvider();
  const getCount = (tableName, colName, colValue) => new Promise((resolveCount, rejectCount) => {
    trx(tableName)
      .select(colName)
      .where(colName, '=', colValue)
      .count()
      .first()
      .then(res => res['count(*)'])
      .then(count => resolveCount(count))
      .catch(err => rejectCount(err));
  });

  const promises = [];
  promises.push(new Promise((resolveCircle, rejectCircle) => {
    getCount('t_work', 'circle_id', circle)
      .then((count) => {
        if (count === 0) {
          trx('t_circle')
            .del()
            .where('id', '=', circle)
            .then(() => resolveCircle())
            .catch(err => rejectCircle(err));
        } else {
          resolveCircle();
        }
      });
  }));

  for (let i = 0; i < tags.length; i += 1) {
    const tag = tags[i];
    const count = await getCount('r_tag_work', 'tag_id', tag);

    if (count === 0) {
      promises.push(
        trx('t_tag')
          .delete()
          .where('id', '=', tag),
      );
    }
  }

  for (let i = 0; i < vas.length; i += 1) {
    const va = vas[i];
    const count = await getCount('r_va_work', 'va_id', va);

    if (count === 0) {
      promises.push(
        trx('t_va')
          .delete()
          .where('id', '=', va),
      );
    }
  }

  for (let i = 0; i < illustrators.length; i += 1) {
    const illustrator = illustrators[i];
    const count = await getCount('r_illustrator_work', 'illustrator_id', illustrator);

    if (count === 0) {
      promises.push(
        trx('t_illustrator')
          .delete()
          .where('id', '=', illustrator),
      );
    }
  }

  for (let i = 0; i < scriptWriters.length; i += 1) {
    const sw = scriptWriters[i];
    const count = await getCount('r_script_writer_work', 'script_writer_id', sw);

    if (count === 0) {
      promises.push(
        trx('t_script_writer')
          .delete()
          .where('id', '=', sw),
      );
    }
  }

  for (let i = 0; i < series.length; i += 1) {
    const s = series[i];
    const count = await getCount('r_series_work', 'series_id', s);

    if (count === 0) {
      promises.push(
        trx('t_series')
          .delete()
          .where('id', '=', s),
      );
    }
  }

  await Promise.all(promises);
};

/**
 * Removes a work and then its orphaned circles, tags & VAs from the database.
 * @param {Integer} id Work id.
 */
const removeWork = async (id, trxProvider) => {
  const trx = await trxProvider();
  // Save circle, tags, VAs, illustrators, script writers and series to array for later testing
    const circle = await trx('t_work').select('circle_id').where('id', '=', id).first();
    const tags = await trx('r_tag_work').select('tag_id').where('work_id', '=', id);
    const vas = await trx('r_va_work').select('va_id').where('work_id', '=', id);
    const illustrators = await trx('r_illustrator_work').select('illustrator_id').where('work_id', '=', id);
    const scriptWriters = await trx('r_script_writer_work').select('script_writer_id').where('work_id', '=', id);
    const series = await trx('r_series_work').select('series_id').where('work_id', '=', id);

    await trx('t_play_histroy').del().where('work_id', '=', id);
    await trx('r_tag_work').del().where('work_id', '=', id);
    await trx('r_va_work').del().where('work_id', '=', id);
    await trx('r_illustrator_work').del().where('work_id', '=', id);
    await trx('r_script_writer_work').del().where('work_id', '=', id);
    await trx('r_series_work').del().where('work_id', '=', id);
    await trx('t_review').del().where('work_id', '=', id);
    await trx('t_work').del().where('id', '=', id);
    await cleanupOrphans(
      trxProvider,
      circle.circle_id,
      tags.map(tag => tag.tag_id),
      vas.map(va => va.va_id),
      illustrators.map(i => i.illustrator_id),
      scriptWriters.map(s => s.script_writer_id),
      series.map(s => s.series_id),
    );
};

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

/**
 * Returns list of works by circle, tag, VA, illustrator, script writer or series.
 * @param {Number} id Which id to filter by.
 * @param {String} field Which field to filter by.
 */
const getWorksBy = ({id, field, username = ''} = {}) => {
  let workIdQuery;
  const ratingSubQuery = knex('t_review')
    .select(['t_review.work_id', 't_review.rating'])
    .join('t_work', 't_work.id', 't_review.work_id')
    .where('t_review.user_name', username).as('userrate');

  switch (field) {
    case 'circle':
      return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
        .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
        .where('circle_id', '=', id);

    case 'tag':
      workIdQuery = knex('r_tag_work').select('work_id').where('tag_id', '=', id);
      return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
        .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
        .where('id', 'in', workIdQuery);

    case 'va':
      workIdQuery = knex('r_va_work').select('work_id').where('va_id', '=', id);
      return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
        .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
        .where('id', 'in', workIdQuery);

    case 'illustrator':
      workIdQuery = knex('r_illustrator_work').select('work_id').where('illustrator_id', '=', id);
      return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
        .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
        .where('id', 'in', workIdQuery);

    case 'script_writer':
      workIdQuery = knex('r_script_writer_work').select('work_id').where('script_writer_id', '=', id);
      return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
        .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
        .where('id', 'in', workIdQuery);

    case 'series':
      workIdQuery = knex('r_series_work').select('work_id').where('series_id', '=', id);
      return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
        .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
        .where('id', 'in', workIdQuery);

    default:
      return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
        .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id');
  }
};




/**
 * 根据关键字查询音声
 * @param {String} keyword
 */
const getWorksByKeyWord = ({keyword, username = 'admin'} = {}) => {
  const ratingSubQuery = knex('t_review')
  .select(['t_review.work_id', 't_review.rating'])
  .join('t_work', 't_work.id', 't_review.work_id')
  .where('t_review.user_name', username).as('userrate');

  const workid = keyword.match(/((R|r)(J|j))?(\d{6,8})/) ? keyword.match(/((R|r)(J|j))?(\d{6,8})/)[4] : '';
  if (workid) {
    return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
      .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
      .where('id', '=', workid);
  }

  const circleIdQuery = knex('t_circle').select('id').where('name', 'like', `%${keyword}%`);

  const tagIdQuery = knex('t_tag').select('id').where('name', 'like', `%${keyword}%`);
  const vaIdQuery = knex('t_va').select('id').where('name', 'like', `%${keyword}%`);
  const illustratorIdQuery = knex('t_illustrator').select('id').where('name', 'like', `%${keyword}%`);
  const scriptWriterIdQuery = knex('t_script_writer').select('id').where('name', 'like', `%${keyword}%`);
  const seriesIdQuery = knex('t_series').select('id').where('name', 'like', `%${keyword}%`);

  const workIdQuery = knex('r_tag_work').select('work_id').where('tag_id', 'in', tagIdQuery).union([
    knex('r_va_work').select('work_id').where('va_id', 'in', vaIdQuery),
    knex('r_illustrator_work').select('work_id').where('illustrator_id', 'in', illustratorIdQuery),
    knex('r_script_writer_work').select('work_id').where('script_writer_id', 'in', scriptWriterIdQuery),
    knex('r_series_work').select('work_id').where('series_id', 'in', seriesIdQuery),
  ]);


  return knex('staticMetadata').select(['staticMetadata.*', 'userrate.rating AS userRating'])
    .leftJoin(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
    .where('title', 'like', `%${keyword}%`)
    .orWhere('circle_id', 'in', circleIdQuery)
    .orWhere('id', 'in', workIdQuery);
};

/**
 * 获取所有社团/标签/声优的元数据列表
 * @param {Starting} field ['circle', 'tag', 'va'] 中的一个
 */
const getLabels = (field) => {
  if (field === 'circle') {
    return knex('t_work')
      .join(`t_${field}`, `${field}_id`, '=', `t_${field}.id`)
      .select(`t_${field}.id`, 'name')
      .groupBy(`${field}_id`)
      .count(`${field}_id as count`);
  } else if (['tag', 'va', 'illustrator', 'script_writer', 'series'].includes(field)) {
    const tableName = field === 'illustrator' || field === 'script_writer' || field === 'series' ? field : field;
    return knex(`r_${tableName}_work`)
      .join(`t_${tableName}`, `${tableName}_id`, '=', 'id')
      .select('id', 'name')
      .groupBy(`${tableName}_id`)
      .count(`${tableName}_id as count`);
  }
};

/**
 * 创建一个新用户
 * @param {Object} user User object.
 */
const createUser = user => knex.transaction(trx => trx('t_user')
  .where('name', '=', user.name)
  .first()
  .then((res) => {
    if (res) {
      throw new Error(`用户 ${user.name} 已存在.`);
    }
    return trx('t_user')
      .insert(user);
  }));

/**
 * 更新用户密码
 * @param {Object} user User object.
 * @param {String} newPassword new password
 */
const updateUserPassword = (user, newPassword) => knex.transaction(trx => trx('t_user')
  .where('name', '=', user.name)
  .first()
  .then((res) => {
    if (!res) {
      throw new Error('用户名或密码错误.');
    }
    return trx('t_user')
      .where('name', '=', user.name)
      .update({
        password: newPassword
      });
  }));

/**
 * 重置用户密码为 "password"
 * @param {Object} user User object.
 */
const resetUserPassword = (user) => knex.transaction(trx => trx('t_user')
  .where('name', '=', user.name)
  .first()
  .then((res) => {
    if (!res) {
      throw new Error('用户名错误.');
    }
    return trx('t_user')
      .where('name', '=', user.name)
      .update({
        password: 'password'
      });
  }));

/**
 * 删除用户
 * @param {Object} user User object.
 */
const deleteUser = users => knex.transaction(trx => trx('t_user')
  .where('name', 'in', users.map(user => user.name))
  .del());


// 添加星标或评语或进度
const updateUserReview = async (username, workid, rating, review_text = '', progress = '', starOnly = true, progressOnly= false) => knex.transaction(async(trx) => {
    //UPSERT
    if (starOnly) {
      await trx.raw('UPDATE t_review SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [rating, username, workid]);
      await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, rating) VALUES (?, ?, ?);', [username, workid, rating]);
    } else if (progressOnly) {
      await trx.raw('UPDATE t_review SET progress = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [progress, username, workid]);
      await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, progress) VALUES (?, ?, ?);', [username, workid, progress]);
    } else {
      await trx.raw('UPDATE t_review SET rating = ?, review_text = ?, progress = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [rating, review_text, progress, username, workid]);
      await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, rating, review_text, progress) VALUES (?, ?, ?, ?, ?);', [username, workid, rating, review_text, progress]);
    }
});

// 删除星标、评语及进度
const deleteUserReview = (username, workid) => knex.transaction(trx => trx('t_review')
  .where('user_name', '=', username)
  .andWhere('work_id', '=', workid)
  .del());

// 读取星标及评语 + 作品元数据
const getWorksWithReviews = async ({username = '', limit = 1000, offset = 0, orderBy = 'release', sortOption = 'desc', filter} = {}) => {
  let works = [];
  let totalCount = 0;

  const ratingSubQuery = knex('t_review')
  .select(['t_review.work_id', 't_review.rating AS userRating', 't_review.review_text', 't_review.progress', knex.raw('strftime(\'%Y-%m-%d %H-%M-%S\', t_review.updated_at, \'localtime\') AS updated_at'), 't_review.user_name'])
  .join('t_work', 't_work.id', 't_review.work_id')
  .where('t_review.user_name', username).as('userrate');

  let query = () => knex('staticMetadata')
    .select(['staticMetadata.*', 'userrate.userRating', 'userrate.review_text', 'userrate.progress', 'userrate.updated_at', 'userrate.user_name'])
    .join(ratingSubQuery, 'userrate.work_id', 'staticMetadata.id')
    .orderBy(orderBy, sortOption).orderBy([{ column: 'release', order: 'desc'}, { column: 'id', order: 'desc' }]);

  if (filter) {
    totalCount = await query().where('progress', '=', filter).count('id as count');
    works = await query().where('progress', '=', filter).limit(limit).offset(offset);
  } else {
    totalCount = await query().count('id as count');
    works = await query().limit(limit).offset(offset);
  }

  return {works, totalCount};
};

const getPlayHistroy = async ({username = '', sortOption = 'desc', limit = 1000, offset = 0}) => {
  let works = [];
  let totalCount = 0;
  const histroyQuery = knex('t_play_histroy')
    .select([
      't_play_histroy.work_id',
      't_play_histroy.state AS state',
      't_play_histroy.updated_at AS play_updated_at'
    ])
    .join('t_work', 't_work.id', 't_play_histroy.work_id')
    .where('t_play_histroy.user_name', "=", username).as('histroy');

  const query = () => knex('staticMetadata')
    .select(['staticMetadata.*', 'histroy.state', 'histroy.play_updated_at'])
    .join(histroyQuery, 'histroy.work_id', 'staticMetadata.id')
    .orderBy('play_updated_at', sortOption);

  totalCount = await query().count('id as count');
  works = await query().limit(limit).offset(offset);

  return {works, totalCount};
};

const updatePlayHistroy = async (username, work_id, state) => knex.transaction(async(trx) => {
  await trx.raw('INSERT OR IGNORE INTO t_play_histroy (user_name, work_id, state) VALUES (?, ?, ?);', [username, work_id, state]);
  await trx.raw('UPDATE t_play_histroy SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [state, username, work_id]);
});

async function deletePlayHistroy(username, work_id) {
  await knex('t_play_histroy').where('work_id', '=', work_id).where('user_name', '=', username).del();
}

const getMetadata = ({field = 'circle', id} = {}) => {
  const validFields = ['circle', 'tag', 'va', 'illustrator', 'script_writer', 'series'];
  if (!validFields.includes(field)) throw new Error('无效的查询域');
  return knex(`t_${field}`)
    .select('*')
    .where('id', '=', id)
    .first();
};

async function getWorkMemo(work_id) {
  const work = await knex('t_work')
    .select('id', 'memo')
    .where('id', '=', work_id)
    .first();

  return JSON.parse(work.memo);
}

async function setWorkMemo(work_id, memo) {
  await knex('t_work')
    .where('id', '=', work_id)
    .update({
      memo: JSON.stringify(memo)
    });
}

module.exports = {
  knex, insertWorkMetadata, getWorkMetadata, removeWork, getWorksBy, getWorksByKeyWord, updateWorkMetadata,
  editWorkMetadata,
  getLabels, getMetadata,
  createUser, updateUserPassword, resetUserPassword, deleteUser,
  getWorksWithReviews, updateUserReview, deleteUserReview,
  databaseExist, getPlayHistroy, updatePlayHistroy, deletePlayHistroy,
  nsfwFilter,
  getWorkMemo, setWorkMemo,
};
