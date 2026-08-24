const crypto = require('crypto');
const { nameToUUID } = require('../scraper/utils');
const { canonicalizeTagName } = require('../scraper/tag-aliases');
const { canonicalizeVaName } = require('../scraper/va-aliases');

/**
 * Format ID: pad DLsite numeric ids to RJ form (6 or 8 digits).
 * For string inputs (already in final form), pass through.
 */
function formatID(id) {
  if (typeof id === 'string') return id;
  const n = parseInt(id, 10);
  return (n >= 1000000) ? `0${n}`.slice(-8) : `000000${n}`.slice(-6);
}

/**
 * Factory that binds every DB query function to a specific knex instance.
 * Functions are copied verbatim from the original singleton-bound versions in
 * db.js so the generated SQL is byte-identical.
 * @param {import('knex').Knex} knex
 * @returns {Object} Query functions bound to the given knex.
 */
const makeQueries = (knex) => {
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
   * Overwrite each history row's state.seconds from t_track_progress, keyed by
   * the contentHash of the track the queue is parked on. PUT /api/history only
   * fires on play/pause/track-change, so the position it carries goes stale
   * between writes; t_track_progress is the one updated on an interval.
   * Rows written before this change (no contentHash on the queue item, or no
   * progress row yet) keep their stored seconds.
   * @param {String} username
   * @param {Array<Object>} rows - Rows carrying a JSON `state` string; mutated in place.
   */
  const applyTrackProgressSeconds = async (username, rows) => {
    const parsed = [];
    for (const row of rows) {
      if (!row.state) continue;
      let state;
      try {
        state = JSON.parse(row.state);
      } catch {
        continue;
      }
      const hash = state.queue && state.queue[state.index] && state.queue[state.index].contentHash;
      if (hash) parsed.push({ row, state, hash });
    }
    if (!parsed.length) return;

    const progress = await knex('t_track_progress')
      .select('track_key', 'seconds')
      .where('user_name', username)
      .whereIn('track_key', parsed.map(p => p.hash));
    const byKey = new Map(progress.map(p => [p.track_key, p.seconds]));

    for (const p of parsed) {
      if (!byKey.has(p.hash)) continue;
      p.state.seconds = byKey.get(p.hash);
      p.row.state = JSON.stringify(p.state);
    }
  };

  /**
   * Shared helper: batch-fetch static relations (tags, vas, illustrators,
   * script_writers, series) and optional user state for a set of work IDs,
   * then assemble into the JSON-string *Obj shape that normalize() expects.
   *
   * @param {Array<Object>} coreRows - Rows from t_work ⋈ t_circle with core fields.
   * @param {Object} [opts]
   * @param {String} opts.username
   * @param {Boolean} opts.reviewFields - also fetch review_text/progress/updated_at/user_name
   * @param {Boolean} opts.historyFields - also fetch state/play_updated_at
   * @returns {Promise<Array<Object>>} Assembled rows with *Obj JSON-string fields.
   */
  async function assembleWorks(coreRows, { username = 'admin', reviewFields = false, historyFields = false } = {}) {
    if (coreRows.length === 0) return [];

    const ids = coreRows.map(r => r.id);

    // Batch-fetch static relations
    const [tagRows, vaRows, illusRows, swRows, seriesRows, reviewRows, historyRows] = await Promise.all([
      knex('r_tag_work').join('t_tag', 't_tag.id', 'r_tag_work.tag_id')
        .select('r_tag_work.work_id', 'r_tag_work.tag_id as id', 't_tag.name').whereIn('r_tag_work.work_id', ids),
      knex('r_va_work').join('t_va', 't_va.id', 'r_va_work.va_id')
        .select('r_va_work.work_id', 'r_va_work.va_id as id', 't_va.name').whereIn('r_va_work.work_id', ids),
      knex('r_illustrator_work').join('t_illustrator', 't_illustrator.id', 'r_illustrator_work.illustrator_id')
        .select('r_illustrator_work.work_id', 'r_illustrator_work.illustrator_id as id', 't_illustrator.name').whereIn('r_illustrator_work.work_id', ids),
      knex('r_script_writer_work').join('t_script_writer', 't_script_writer.id', 'r_script_writer_work.script_writer_id')
        .select('r_script_writer_work.work_id', 'r_script_writer_work.script_writer_id as id', 't_script_writer.name').whereIn('r_script_writer_work.work_id', ids),
      knex('r_series_work').join('t_series', 't_series.id', 'r_series_work.series_id')
        .select('r_series_work.work_id', 'r_series_work.series_id as id', 't_series.name').whereIn('r_series_work.work_id', ids),
      // User state — review (only if requested)
      reviewFields
        ? knex('t_review').select('work_id', 'rating as userRating', 'review_text', 'progress',
            knex.raw("strftime('%Y-%m-%d %H-%M-%S', updated_at, 'localtime') AS updated_at"), 'user_name')
            .where('user_name', username).whereIn('work_id', ids)
        : Promise.resolve([]),
      // Play history (only if requested)
      historyFields
        ? knex('t_play_history').select('work_id', 'state', 'updated_at as play_updated_at')
            .where('user_name', username).whereIn('work_id', ids)
        : Promise.resolve([]),
    ]);

    // Build a Map from id -> assembled row
    const byId = new Map();
    for (const row of coreRows) {
      const a = { ...row };
      a.circleObj = JSON.stringify({ id: row.circle_id, name: row.name });
      a.tagObj = JSON.stringify({ tags: [] });
      a.vaObj = JSON.stringify({ vas: [] });
      a.illustratorObj = JSON.stringify({ illustrators: [] });
      a.scriptWriterObj = JSON.stringify({ scriptWriters: [] });
      a.seriesObj = JSON.stringify({ series: [] });
      byId.set(a.id, a);
    }

    // Helper: push a relation item into a work's *Obj array, deduping by id
    const pushDeduped = (workId, objKey, subKey, item) => {
      const w = byId.get(workId);
      if (!w) return;
      const arr = JSON.parse(w[objKey])[subKey];
      // Dedupe by id (mimics json_group_array(DISTINCT ...))
      if (!arr.some(existing => existing.id === item.id)) {
        arr.push(item);
      }
      w[objKey] = JSON.stringify({ [subKey]: arr });
    };

    for (const t of tagRows) pushDeduped(t.work_id, 'tagObj', 'tags', { id: t.id, name: t.name });
    for (const v of vaRows) pushDeduped(v.work_id, 'vaObj', 'vas', { id: v.id, name: v.name });
    for (const it of illusRows) pushDeduped(it.work_id, 'illustratorObj', 'illustrators', { id: it.id, name: it.name });
    for (const sw of swRows) pushDeduped(sw.work_id, 'scriptWriterObj', 'scriptWriters', { id: sw.id, name: sw.name });
    for (const se of seriesRows) pushDeduped(se.work_id, 'seriesObj', 'series', { id: se.id, name: se.name });

    // Apply user state fields (if any)
    if (reviewFields) {
      for (const r of reviewRows) {
        const w = byId.get(r.work_id);
        if (!w) continue;
        w.userRating = r.userRating;
        w.review_text = r.review_text;
        w.progress = r.progress;
        w.updated_at = r.updated_at;
        w.user_name = r.user_name;
      }
    }
    if (historyFields) {
      await applyTrackProgressSeconds(username, historyRows);
      for (const h of historyRows) {
        const w = byId.get(h.work_id);
        if (!w) continue;
        w.state = h.state;
        w.play_updated_at = h.play_updated_at;
      }
    }

    // Return in the same order as coreRows
    return coreRows.map(r => byId.get(r.id));
  }

  /**
   * Unified label resolver: resolve or create a label by name using nameToUUID.
   * Works for all label tables: t_circle, t_tag, t_va, t_illustrator, t_script_writer, t_series.
   * @param {import('knex').Knex.Transaction} trx
   * @param {String} tableName
   * @param {String} name
   * @returns {Promise<String>} UUID id
   */
  const resolveLabel = async (trx, tableName, name) => {
    const id = nameToUUID(name);
    await trx.raw('INSERT OR IGNORE INTO ??(id, name) VALUES (?, ?)', [tableName, id, name]);
    return id;
  };

  // Tag-specific resolver: canonicalizes the scraped name (new → old) before
  // UUID resolution so a DLsite rename folds onto the existing t_tag row
  // instead of splitting into two. See scraper/tag-aliases.json.
  const resolveTagLabel = async (trx, name) =>
    resolveLabel(trx, 't_tag', canonicalizeTagName(name));

  // VA-specific resolver: canonicalizes the scraped name (variant → canonical)
  // so a VA registered under several spellings folds onto one t_va row.
  // See scraper/va-aliases.json.
  const resolveVaLabel = async (trx, name) =>
    resolveLabel(trx, 't_va', canonicalizeVaName(name));

  /**
   * Takes a work metadata object and inserts it into the database.
   * @param {Object} work Work object.
   */
  const insertWorkMetadata = async work => knex.transaction(async (trx) => {
    // Resolve circle UUID by name
    const circleId = await resolveLabel(trx, 't_circle', work.circle.name);

    await trx('t_work')
      .insert({
        id: work.id,
        root_folder: work.rootFolderName,
        dir: work.dir,
        title: work.title,
        circle_id: circleId,
        nsfw: work.nsfw,
        release: work.release,
        dl_count: work.dl_count,
        price: work.price,
        review_count: work.review_count,
        rate_count: work.rate_count,
        rate_average_2dp: work.rate_average_2dp,
        rate_count_detail: JSON.stringify(work.rate_count_detail),
        rank: work.rank ? JSON.stringify(work.rank) : null,
        description: work.description || null,
        description_parts: work.descriptionParts ? JSON.stringify(work.descriptionParts) : null,
        sample_images: work.sampleImages ? JSON.stringify(work.sampleImages) : null,
      });

    // Tags (canonicalized: a renamed DLsite tag folds onto the old-name row)
    for (const tag of work.tags) {
      const tagId = await resolveTagLabel(trx, tag.name);
      await trx.raw('INSERT OR IGNORE INTO r_tag_work(tag_id, work_id) VALUES (?, ?)', [tagId, work.id]);
    }

    // VAs
    for (const va of work.vas) {
      const vaId = await resolveVaLabel(trx, va.name);
      await trx.raw('INSERT OR IGNORE INTO r_va_work(va_id, work_id) VALUES (?, ?)', [vaId, work.id]);
    }

    // Illustrators
    if (work.illustrators) {
      for (const illus of work.illustrators) {
        const illusId = await resolveLabel(trx, 't_illustrator', illus.name);
        await trx.raw('INSERT OR IGNORE INTO r_illustrator_work(illustrator_id, work_id) VALUES (?, ?)', [illusId, work.id]);
      }
    }

    // Script writers
    if (work.scriptWriters) {
      for (const sw of work.scriptWriters) {
        const swId = await resolveLabel(trx, 't_script_writer', sw.name);
        await trx.raw('INSERT OR IGNORE INTO r_script_writer_work(script_writer_id, work_id) VALUES (?, ?)', [swId, work.id]);
      }
    }

    // Authors (作者) — rarely set, and never alongside a VA/illustrator breakdown
    if (work.authors) {
      for (const author of work.authors) {
        const authorId = await resolveLabel(trx, 't_author', author.name);
        await trx.raw('INSERT OR IGNORE INTO r_author_work(author_id, work_id) VALUES (?, ?)', [authorId, work.id]);
      }
    }

    // Series
    if (work.series && work.series.name) {
      const seriesId = await resolveLabel(trx, 't_series', work.series.name);
      await trx.raw('INSERT OR IGNORE INTO r_series_work(series_id, work_id) VALUES (?, ?)', [seriesId, work.id]);
    }
  });

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
        const vaId = await resolveVaLabel(trx, va.name);
        await trx.raw('INSERT OR IGNORE INTO r_va_work(va_id, work_id) VALUES (?, ?)', [vaId, work.id]);
      }
    }
    // Illustrator: delete only when includeIllustrator flag explicitly set; insert always if includeIllustrator or refreshAll
    if (options.includeIllustrator) {
      await trx('r_illustrator_work').where('work_id', work.id).del();
    }
    if (options.includeIllustrator || options.refreshAll) {
      if (work.illustrators) {
        for (const illustrator of work.illustrators) {
          const illusId = await resolveLabel(trx, 't_illustrator', illustrator.name);
          await trx.raw('INSERT OR IGNORE INTO r_illustrator_work(illustrator_id, work_id) VALUES (?, ?)', [illusId, work.id]);
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
          const swId = await resolveLabel(trx, 't_script_writer', sw.name);
          await trx.raw('INSERT OR IGNORE INTO r_script_writer_work(script_writer_id, work_id) VALUES (?, ?)', [swId, work.id]);
        }
      }
    }
    // Author: delete only when includeAuthor flag explicitly set; insert always if includeAuthor or refreshAll
    if (options.includeAuthor) {
      await trx('r_author_work').where('work_id', work.id).del();
    }
    if (options.includeAuthor || options.refreshAll) {
      if (work.authors) {
        for (const author of work.authors) {
          const authorId = await resolveLabel(trx, 't_author', author.name);
          await trx.raw('INSERT OR IGNORE INTO r_author_work(author_id, work_id) VALUES (?, ?)', [authorId, work.id]);
        }
      }
    }
    // Series: delete only when includeSeries flag explicitly set; insert always if includeSeries or refreshAll
    if (options.includeSeries) {
      await trx('r_series_work').where('work_id', work.id).del();
    }
    if (options.includeSeries || options.refreshAll) {
      if (work.series && work.series.name) {
        const seriesId = await resolveLabel(trx, 't_series', work.series.name);
        await trx.raw('INSERT OR IGNORE INTO r_series_work(series_id, work_id) VALUES (?, ?)', [seriesId, work.id]);
      }
    }
    if (options.includeTags || options.refreshAll) {
      if (options.purgeTags) {
        await trx('r_tag_work').where('work_id', work.id).del();
      }
      for (const tag of work.tags) {
        const tagId = await resolveTagLabel(trx, tag.name);
        await trx.raw('INSERT OR IGNORE INTO r_tag_work(tag_id, work_id) VALUES (?, ?)', [tagId, work.id]);
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

    // Description and sample image list: overwritten wholesale, since a
    // partial scrape is worth less than the previous full one only if it is
    // empty — which is why an empty scrape is skipped here.
    if (options.includeDescription || options.refreshAll) {
      const patch = {};
      if (work.description) patch.description = work.description;
      if (work.descriptionParts && work.descriptionParts.length) {
        patch.description_parts = JSON.stringify(work.descriptionParts);
      }
      if (work.sampleImages && work.sampleImages.length) {
        patch.sample_images = JSON.stringify(work.sampleImages);
      }
      if (Object.keys(patch).length) {
        await trx('t_work').where('id', work.id).update(patch);
      }
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
   * Manually edit a work's descriptive metadata (full replace semantics).
   * Runs in one transaction. Updates t_work, resolves-or-creates labels,
   * replaces relational links, and cleans up orphaned labels.
   * @param {String} workId
   * @param {Object} data
   * @param {String} data.title
   * @param {Boolean} data.nsfw
   * @param {String} data.release
   * @param {String} data.circle - circle name
   * @param {Array<{id?:String, name:String}>} data.tags
   * @param {Array<{id?:String, name:String}>} data.vas
   * @param {Array<{id?:String, name:String}>} data.illustrators
   * @param {Array<{id?:String, name:String}>} data.scriptWriters
   * @param {Object|null} data.series - {id?:String, name:String} or null
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
    const newCircleId = await resolveLabel(trx, 't_circle', data.circle);
    await trx('t_work').where('id', workId).update({ circle_id: newCircleId });

    // 3. Tags
    const prevTagRows = await trx('r_tag_work').select('tag_id').where('work_id', workId);
    const prevTagIds = prevTagRows.map(r => r.tag_id);
    await trx('r_tag_work').where('work_id', workId).del();
    const newTagIds = [];
    for (const tag of data.tags) {
      const id = await resolveTagLabel(trx, tag.name);
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
      const id = await resolveVaLabel(trx, va.name);
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
      const id = await resolveLabel(trx, 't_illustrator', illus.name);
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
      const id = await resolveLabel(trx, 't_script_writer', sw.name);
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
      const id = await resolveLabel(trx, 't_series', data.series.name);
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
   * Returns an Array of length 1 (compatible with normalize()).
   * @param {String} id Work identifier.
   * @param {String} username 'admin' or other usernames for current user
   */
  const getWorkMetadata = async (id, username) => {
    const row = await knex('t_work')
      .join('t_circle', 't_circle.id', 't_work.circle_id')
      .select(
        't_work.id', 't_work.created_at', 't_work.updated_at',
        't_work.title', 't_work.circle_id', 't_circle.name',
        't_work.nsfw', 't_work.release',
        't_work.dl_count', 't_work.price', 't_work.review_count',
        't_work.rate_count', 't_work.rate_average_2dp',
        't_work.rate_count_detail', 't_work.rank')
      .where('t_work.id', id)
      .first();

    if (!row) throw new Error(`There is no work with id ${id} in the database.`);

    const assembled = await assembleWorks([row], { username, reviewFields: true, historyFields: true });
    return assembled;
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
   * @param {*} authors Array of author ids to check.
   */
  const cleanupOrphans = async (trxProvider, circle, tags, vas, illustrators = [], scriptWriters = [], series = [], authors = [])  => {
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

    for (let i = 0; i < authors.length; i += 1) {
      const a = authors[i];
      const count = await getCount('r_author_work', 'author_id', a);

      if (count === 0) {
        promises.push(
          trx('t_author')
            .delete()
            .where('id', '=', a),
        );
      }
    }

    await Promise.all(promises);
  };

  /**
   * Removes a work and then its orphaned circles, tags & VAs from the database.
   * @param {String} id Work id.
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
      const authors = await trx('r_author_work').select('author_id').where('work_id', '=', id);

      await trx('t_play_history').del().where('work_id', '=', id);
      await trx('r_tag_work').del().where('work_id', '=', id);
      await trx('r_va_work').del().where('work_id', '=', id);
      await trx('r_illustrator_work').del().where('work_id', '=', id);
      await trx('r_script_writer_work').del().where('work_id', '=', id);
      await trx('r_series_work').del().where('work_id', '=', id);
      await trx('r_author_work').del().where('work_id', '=', id);
      await trx('t_dlsite_review').del().where('work_id', '=', id);
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
        authors.map(a => a.author_id),
      );
  };

  /**
   * Returns list of works by circle, tag, VA, illustrator, script writer or series.
   * Now async — returns { works, totalCount }.
   * @param {Object} opts
   * @param {String} [opts.id] - filter id (for field-specific queries)
   * @param {String} [opts.field] - 'circle' | 'tag' | 'va' | 'illustrator' | 'script_writer' | 'series'
   * @param {String} [opts.username='']
   * @param {Number} [opts.nsfw=0] - 0=all, 1=全年龄, 2=R18
   * @param {String} [opts.order='release'] - sort column; 'rating' for userRating; 'random'/'betterRandom'
   * @param {String} [opts.sort='desc']
   * @param {Number} [opts.limit] - page size; omit for all rows
   * @param {Number} [opts.offset]
   * @param {Number} [opts.seed] - shuffle seed for random order
   * @returns {Promise<{works: Object[], totalCount: Array<{count: number}>}>}
   */
  const getWorksBy = async ({id, field, username = '', nsfw = 0, order = 'release', sort = 'desc', limit, offset, seed} = {}) => {
    // Build the core query (t_work ⋈ t_circle)
    let coreQ = knex('t_work')
      .join('t_circle', 't_circle.id', 't_work.circle_id')
      .select(
        't_work.id', 't_work.created_at', 't_work.updated_at',
        't_work.title', 't_work.circle_id', 't_circle.name',
        't_work.nsfw', 't_work.release',
        't_work.dl_count', 't_work.price', 't_work.review_count',
        't_work.rate_count', 't_work.rate_average_2dp',
        't_work.rate_count_detail', 't_work.rank');

    // Apply field filter
    if (field) {
      switch (field) {
        case 'circle':
          coreQ = coreQ.where('t_work.circle_id', id);
          break;
        case 'tag':
          coreQ = coreQ.whereIn('t_work.id', knex('r_tag_work').select('work_id').where('tag_id', id));
          break;
        case 'va':
          coreQ = coreQ.whereIn('t_work.id', knex('r_va_work').select('work_id').where('va_id', id));
          break;
        case 'illustrator':
          coreQ = coreQ.whereIn('t_work.id', knex('r_illustrator_work').select('work_id').where('illustrator_id', id));
          break;
        case 'script_writer':
          coreQ = coreQ.whereIn('t_work.id', knex('r_script_writer_work').select('work_id').where('script_writer_id', id));
          break;
        case 'series':
          coreQ = coreQ.whereIn('t_work.id', knex('r_series_work').select('work_id').where('series_id', id));
          break;
        case 'author':
          coreQ = coreQ.whereIn('t_work.id', knex('r_author_work').select('work_id').where('author_id', id));
          break;
        default:
          break;
      }
    }

    // Apply nsfw filter
    coreQ = nsfwFilter(nsfw, coreQ);

    // Compute totalCount
    const countRow = await coreQ.clone().count('t_work.id as count').first();
    const totalCount = [{ count: countRow ? countRow.count : 0 }];

    // Handle special order modes
    let works = [];
    if (order === 'random') {
      const seedVal = seed || 7;
      const rows = await coreQ.clone()
        .orderBy(knex.raw('t_work.id % ?', seedVal))
        .limit(limit)
        .offset(offset || 0);
      works = await assembleWorks(rows, { username });
    } else if (order === 'betterRandom') {
      const rows = await coreQ.clone()
        .orderBy(knex.raw('random()'))
        .limit(1);
      works = await assembleWorks(rows, { username });
    } else {
      // Standard ordering — may need userrate for 'rating' order
      let orderedQ = coreQ.clone();
      if (order === 'rating') {
        // LEFT JOIN userrate so unrated works still appear (with null rating)
        const userrateSub = knex('t_review')
          .select('work_id', 'rating as userRating')
          .where('user_name', username)
          .as('userrate');
        orderedQ = orderedQ
          .leftJoin(userrateSub, 'userrate.work_id', 't_work.id')
          .select('userrate.userRating')
          .orderBy('userRating', sort);
      } else {
        orderedQ = orderedQ.orderBy(`t_work.${order}`, sort);
      }
      orderedQ = orderedQ.orderBy([{ column: 't_work.release', order: 'desc' }, { column: 't_work.id', order: 'desc' }]);

      if (limit != null) {
        orderedQ = orderedQ.limit(limit).offset(offset || 0);
      }

      const rows = await orderedQ;

      // If we ordered by rating, userRating is already on the rows; assembleWorks passes it through
      works = await assembleWorks(rows, { username });

      // If userRating was selected via LEFT JOIN, it's already on the rows
      if (order !== 'rating') {
        // Batch-fetch user ratings for the page
        const ids = works.map(w => w.id);
        if (ids.length > 0) {
          const ratings = await knex('t_review')
            .select('work_id', 'rating as userRating')
            .where('user_name', username)
            .whereIn('work_id', ids);
          const ratingMap = new Map(ratings.map(r => [r.work_id, r.userRating]));
          for (const w of works) {
            w.userRating = ratingMap.get(w.id) || null;
          }
        }
      }
    }

    return { works, totalCount };
  };

  /**
   * 根据关键字查询音声 (async, paged).
   * @param {Object} opts
   * @param {String} opts.keyword
   * @param {String} [opts.username='admin']
   * @param {Number} [opts.nsfw=0]
   * @param {String} [opts.order='release']
   * @param {String} [opts.sort='desc']
   * @param {Number} [opts.limit]
   * @param {Number} [opts.offset]
   * @param {Number} [opts.seed]
   * @returns {Promise<{works: Object[], totalCount: Array<{count: number}>}>}
   */
  const getWorksByKeyWord = async ({keyword, username = 'admin', nsfw = 0, order = 'release', sort = 'desc', limit, offset, seed} = {}) => {
    let coreQ = knex('t_work')
      .join('t_circle', 't_circle.id', 't_work.circle_id')
      .select(
        't_work.id', 't_work.created_at', 't_work.updated_at',
        't_work.title', 't_work.circle_id', 't_circle.name',
        't_work.nsfw', 't_work.release',
        't_work.dl_count', 't_work.price', 't_work.review_count',
        't_work.rate_count', 't_work.rate_average_2dp',
        't_work.rate_count_detail', 't_work.rank');

    // Detect Fanza cid (d_XXXXXX) or RJ code
    const fanzaMatch = keyword.match(/(d_\d+)/i);
    const rjMatch = keyword.match(/(?:rj)?(\d{6,8})/i);
    if (fanzaMatch) {
      const fanzaId = fanzaMatch[1];
      coreQ = coreQ.where('t_work.id', '=', fanzaId);
    } else if (rjMatch) {
      const digits = rjMatch[1];
      const paddedId = formatID(parseInt(digits, 10));
      coreQ = coreQ.where('t_work.id', '=', paddedId);
    } else {
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

      coreQ = coreQ
        .where('t_work.title', 'like', `%${keyword}%`)
        .orWhere('t_work.circle_id', 'in', circleIdQuery)
        .orWhere('t_work.id', 'in', workIdQuery);
    }

    coreQ = nsfwFilter(nsfw, coreQ);

    const countRow = await coreQ.clone().count('t_work.id as count').first();
    const totalCount = [{ count: countRow ? countRow.count : 0 }];

    let works = [];
    if (order === 'random') {
      const seedVal = seed || 7;
      const rows = await coreQ.clone()
        .orderBy(knex.raw('t_work.id % ?', seedVal))
        .limit(limit)
        .offset(offset || 0);
      works = await assembleWorks(rows, { username });
    } else {
      let orderedQ = coreQ.clone();
      if (order === 'rating') {
        const userrateSub = knex('t_review')
          .select('work_id', 'rating as userRating')
          .where('user_name', username)
          .as('userrate');
        orderedQ = orderedQ
          .leftJoin(userrateSub, 'userrate.work_id', 't_work.id')
          .select('userrate.userRating')
          .orderBy('userRating', sort);
      } else {
        orderedQ = orderedQ.orderBy(`t_work.${order}`, sort);
      }
      orderedQ = orderedQ.orderBy([{ column: 't_work.release', order: 'desc' }, { column: 't_work.id', order: 'desc' }]);

      if (limit != null) {
        orderedQ = orderedQ.limit(limit).offset(offset || 0);
      }

      const rows = await orderedQ;
      works = await assembleWorks(rows, { username });

      // Batch-fetch user ratings if not already joined
      if (order !== 'rating') {
        const ids = works.map(w => w.id);
        if (ids.length > 0) {
          const ratings = await knex('t_review')
            .select('work_id', 'rating as userRating')
            .where('user_name', username)
            .whereIn('work_id', ids);
          const ratingMap = new Map(ratings.map(r => [r.work_id, r.userRating]));
          for (const w of works) {
            w.userRating = ratingMap.get(w.id) || null;
          }
        }
      }
    }

    return { works, totalCount };
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
    } else if (['tag', 'va', 'illustrator', 'script_writer', 'series', 'author'].includes(field)) {
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
  // autoMark: when progressOnly=true, only writes/inserts progress='listened' if the
  // existing progress (if any) is not in the terminal set ('listened','replay','postponed').
  // This prevents auto-marking from overwriting an explicit user state.
  const updateUserReview = async (username, workid, rating, review_text = '', progress = '', starOnly = true, progressOnly = false, autoMark = false) => knex.transaction(async(trx) => {
      // UPSERT
      if (starOnly) {
        await trx.raw('UPDATE t_review SET rating = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [rating, username, workid]);
        await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, rating) VALUES (?, ?, ?);', [username, workid, rating]);
      } else if (progressOnly && autoMark) {
        // Auto-mark: only write/insert 'listened' if terminal state is not set.
        const existing = await trx.raw('SELECT progress FROM t_review WHERE user_name = ? AND work_id = ?;', [username, workid]);
        const existingProgress = existing[0] ? existing[0].progress : null;
        const terminal = ['listened', 'replay', 'postponed'];
        if (existingProgress && terminal.includes(existingProgress)) {
          // No-op — user has explicitly set a terminal state, do not overwrite.
          return;
        }
        // Fall through to normal progressOnly upsert.
        await trx.raw('UPDATE t_review SET progress = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [progress, username, workid]);
        await trx.raw('INSERT OR IGNORE INTO t_review (user_name, work_id, progress) VALUES (?, ?, ?);', [username, workid, progress]);
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

  // 只清除进度（progress），保留评分与评论。
  // 如果该行除 progress 外没有评分也没有评论（例如仅由自动标记创建的 rating-null 行），
  // 则整行删除，避免留下全 NULL 的空行。
  // 没有对应行时为 no-op。
  const resetUserProgress = async (username, workid) => knex.transaction(async (trx) => {
    const rows = await trx.raw('SELECT rating, review_text FROM t_review WHERE user_name = ? AND work_id = ?;', [username, workid]);
    const row = rows[0];
    if (!row) return; // 无行可清
    const hasRating = row.rating !== null && row.rating !== undefined;
    const hasReview = row.review_text !== null && row.review_text !== '';
    if (!hasRating && !hasReview) {
      // 没有评分/评论可保留，整行删除
      await trx.raw('DELETE FROM t_review WHERE user_name = ? AND work_id = ?;', [username, workid]);
    } else {
      await trx.raw('UPDATE t_review SET progress = NULL, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [username, workid]);
    }
  });

  // 读取星标及评语 + 作品元数据
  const getWorksWithReviews = async ({username = '', limit = 1000, offset = 0, orderBy = 'release', sortOption = 'desc', filter} = {}) => {
    let coreQ = knex('t_work')
      .join('t_review', function() {
        this.on('t_review.work_id', '=', 't_work.id')
          .andOn('t_review.user_name', '=', knex.raw('?', [username]));
      })
      .join('t_circle', 't_circle.id', 't_work.circle_id')
      .select(
        't_work.id', 't_work.created_at', 't_work.updated_at',
        't_work.title', 't_work.circle_id', 't_circle.name',
        't_work.nsfw', 't_work.release',
        't_work.dl_count', 't_work.price', 't_work.review_count',
        't_work.rate_count', 't_work.rate_average_2dp',
        't_work.rate_count_detail', 't_work.rank',
        't_review.rating as userRating', 't_review.review_text',
        't_review.progress',
        knex.raw("strftime('%Y-%m-%d %H-%M-%S', t_review.updated_at, 'localtime') AS updated_at"),
        't_review.user_name');

    if (filter) {
      coreQ = coreQ.where('t_review.progress', filter);
    }

    // Order by
    // 'userRating' is what the Favourites page sends as its sort option key;
    // 'rating' is the value used elsewhere (e.g. getWorksBy). Treat both as
    // the user's review rating, which lives on t_review (aliased as userRating).
    let orderCol;
    if (orderBy === 'rating' || orderBy === 'userRating') {
      orderCol = 't_review.rating';
    } else {
      orderCol = `t_work.${orderBy}`;
    }
    coreQ = coreQ.orderBy(orderCol, sortOption)
      .orderBy([{ column: 't_work.release', order: 'desc' }, { column: 't_work.id', order: 'desc' }]);

    // Compute totalCount
    const countRow = await coreQ.clone().count('t_work.id as count').first();
    const totalCount = [{ count: countRow ? countRow.count : 0 }];

    const rows = await coreQ.clone().limit(limit).offset(offset);
    const works = await assembleWorks(rows, { username });

    return {works, totalCount};
  };

  const getPlayHistory = async ({username = '', sortOption = 'desc', limit = 1000, offset = 0, excludeFinished = 'listened'}) => {
    let coreQ = knex('t_work')
      .join('t_play_history', function() {
        this.on('t_play_history.work_id', '=', 't_work.id')
          .andOn('t_play_history.user_name', '=', knex.raw('?', [username]));
      })
      .join('t_circle', 't_circle.id', 't_work.circle_id')
      .leftJoin('t_review', function() {
        this.on('t_review.work_id', '=', 't_work.id')
          .andOn('t_review.user_name', '=', knex.raw('?', [username]));
      })
      .select(
        't_work.id', 't_work.created_at', 't_work.updated_at',
        't_work.title', 't_work.circle_id', 't_circle.name',
        't_work.nsfw', 't_work.release',
        't_work.dl_count', 't_work.price', 't_work.review_count',
        't_work.rate_count', 't_work.rate_average_2dp',
        't_work.rate_count_detail', 't_work.rank',
        't_play_history.state', 't_play_history.updated_at as play_updated_at',
        't_review.progress')
      .orderBy('t_play_history.updated_at', sortOption);

    if (excludeFinished === 'listened') {
      coreQ = coreQ.where(function() {
        this.whereNull('t_review.progress').orWhere('t_review.progress', '!=', 'listened');
      });
    }

    const countRow = await coreQ.clone().count('t_work.id as count').first();
    const totalCount = [{ count: countRow ? countRow.count : 0 }];

    const rows = await coreQ.clone().limit(limit).offset(offset);
    await applyTrackProgressSeconds(username, rows);
    // No reviewFields: the hide-finished filter is applied server-side above, and
    // t_review.progress is already spread into each work item via the LEFT JOIN
    // select. Passing reviewFields would run an extra t_review query and populate
    // userRating/review_text, which would make star ratings appear in the history
    // list — an unintended UI change.
    const works = await assembleWorks(rows, { username });

    return {works, totalCount};
  };

  const updatePlayHistory = async (username, work_id, state) => knex.transaction(async(trx) => {
    await trx.raw('INSERT OR IGNORE INTO t_play_history (user_name, work_id, state) VALUES (?, ?, ?);', [username, work_id, state]);
    await trx.raw('UPDATE t_play_history SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE user_name = ? AND work_id = ?;', [state, username, work_id]);
  });

  async function deletePlayHistory(username, work_id) {
    await knex('t_play_history').where('work_id', '=', work_id).where('user_name', '=', username).del();
  }

  const getMetadata = ({field = 'circle', id} = {}) => {
    const validFields = ['circle', 'tag', 'va', 'illustrator', 'script_writer', 'series', 'author'];
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

  /**
   * Reads the scraped work-page extras: description, per-part description
   * structure (incl. the track list) and the sample image list.
   * @param {String} work_id
   * @returns {Promise<Object|null>} { description, descriptionParts, sampleImages }
   */
  async function getWorkExtras(work_id) {
    const row = await knex('t_work')
      .select('description', 'description_parts', 'sample_images')
      .where('id', '=', work_id)
      .first();

    if (!row) return null;

    const parse = (value, fallback) => {
      if (!value) return fallback;
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    };

    return {
      description: row.description || '',
      descriptionParts: parse(row.description_parts, []),
      sampleImages: parse(row.sample_images, []),
    };
  }

  /**
   * Overwrites the stored sample image list. Used by the scanner to record
   * which images actually made it to disk (the `file` field).
   * @param {String} work_id
   * @param {Array<Object>} sampleImages
   */
  async function setWorkSampleImages(work_id, sampleImages) {
    await knex('t_work')
      .where('id', '=', work_id)
      .update({ sample_images: JSON.stringify(sampleImages || []) });
  }

  /**
   * Replaces every stored DLsite review of a work with the scraped set.
   *
   * Replace rather than merge: DLsite lets reviewers edit and delete, so a
   * merge would keep stale text around forever. Reviews carry no local state,
   * so nothing is lost by rewriting them.
   * @param {String} work_id
   * @param {Array<Object>} reviews Normalized reviews from scrapeWorkReviewsFromDLsite.
   */
  const replaceWorkDlsiteReviews = async (work_id, reviews) => knex.transaction(async (trx) => {
    await trx('t_dlsite_review').where('work_id', work_id).del();
    if (!reviews || !reviews.length) return;

    const rows = reviews.map(review => ({
      id: review.id,
      work_id,
      reviewer_id: review.reviewerId,
      reviewer_name: review.reviewerName,
      rate: review.rate,
      review_title: review.title,
      review_text: review.text,
      spoiler: review.spoiler,
      recommend: review.recommend,
      is_purchased: review.isPurchased,
      good_review: review.goodReview,
      bad_review: review.badReview,
      genres: JSON.stringify(review.genres || []),
      entry_date: review.entryDate,
      regist_date: review.registDate,
    }));

    // Chunked: SQLite caps a statement at 999 bound parameters by default and
    // a popular work can carry hundreds of reviews.
    await trx.batchInsert('t_dlsite_review', rows, 50);
  });

  /**
   * Reads a work's stored DLsite reviews, newest first.
   * @param {String} work_id
   * @returns {Promise<Array<Object>>}
   */
  async function getWorkDlsiteReviews(work_id) {
    const rows = await knex('t_dlsite_review')
      .select('*')
      .where('work_id', '=', work_id)
      .orderBy('regist_date', 'desc');

    return rows.map((row) => {
      let genres = [];
      try {
        genres = row.genres ? JSON.parse(row.genres) : [];
      } catch {
        genres = [];
      }
      return { ...row, genres };
    });
  }

  // t_track_progress queries (Phase 2)
  const getTrackProgress = async (username, work_id) => {
    const rows = await knex('t_track_progress')
      .select('track_key', 'seconds', 'completed')
      .where('user_name', username)
      .andWhere('work_id', work_id);
    const map = {};
    for (const row of rows) {
      map[row.track_key] = { seconds: row.seconds, completed: !!row.completed };
    }
    return map;
  };

  const upsertTrackProgress = async (username, work_id, track_key, seconds, completed) => {
    await knex.raw(`
      INSERT INTO t_track_progress (user_name, work_id, track_key, seconds, completed, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(user_name, work_id, track_key)
      DO UPDATE SET seconds = excluded.seconds, completed = excluded.completed, updated_at = excluded.updated_at
    `, [username, work_id, track_key, seconds, completed]);
  };

  return {
    nsfwFilter,
    resolveLabel, resolveTagLabel,
    insertWorkMetadata, getWorkMetadata, removeWork, getWorksBy, getWorksByKeyWord, updateWorkMetadata,
    editWorkMetadata,
    getLabels, getMetadata,
    createUser, updateUserPassword, resetUserPassword, deleteUser,
    getWorksWithReviews, updateUserReview, deleteUserReview, resetUserProgress,
    getPlayHistory, updatePlayHistory, deletePlayHistory,
    getWorkMemo, setWorkMemo,
    getWorkExtras, setWorkSampleImages,
    replaceWorkDlsiteReviews, getWorkDlsiteReviews,
    getTrackProgress, upsertTrackProgress,
  };
};

module.exports = { makeQueries };