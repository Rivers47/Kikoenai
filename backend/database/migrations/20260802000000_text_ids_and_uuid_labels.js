const { nameToUUID } = require('../../scraper/utils');

/**
 * Format ID: pad DLsite numeric ids to RJ form (6 or 8 digits).
 * For string inputs (already in final form), pass through.
 */
function formatID(id) {
  if (typeof id === 'string') return id;
  const n = parseInt(id, 10);
  return (n >= 1000000) ? `0${n}`.slice(-8) : `000000${n}`.slice(-6);
}

exports.up = async function(knex) {
  await knex.raw('PRAGMA foreign_keys=off');
  await knex.raw('PRAGMA ignore_check_constraints=on');

  await knex.transaction(async (trx) => {
    // ── Part A: Work id → TEXT ──

    // Pre-compute old-to-new work id mapping for all existing rows
    const oldWorks = await trx('t_work').select('id');
    console.log(`  [1/4] Rebuilding t_work with TEXT ids (${oldWorks.length} works)...`);
    const workIdMap = new Map();
    for (const w of oldWorks) {
      workIdMap.set(w.id, formatID(w.id));
    }

    // Rebuild t_work with TEXT id
    await trx.schema.dropTableIfExists('t_work_tmp');
    // Drop old index so the new table can use the same name
    await trx.raw('DROP INDEX IF EXISTS t_work_index');
    await trx.schema.createTable('t_work_tmp', (table) => {
      table.string('id').notNullable();
      table.timestamps(true, true);
      table.string('root_folder').notNullable();
      table.string('dir').notNullable();
      table.string('title').notNullable();
      table.string('circle_id').notNullable();
      table.boolean('nsfw');
      table.string('release');
      table.integer('dl_count');
      table.integer('price');
      table.integer('review_count');
      table.integer('rate_count');
      table.float('rate_average_2dp');
      table.text('rate_count_detail');
      table.text('rank');
      table.json('memo');
      table.primary('id');
      table.index(['circle_id', 'release', 'dl_count', 'review_count', 'price', 'rate_average_2dp'], 't_work_index');
    });

    // Copy data with transformed ids
    for (const w of oldWorks) {
      const oldRow = await trx('t_work').where('id', w.id).first();
      if (oldRow) {
        const newId = workIdMap.get(w.id);
        await trx('t_work_tmp').insert({
          id: newId,
          created_at: oldRow.created_at,
          updated_at: oldRow.updated_at,
          root_folder: oldRow.root_folder,
          dir: oldRow.dir,
          title: oldRow.title,
          circle_id: oldRow.circle_id, // will be updated in Part B
          nsfw: oldRow.nsfw,
          release: oldRow.release,
          dl_count: oldRow.dl_count,
          price: oldRow.price,
          review_count: oldRow.review_count,
          rate_count: oldRow.rate_count,
          rate_average_2dp: oldRow.rate_average_2dp,
          rate_count_detail: oldRow.rate_count_detail,
          rank: oldRow.rank,
          memo: oldRow.memo,
        });
      }
    }

    await trx.schema.dropTableIfExists('t_work');
    await trx.raw('ALTER TABLE t_work_tmp RENAME TO t_work');

    console.log('  [2/4] Rebuilding work_id FK tables (r_*_work, t_play_histroy)...');

    // Rebuild r_tag_work with TEXT work_id
    const oldTagWork = await trx('r_tag_work').select('*');
    await trx.schema.dropTableIfExists('r_tag_work');
    await trx.schema.createTable('r_tag_work', (table) => {
      table.integer('tag_id');
      table.string('work_id');
      table.foreign('tag_id').references('id').inTable('t_tag');
      table.foreign('work_id').references('id').inTable('t_work');
      table.primary(['tag_id', 'work_id']);
    });
    for (const row of oldTagWork) {
      await trx('r_tag_work').insert({
        tag_id: row.tag_id,
        work_id: workIdMap.get(row.work_id) || formatID(row.work_id),
      });
    }

    // Rebuild r_va_work with TEXT work_id
    const oldVaWork = await trx('r_va_work').select('*');
    await trx.schema.dropTableIfExists('r_va_work');
    await trx.schema.createTable('r_va_work', (table) => {
      table.string('va_id');
      table.string('work_id');
      table.foreign('va_id').references('id').inTable('t_va').onUpdate('CASCADE').onDelete('CASCADE');
      table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
      table.primary(['va_id', 'work_id']);
    });
    for (const row of oldVaWork) {
      await trx('r_va_work').insert({
        va_id: row.va_id,
        work_id: workIdMap.get(row.work_id) || formatID(row.work_id),
      });
    }

    // Rebuild r_illustrator_work with TEXT work_id
    const oldIllusWork = await trx('r_illustrator_work').select('*');
    await trx.schema.dropTableIfExists('r_illustrator_work');
    await trx.schema.createTable('r_illustrator_work', (table) => {
      table.string('illustrator_id');
      table.string('work_id');
      table.foreign('illustrator_id').references('id').inTable('t_illustrator').onUpdate('CASCADE').onDelete('CASCADE');
      table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
      table.primary(['illustrator_id', 'work_id']);
    });
    for (const row of oldIllusWork) {
      await trx('r_illustrator_work').insert({
        illustrator_id: row.illustrator_id,
        work_id: workIdMap.get(row.work_id) || formatID(row.work_id),
      });
    }

    // Rebuild r_script_writer_work with TEXT work_id
    const oldSwWork = await trx('r_script_writer_work').select('*');
    await trx.schema.dropTableIfExists('r_script_writer_work');
    await trx.schema.createTable('r_script_writer_work', (table) => {
      table.string('script_writer_id');
      table.string('work_id');
      table.foreign('script_writer_id').references('id').inTable('t_script_writer').onUpdate('CASCADE').onDelete('CASCADE');
      table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
      table.primary(['script_writer_id', 'work_id']);
    });
    for (const row of oldSwWork) {
      await trx('r_script_writer_work').insert({
        script_writer_id: row.script_writer_id,
        work_id: workIdMap.get(row.work_id) || formatID(row.work_id),
      });
    }

    // Rebuild r_series_work with TEXT work_id
    const oldSeriesWork = await trx('r_series_work').select('*');
    await trx.schema.dropTableIfExists('r_series_work');
    await trx.schema.createTable('r_series_work', (table) => {
      table.string('series_id');
      table.string('work_id');
      table.foreign('series_id').references('id').inTable('t_series').onUpdate('CASCADE').onDelete('CASCADE');
      table.foreign('work_id').references('id').inTable('t_work').onUpdate('CASCADE').onDelete('CASCADE');
      table.primary(['series_id', 'work_id']);
    });
    for (const row of oldSeriesWork) {
      await trx('r_series_work').insert({
        series_id: row.series_id,
        work_id: workIdMap.get(row.work_id) || formatID(row.work_id),
      });
    }

    // Rebuild t_play_histroy with TEXT work_id
    const oldPlayHist = await trx('t_play_histroy').select('*');
    await trx.schema.dropTableIfExists('t_play_histroy');
    await trx.schema.createTable('t_play_histroy', (table) => {
      table.string('user_name').notNullable();
      table.string('work_id').notNullable();
      table.timestamps(true, true);
      table.string('state').notNullable();
      table.foreign('user_name').references('name').inTable('t_user').onDelete('CASCADE');
      table.foreign('work_id').references('id').inTable('t_work').onDelete('CASCADE');
      table.primary(['user_name', 'work_id']);
    });
    for (const row of oldPlayHist) {
      await trx('t_play_histroy').insert({
        user_name: row.user_name,
        work_id: workIdMap.get(row.work_id) || formatID(row.work_id),
        created_at: row.created_at,
        updated_at: row.updated_at,
        state: row.state,
      });
    }

    // Update t_review.work_id in place (already TEXT, just needs padding)
    console.log(`  [3/4] Padding t_review.work_id...`);
    const oldReviews = await trx('t_review').select('*');
    for (const row of oldReviews) {
      const newWorkId = workIdMap.get(parseInt(row.work_id, 10)) || row.work_id;
      if (newWorkId !== row.work_id) {
        await trx('t_review').where('user_name', row.user_name).andWhere('work_id', row.work_id).update({ work_id: newWorkId });
      }
    }

    // ── Part B: Circle/tag/series ids → name-based UUID ──
    console.log('  [4/4] Rebuilding t_circle/t_tag/t_series with name-based UUID ids...');

    // --- t_circle ---
    const oldCircles = await trx('t_circle').select('*');
    const circleNameToUuid = new Map();
    const circleOldIdToNewId = new Map();
    for (const c of oldCircles) {
      const uuid = nameToUUID(c.name);
      circleNameToUuid.set(c.name, uuid);
      circleOldIdToNewId.set(c.id, uuid);
    }
    await trx.schema.dropTableIfExists('t_circle_tmp');
    await trx.schema.createTable('t_circle_tmp', (table) => {
      table.string('id').notNullable();
      table.string('name').notNullable();
      table.primary('id');
    });
    // Insert deduplicated by name
    const seenCircleNames = new Set();
    for (const c of oldCircles) {
      if (!seenCircleNames.has(c.name)) {
        seenCircleNames.add(c.name);
        await trx('t_circle_tmp').insert({
          id: circleNameToUuid.get(c.name),
          name: c.name,
        });
      }
    }
    await trx.schema.dropTableIfExists('t_circle');
    await trx.raw('ALTER TABLE t_circle_tmp RENAME TO t_circle');

    // Update t_work.circle_id to new UUID.
    // The rebuilt t_work still carries the old integer circle_id copied in Part A.
    const newWorks = await trx('t_work').select('id', 'circle_id');
    for (const w of newWorks) {
      const oldCircleId = parseInt(w.circle_id, 10);
      const newCircleUuid = circleOldIdToNewId.get(oldCircleId);
      if (newCircleUuid) {
        await trx('t_work').where('id', w.id).update({ circle_id: newCircleUuid });
      }
    }

    // --- t_tag ---
    const oldTags = await trx('t_tag').select('*');
    const tagNameToUuid = new Map();
    const tagOldIdToNewId = new Map();
    for (const t of oldTags) {
      const uuid = nameToUUID(t.name);
      tagNameToUuid.set(t.name, uuid);
      tagOldIdToNewId.set(t.id, uuid);
    }
    await trx.schema.dropTableIfExists('t_tag_tmp');
    await trx.schema.createTable('t_tag_tmp', (table) => {
      table.string('id').notNullable();
      table.string('name').notNullable();
      table.primary('id');
    });
    const seenTagNames = new Set();
    for (const t of oldTags) {
      if (!seenTagNames.has(t.name)) {
        seenTagNames.add(t.name);
        await trx('t_tag_tmp').insert({
          id: tagNameToUuid.get(t.name),
          name: t.name,
        });
      }
    }
    await trx.schema.dropTableIfExists('t_tag');
    await trx.raw('ALTER TABLE t_tag_tmp RENAME TO t_tag');

    // Update r_tag_work.tag_id to new UUID
    // (r_tag_work was rebuilt in Part A with the old integer tag_id)
    const curTagWork = await trx('r_tag_work').select('*');
    for (const row of curTagWork) {
      const newTagUuid = tagOldIdToNewId.get(row.tag_id);
      if (newTagUuid) {
        await trx('r_tag_work').where('tag_id', row.tag_id).andWhere('work_id', row.work_id).update({ tag_id: newTagUuid });
      }
    }

    // --- t_series ---
    const oldSeries = await trx('t_series').select('*');
    const seriesNameToUuid = new Map();
    const seriesOldIdToNewId = new Map();
    for (const s of oldSeries) {
      const uuid = nameToUUID(s.name);
      seriesNameToUuid.set(s.name, uuid);
      seriesOldIdToNewId.set(s.id, uuid);
    }
    await trx.schema.dropTableIfExists('t_series_tmp');
    await trx.schema.createTable('t_series_tmp', (table) => {
      table.string('id').notNullable();
      table.string('name').notNullable();
      table.primary('id');
    });
    const seenSeriesNames = new Set();
    for (const s of oldSeries) {
      if (!seenSeriesNames.has(s.name)) {
        seenSeriesNames.add(s.name);
        await trx('t_series_tmp').insert({
          id: seriesNameToUuid.get(s.name),
          name: s.name,
        });
      }
    }
    await trx.schema.dropTableIfExists('t_series');
    await trx.raw('ALTER TABLE t_series_tmp RENAME TO t_series');

    // Update r_series_work.series_id to new UUID
    const curSeriesWork = await trx('r_series_work').select('*');
    for (const row of curSeriesWork) {
      const newSeriesUuid = seriesOldIdToNewId.get(row.series_id);
      if (newSeriesUuid) {
        await trx('r_series_work').where('series_id', row.series_id).andWhere('work_id', row.work_id).update({ series_id: newSeriesUuid });
      }
    }

    // Clean up temp table if it somehow still exists
    await trx.schema.dropTableIfExists('t_work_tmp');

    // Verify referential integrity before committing; any violation rolls back
    // the entire migration, leaving the database untouched.
    const violations = await trx.raw('PRAGMA foreign_key_check');
    if (violations.length > 0) {
      throw new Error(`foreign_key_check failed after table rebuilds: ${JSON.stringify(violations.slice(0, 10))}`);
    }
  });

  await knex.raw('PRAGMA ignore_check_constraints=off');
  await knex.raw('PRAGMA foreign_keys=on');
  console.log('  Migration 20260802000000_text_ids_and_uuid_labels completed.');
};

exports.down = async function(knex) {
  // This is a destructive migration. Down is not supported.
  // To revert, restore from backup.
  console.warn('Down migration not implemented for 20260802000000_text_ids_and_uuid_labels');
};