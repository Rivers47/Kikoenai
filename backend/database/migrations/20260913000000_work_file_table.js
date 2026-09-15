/**
 * Cache a work's file tree in database.
 * t_work_file new column, populated from t_work.memo
 */

exports.up = async function (knex) {
  if (!(await knex.schema.hasColumn('t_work', 'files_indexed_at'))) {
    await knex.schema.alterTable('t_work', (table) => {
      table.datetime('files_indexed_at');
    });
  }

  if (!(await knex.schema.hasTable('t_work_file'))) {
    await knex.schema.createTable('t_work_file', (table) => {
      table.string('work_id').notNullable();
      table.string('rel_path').notNullable();
      table.float('duration');
      table.integer('mtime');
      table.string('track_title');

      table.foreign('work_id').references('id').inTable('t_work').onDelete('CASCADE');
      table.primary(['work_id', 'rel_path']);
    });
  }

  const works = await knex('t_work').select('id', 'memo');
  let seededWorks = 0;
  let seededRows = 0;

  for (const work of works) {
    let memo;
    try {
      memo = JSON.parse(work.memo || '{}') || {};
    } catch {
      continue;
    }
    const duration = memo.duration || {};
    const mtime = memo.mtime || {};
    const trackTitles = memo.trackTitles || {};

    // Every relPath any of the three maps knows about.
    const relPaths = new Set([
      ...Object.keys(duration),
      ...Object.keys(mtime),
      ...Object.keys(trackTitles),
    ]);
    if (!relPaths.size) continue;

    const rows = [...relPaths].map((relPath) => ({
      work_id: work.id,
      // Normalize the way getTrackList does. A memo written by a Windows server
      // holds backslashes, and this column has to match the trackId spelling.
      rel_path: String(relPath).split('\\').join('/'),
      duration: typeof duration[relPath] === 'number' ? duration[relPath] : null,
      mtime: typeof mtime[relPath] === 'number' ? mtime[relPath] : null,
      track_title: trackTitles[relPath] || null,
    }));

    // Chunked: SQLite caps bound parameters per statement, and a 472-file work
    // times five columns gets close enough to matter.
    for (let i = 0; i < rows.length; i += 100) {
      await knex('t_work_file').insert(rows.slice(i, i + 100)).onConflict(['work_id', 'rel_path']).merge();
    }
    seededWorks += 1;
    seededRows += rows.length;
  }

  console.log(
    `[work-file-table] seeded ${seededRows} file rows across ${seededWorks} works from memo; `
    + 'files_indexed_at left NULL so each work completes its listing on first read'
  );
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('t_work_file');
  if (await knex.schema.hasColumn('t_work', 'files_indexed_at')) {
    await knex.schema.alterTable('t_work', (table) => {
      table.dropColumn('files_indexed_at');
    });
  }
};
