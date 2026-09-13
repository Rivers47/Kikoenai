/**
 * Move a work's file listing into the database.
 *
 * It used to be rebuilt from disk on every request. `getTrackList` walks the
 * work folder, and `resolveTrack` calls it -- so every stream, download,
 * check-lrc and track-progress write cost a directory walk, not just the work
 * page. On a network mount that is latency times file count, on works that run
 * to hundreds of files.
 *
 * The listing now lives in t_work_file, written by the scan paths. The scan
 * button already existed for the expensive half (ffprobe durations); it now
 * maintains the listing too.
 *
 * **This migration reads no files.** t_work.memo already holds `duration`,
 * `mtime` and `trackTitles` keyed by relPath, so seeding is pure data movement
 * -- which is the whole point of seeding rather than starting empty: re-probing
 * a library with ffprobe is hours of work.
 *
 * memo covers audio only (scrapeWorkMemo filters to supportedMediaExtList), so
 * lyrics, images and PDFs are missing from the seed. `files_indexed_at` is left
 * NULL for every work, and the first read of each one completes the listing
 * with a single walk -- exactly what every read does today, and then never
 * again. See filesystem/workFiles.js.
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
