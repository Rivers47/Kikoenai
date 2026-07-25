exports.up = async function(knex) {
  // Check if lyric_status column still exists (from closed-source db)
  const hasColumn = await knex.schema.hasColumn('t_work', 'lyric_status');
  if (hasColumn) {
    // Recreate t_work table without lyric_status column
    await knex.raw('PRAGMA foreign_keys=off');
    await knex.raw('PRAGMA ignore_check_constraints=on');

    await knex.transaction(async (trx) => {
      await trx.raw('DROP INDEX IF EXISTS t_work_index');

      await trx.schema.createTable('t_work_new', (table) => {
        table.increments();
        table.datetime('created_at').notNullable().defaultTo(trx.raw('CURRENT_TIMESTAMP'));
        table.datetime('updated_at').notNullable().defaultTo(trx.raw('CURRENT_TIMESTAMP'));
        table.string('root_folder', 255).notNullable();
        table.string('dir', 255).notNullable();
        table.string('title', 255).notNullable();
        table.integer('circle_id').notNullable();
        table.boolean('nsfw');
        table.string('release', 255);
        table.integer('dl_count');
        table.integer('price');
        table.integer('review_count');
        table.integer('rate_count');
        table.float('rate_average_2dp');
        table.text('rate_count_detail');
        table.text('rank');
        table.integer('original_work_id').notNullable().defaultTo(0);
        table.json('memo');
        table.integer('is_custom_meta').defaultTo(0);

        table.foreign('circle_id').references('id').inTable('t_circle');
        table.index(['circle_id', 'release', 'dl_count', 'review_count', 'price', 'rate_average_2dp'], 't_work_index');
      });

      await trx.raw(`INSERT INTO t_work_new (id, created_at, updated_at, root_folder, dir, title, circle_id, nsfw, release, dl_count, price, review_count, rate_count, rate_average_2dp, rate_count_detail, rank, original_work_id, memo, is_custom_meta) SELECT id, created_at, updated_at, root_folder, dir, title, circle_id, nsfw, release, dl_count, price, review_count, rate_count, rate_average_2dp, rate_count_detail, rank, original_work_id, memo, is_custom_meta FROM t_work`);

      await trx.raw('DROP TABLE t_work');
      await trx.raw('ALTER TABLE t_work_new RENAME TO t_work');
    });

    await knex.raw('PRAGMA ignore_check_constraints=off');
    await knex.raw('PRAGMA foreign_keys=on');
  }

  // Recreate the view (open-source definition, without lyric_status)
  await createOrReplaceStaticMetadata(knex);
};

exports.down = async function(knex) {
  console.log('Cannot revert: lyric_status column removal is irreversible.');
};

async function createOrReplaceStaticMetadata(knex) {
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