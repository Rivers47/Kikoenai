exports.up = async function(knex) {
  await knex.raw('DROP VIEW IF EXISTS staticMetadata');
};

exports.down = async function(knex) {
  // Recreate the view (verbatim from 20260731075621_add_illustrator_script_writer_series.js up)
  await knex.raw(`
    CREATE VIEW IF NOT EXISTS staticMetadata AS
    SELECT baseQueryWithExtra.*,
      json_object('tags', json_group_array(json_object('id', t_tag.id, 'name', t_tag.name))) AS tagObj
    FROM (
      SELECT baseQueryWithVA.*,
        json_object('illustrators', json_group_array(DISTINCT json_object('id', t_illustrator.id, 'name', t_illustrator.name))) AS illustratorObj,
        json_object('scriptWriters', json_group_array(DISTINCT json_object('id', t_script_writer.id, 'name', t_script_writer.name))) AS scriptWriterObj,
        json_object('series', json_group_array(DISTINCT json_object('id', t_series.id, 'name', t_series.name))) AS seriesObj
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
      LEFT JOIN r_illustrator_work ON r_illustrator_work.work_id = baseQueryWithVA.id
      LEFT JOIN t_illustrator ON t_illustrator.id = r_illustrator_work.illustrator_id
      LEFT JOIN r_script_writer_work ON r_script_writer_work.work_id = baseQueryWithVA.id
      LEFT JOIN t_script_writer ON t_script_writer.id = r_script_writer_work.script_writer_id
      LEFT JOIN r_series_work ON r_series_work.work_id = baseQueryWithVA.id
      LEFT JOIN t_series ON t_series.id = r_series_work.series_id
      GROUP BY baseQueryWithVA.id
    ) AS baseQueryWithExtra
    LEFT JOIN r_tag_work ON r_tag_work.work_id = baseQueryWithExtra.id
    LEFT JOIN t_tag ON t_tag.id = r_tag_work.tag_id
    GROUP BY baseQueryWithExtra.id;
  `);
};