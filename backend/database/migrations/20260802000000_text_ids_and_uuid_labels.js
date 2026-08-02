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
    // Drop leftover tables from features that were removed from the codebase
    // without a DROP migration. t_translate_task (AI translation, removed in
    // 7703841) has an integer work_id FK to t_work whose values dangle once
    // t_work.id becomes padded TEXT.
    await trx.raw('DROP TABLE IF EXISTS t_translate_task');

    // ── Part A: Work id → TEXT ──

    const oldWorks = await trx('t_work').select('*');
    console.log(`  [1/4] Rebuilding t_work with TEXT ids (${oldWorks.length} works)...`);

    // Old id -> new padded TEXT id. Keys are normalized to strings because the
    // same work id reads back as a number from INTEGER columns and as a string
    // from TEXT columns (e.g. t_review.work_id).
    const workIdMap = new Map();
    for (const w of oldWorks) {
      workIdMap.set(String(w.id), formatID(w.id));
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
    for (const oldRow of oldWorks) {
      await trx('t_work_tmp').insert({
        id: workIdMap.get(String(oldRow.id)),
        created_at: oldRow.created_at,
        updated_at: oldRow.updated_at,
        root_folder: oldRow.root_folder,
        dir: oldRow.dir,
        title: oldRow.title,
        circle_id: oldRow.circle_id, // will be remapped to a UUID in Part B
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

    await trx.schema.dropTableIfExists('t_work');
    await trx.raw('ALTER TABLE t_work_tmp RENAME TO t_work');

    console.log('  [2/4] Rebuilding work_id FK tables (r_*_work, t_play_histroy)...');

    // Foreign keys were not enforced in all eras (the migration connection has
    // them off), so link tables can contain rows pointing at deleted works or
    // labels. Those orphan rows are dropped here and counted for the log.
    let droppedLinks = 0;
    const rebuildLinkTable = async (tableName, labelTable, labelCol, cascade) => {
      const labelIds = new Set((await trx(labelTable).select('id')).map((r) => String(r.id)));
      const oldRows = await trx(tableName).select('*');
      await trx.schema.dropTableIfExists(tableName);
      await trx.schema.createTable(tableName, (table) => {
        table.string(labelCol);
        table.string('work_id');
        const labelFk = table.foreign(labelCol).references('id').inTable(labelTable);
        const workFk = table.foreign('work_id').references('id').inTable('t_work');
        if (cascade) {
          labelFk.onUpdate('CASCADE').onDelete('CASCADE');
          workFk.onUpdate('CASCADE').onDelete('CASCADE');
        }
        table.primary([labelCol, 'work_id']);
      });
      for (const row of oldRows) {
        const newWorkId = workIdMap.get(String(row.work_id));
        if (!newWorkId || !labelIds.has(String(row[labelCol]))) {
          droppedLinks += 1; // orphan: referenced work or label no longer exists
          continue;
        }
        await trx(tableName).insert({ [labelCol]: row[labelCol], work_id: newWorkId });
      }
    };

    await rebuildLinkTable('r_tag_work', 't_tag', 'tag_id', false);
    await rebuildLinkTable('r_va_work', 't_va', 'va_id', true);
    await rebuildLinkTable('r_illustrator_work', 't_illustrator', 'illustrator_id', true);
    await rebuildLinkTable('r_script_writer_work', 't_script_writer', 'script_writer_id', true);
    await rebuildLinkTable('r_series_work', 't_series', 'series_id', true);
    if (droppedLinks > 0) {
      console.log(`  ! Dropped ${droppedLinks} orphan link row(s) referencing missing works or labels`);
    }

    // Existing users, for orphan detection in t_play_histroy / t_review
    // (both reference t_user.name).
    const userNames = new Set((await trx('t_user').select('name')).map((u) => u.name));

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
    let droppedHistory = 0;
    for (const row of oldPlayHist) {
      const newWorkId = workIdMap.get(String(row.work_id));
      if (!newWorkId || !userNames.has(row.user_name)) {
        droppedHistory += 1; // orphan: referenced work or user no longer exists
        continue;
      }
      await trx('t_play_histroy').insert({
        user_name: row.user_name,
        work_id: newWorkId,
        created_at: row.created_at,
        updated_at: row.updated_at,
        state: row.state,
      });
    }
    if (droppedHistory > 0) {
      console.log(`  ! Dropped ${droppedHistory} t_play_histroy row(s) referencing missing works`);
    }

    // Update t_review.work_id in place (already TEXT, just needs padding).
    // Reviews of deleted works are dropped, matching the ON DELETE CASCADE FK.
    console.log('  [3/4] Padding t_review.work_id...');
    const oldReviews = await trx('t_review').select('*');
    let droppedReviews = 0;
    for (const row of oldReviews) {
      const newWorkId = workIdMap.get(String(row.work_id));
      if (!newWorkId || !userNames.has(row.user_name)) {
        // Review of a deleted work or user, matching the ON DELETE CASCADE FKs.
        await trx('t_review').where('user_name', row.user_name).andWhere('work_id', row.work_id).del();
        droppedReviews += 1;
      } else if (newWorkId !== String(row.work_id)) {
        await trx('t_review').where('user_name', row.user_name).andWhere('work_id', row.work_id).update({ work_id: newWorkId });
      }
    }
    if (droppedReviews > 0) {
      console.log(`  ! Dropped ${droppedReviews} t_review row(s) referencing missing works`);
    }

    // ── Part B: Circle/tag/series ids → name-based UUID ──
    console.log('  [4/4] Rebuilding t_circle/t_tag/t_series with name-based UUID ids...');

    // --- t_circle ---
    const oldCircles = await trx('t_circle').select('*');
    // Works whose circle_id dangles (FK not always enforced): create a
    // placeholder circle so the work is preserved and the FK resolves.
    const knownCircleIds = new Set(oldCircles.map((c) => String(c.id)));
    const missingCircleIds = [...new Set(oldWorks.map((w) => String(w.circle_id)))]
      .filter((id) => !knownCircleIds.has(id));
    for (const id of missingCircleIds) {
      console.log(`  ! circle_id ${id} has no t_circle row; creating a placeholder circle`);
      oldCircles.push({ id, name: `Unknown circle #${id}` });
    }

    const circleNameToUuid = new Map();
    const circleOldIdToNewId = new Map();
    for (const c of oldCircles) {
      const uuid = nameToUUID(c.name);
      circleNameToUuid.set(c.name, uuid);
      circleOldIdToNewId.set(String(c.id), uuid);
    }
    await trx.schema.dropTableIfExists('t_circle_tmp');
    await trx.schema.createTable('t_circle_tmp', (table) => {
      table.string('id').notNullable();
      table.string('name').notNullable();
      table.primary('id');
    });
    // Insert deduplicated by name (same name -> same UUID -> one row)
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

    // Update t_work.circle_id (still the old integer id copied in Part A) to the new UUID
    const newWorks = await trx('t_work').select('id', 'circle_id');
    for (const w of newWorks) {
      const newCircleUuid = circleOldIdToNewId.get(String(w.circle_id));
      if (newCircleUuid) {
        await trx('t_work').where('id', w.id).update({ circle_id: newCircleUuid });
      }
    }

    // --- t_tag / t_series ---
    // Labels with duplicate names merge into one UUID row; their link rows are
    // rebuilt with dedup so merged labels don't violate the composite PK.
    const rebuildLabelTable = async (labelTable, linkTable, labelCol) => {
      const oldLabels = await trx(labelTable).select('*');
      const nameToUuid = new Map();
      const oldIdToNewId = new Map();
      for (const l of oldLabels) {
        const uuid = nameToUUID(l.name);
        nameToUuid.set(l.name, uuid);
        oldIdToNewId.set(String(l.id), uuid);
      }
      await trx.schema.dropTableIfExists(`${labelTable}_tmp`);
      await trx.schema.createTable(`${labelTable}_tmp`, (table) => {
        table.string('id').notNullable();
        table.string('name').notNullable();
        table.primary('id');
      });
      const seenNames = new Set();
      for (const l of oldLabels) {
        if (!seenNames.has(l.name)) {
          seenNames.add(l.name);
          await trx(`${labelTable}_tmp`).insert({ id: nameToUuid.get(l.name), name: l.name });
        }
      }
      await trx.schema.dropTableIfExists(labelTable);
      await trx.raw(`ALTER TABLE ${labelTable}_tmp RENAME TO ${labelTable}`);

      // Rebuild the link table with UUID label ids (r_*_work was rebuilt in
      // Part A with the old label ids)
      const oldLinks = await trx(linkTable).select('*');
      await trx.schema.dropTableIfExists(linkTable);
      await trx.schema.createTable(linkTable, (table) => {
        table.string(labelCol);
        table.string('work_id');
        const labelFk = table.foreign(labelCol).references('id').inTable(labelTable);
        const workFk = table.foreign('work_id').references('id').inTable('t_work');
        if (linkTable !== 'r_tag_work') {
          labelFk.onUpdate('CASCADE').onDelete('CASCADE');
          workFk.onUpdate('CASCADE').onDelete('CASCADE');
        }
        table.primary([labelCol, 'work_id']);
      });
      const seenLinks = new Set();
      for (const row of oldLinks) {
        const uuid = oldIdToNewId.get(String(row[labelCol]));
        if (!uuid) continue; // orphan (already dropped in Part A, but be safe)
        const key = `${uuid}${row.work_id}`;
        if (seenLinks.has(key)) continue; // duplicate label name merged into one row
        seenLinks.add(key);
        await trx(linkTable).insert({ [labelCol]: uuid, work_id: row.work_id });
      }
    };

    await rebuildLabelTable('t_tag', 'r_tag_work', 'tag_id');
    await rebuildLabelTable('t_series', 'r_series_work', 'series_id');

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
