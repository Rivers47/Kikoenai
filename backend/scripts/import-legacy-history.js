/**
 * One-off importer for play history from a kikoeru-project era database.
 *
 * That fork stored playback state as one row per *file* in `t_history`
 * (work_id, file_index, file_name, play_time, total_time). Number17's fork --
 * which this codebase descends from -- replaced it with `t_play_history`
 * (one JSON `state` blob per work) and, later, `t_track_progress` (one row per
 * track, keyed by the file's CRC32 content hash). No migration bridges the
 * two, so the old rows were simply orphaned.
 *
 * The bridge between the schemas is the file name. `t_history.file_name` is a
 * bare basename; `getTrackList` gives the current on-disk track list with
 * durations and content hashes. Matching is:
 *
 *   1. basename without extension, exact -- survives a re-encode of the whole
 *      library (.flac/.mp3 to .webm), which is what actually happened here.
 *   2. if that is ambiguous (the same track name under an SE-on and an SE-off
 *      folder), narrow by duration; if the duplicates are the same length,
 *      seed progress for *all* of them -- they are the same performance, and
 *      the user then resumes correctly whichever variant they open.
 *   3. if the name matches nothing, fall back to a unique duration match
 *      (within DURATION_EPS) against `total_time` -- catches renamed files.
 *
 * What gets written, per (user, work):
 *   - `t_track_progress`: one row per matched track. seconds = play_time,
 *     completed = play_time >= 0.95 * duration (the threshold the player and
 *     scripts/backfill-progress.js already use).
 *   - `t_play_history`: a `state` blob anchored on the most recently played
 *     track, with the queue rebuilt from that track's folder -- the same
 *     folder-scoped queue WorkTree builds and PUTs to /api/history. created_at
 *     and updated_at are carried over so the history list sorts by when the
 *     work was really played.
 *   - `t_review`: rating / review_text / progress from the old `t_review`,
 *     written only into fields that are currently empty.
 *
 * Nothing already in the current database is overwritten unless --overwrite is
 * passed: existing t_track_progress keys, t_play_history rows and non-empty
 * review fields are left alone, so the import is safe to re-run.
 *
 * No scan is required first. track_key is the file's CRC32, which the scanner
 * caches in t_work.memo.contentHash; where that cache is cold the import reads
 * the file and computes it (see resolveHash). Only the tracks the import
 * touches are read -- the legacy rows' own tracks, plus the rest of the folder
 * the play-history queue is built from -- so the cost tracks what the user
 * listened to, not the size of the library. On a cold library expect the run to
 * be I/O-bound rather than instant.
 *
 * Usage:
 *   node ./scripts/import-legacy-history.js ../old_sqlite/db.sqlite3 --dry-run
 *   node ./scripts/import-legacy-history.js ../old_sqlite/db.sqlite3
 *   node ./scripts/import-legacy-history.js <old.sqlite3> [--dry-run] [--overwrite]
 *                                           [--user <name>] [--map-user <old>=<new>]
 */

const path = require('path');
const Knex = require('knex');
const db = require(path.join(__dirname, '..', 'database', 'db'));
const { config } = require(path.join(__dirname, '..', 'config'));
const { getTrackList, getContentHash, formatID } = require(path.join(__dirname, '..', 'filesystem', 'utils'));

// Same threshold the player uses to call a track finished.
const COMPLETE_RATIO = 0.95;
// Tolerance when comparing an old integer total_time against a float duration.
// Re-encoding shifts durations by a second or two; past that it is a different
// file.
const DURATION_EPS = 2.5;

// toTree assigns every extension outside these three groups type 'audio', and
// WorkTree's queue is the audio nodes of one folder. Mirror that split here.
const NON_AUDIO_EXT = new Set([
  '.txt', '.lrc', '.srt', '.ass', '.vtt',
  '.jpg', '.jpeg', '.png', '.webp',
  '.pdf',
]);

const stem = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
};

/** Old ids were bare integers; the current schema stores them zero-padded. */
const toCanonicalId = (oldId) => formatID(parseInt(String(oldId), 10));

/**
 * Project a track onto the shape the frontend's toQueueItem() produces. The
 * queue is re-uploaded on every PUT /api/history, so it carries only what the
 * player reads back. mediaStreamUrl is deliberately omitted: it is derivable
 * from trackId, and a present-but-default value shadows the offline-copy
 * branch in AudioElement.
 */
const toQueueItem = (track, contentHash, workTitle) => ({
  trackId: track.trackId,
  contentHash,
  title: track.title,
  duration: track.duration,
  workTitle,
});

/**
 * CRC32 of a track's file, which is what t_track_progress.track_key holds.
 *
 * The scanner warms these into t_work.memo.contentHash, but this import must
 * work on a library that has not been rescanned since -- so an absent memo
 * entry means "compute it", not "skip the work". Only tracks the import
 * actually touches get read, so the cost scales with what the user listened to
 * rather than with the library.
 *
 * The path is reconstructed the way routes/media.js and backfill-progress.js
 * do it; getTrackList drops fullPath from the objects it returns.
 * Results are cached per run: an SE-on/SE-off pair and a track matched by two
 * legacy rows would otherwise be read twice.
 */
async function resolveHash(track, workDir, cache, summary, log) {
  if (track.contentHash) return track.contentHash;

  const fullPath = path.join(workDir, track.subtitle || '', track.title);
  if (cache.has(fullPath)) return cache.get(fullPath);

  let hash = null;
  try {
    hash = await getContentHash(fullPath);
    summary.hashesComputed++;
  } catch (err) {
    summary.hashFailed++;
    log(`  [HASH] cannot read ${fullPath}: ${err.message}`);
  }
  cache.set(fullPath, hash);
  return hash;
}

/**
 * Resolve one old history row to the current track(s) it refers to.
 * Returns an array -- a name present in both an SE-on and an SE-off folder
 * legitimately resolves to two tracks. Empty means no confident match.
 */
function matchTracks(oldRow, tracks) {
  const wanted = stem(oldRow.file_name);
  const byName = tracks.filter(t => stem(t.title) === wanted);

  if (byName.length === 1) return byName;

  if (byName.length > 1) {
    // Ambiguous name. If exactly one candidate has the right length, take it;
    // otherwise the duplicates are the same performance under a different mix
    // folder, and seeding all of them is both correct and more useful.
    const byDuration = byName.filter(t =>
      typeof t.duration === 'number' && Math.abs(t.duration - oldRow.total_time) <= DURATION_EPS);
    return byDuration.length === 1 ? byDuration : byName;
  }

  // No name match at all -- the file was renamed. Duration alone is enough
  // only if it is unique within the work.
  if (!oldRow.total_time) return [];
  const byDuration = tracks.filter(t =>
    typeof t.duration === 'number' && Math.abs(t.duration - oldRow.total_time) <= DURATION_EPS);
  return byDuration.length === 1 ? byDuration : [];
}

async function runImport({
  oldDbPath,
  dryRun = false,
  overwrite = false,
  userMap = {},
  onlyUser = null,
  log = (m) => console.log(m),
  dbApi = db,
} = {}) {
  // Read-only would be nicer, but knex's sqlite3 dialect ORs its own
  // OPEN_READWRITE | OPEN_CREATE into whatever `flags` you pass, and adding
  // OPEN_READONLY to those makes an illegal combination (SQLITE_MISUSE). Only
  // SELECTs are ever issued against this handle.
  const oldKnex = Knex({
    client: 'sqlite3',
    useNullAsDefault: true,
    connection: { filename: oldDbPath },
  });

  const summary = {
    historyRows: 0, matchedRows: 0, unmatchedRows: 0,
    worksTotal: 0, worksMissing: 0, worksNoDir: 0, worksFailed: 0,
    hashesComputed: 0, hashFailed: 0,
    progressWritten: 0, progressSkipped: 0,
    playHistoryWritten: 0, playHistorySkipped: 0,
    reviewsWritten: 0, reviewsSkipped: 0,
    dryRun,
  };

  // Keyed by absolute path, so the two mixes of one track and a track matched
  // by several legacy rows are each read at most once.
  const hashCache = new Map();

  try {
    log(`[import-legacy-history] Reading ${oldDbPath}${dryRun ? ' (DRY RUN)' : ''}`);

    let oldRows = await oldKnex('t_history')
      .select('user_name', 'work_id', 'file_name', 'play_time', 'total_time', 'created_at', 'updated_at');
    if (onlyUser) oldRows = oldRows.filter(r => r.user_name === onlyUser);
    summary.historyRows = oldRows.length;

    // Index the current library once: work row + resolved absolute directory.
    const workRows = await dbApi.knex('t_work').select('id', 'title', 'root_folder', 'dir', 'memo');
    const works = new Map(workRows.map(w => [w.id, w]));

    const existingProgress = new Set(
      (await dbApi.knex('t_track_progress').select('user_name', 'work_id', 'track_key'))
        .map(r => `${r.user_name}\u0000${r.work_id}\u0000${r.track_key}`));
    const existingHistory = new Set(
      (await dbApi.knex('t_play_history').select('user_name', 'work_id'))
        .map(r => `${r.user_name}\u0000${r.work_id}`));

    // Group by (user, work): one t_play_history row and one getTrackList call each.
    const groups = new Map();
    for (const row of oldRows) {
      const user = userMap[row.user_name] || row.user_name;
      const workId = toCanonicalId(row.work_id);
      const key = `${user}\u0000${workId}`;
      if (!groups.has(key)) groups.set(key, { user, workId, rows: [] });
      groups.get(key).rows.push(row);
    }
    summary.worksTotal = groups.size;

    for (const { user, workId, rows } of groups.values()) {
      const work = works.get(workId);
      if (!work) {
        summary.worksMissing++;
        log(`  [SKIP] work ${workId} -- not in the current library`);
        continue;
      }

      const rootFolder = config.rootFolders.find(rf => rf.name === work.root_folder);
      if (!rootFolder) {
        summary.worksNoDir++;
        log(`  [SKIP] work ${workId} -- root folder '${work.root_folder}' is not configured`);
        continue;
      }
      const workDir = path.join(rootFolder.path, work.dir);

      let memo;
      try {
        memo = work.memo ? JSON.parse(work.memo) : {};
      } catch {
        memo = {};
      }

      let tracks;
      try {
        tracks = (await getTrackList(workId, workDir, memo))
          .filter(t => !NON_AUDIO_EXT.has(t.ext));
      } catch (err) {
        summary.worksFailed++;
        log(`  [ERR ] work ${workId} -- cannot read ${workDir}: ${err.message}`);
        continue;
      }

      // --- t_track_progress: one row per matched track ---
      // Oldest first, so the final iteration also identifies the anchor.
      rows.sort((a, b) => String(a.updated_at).localeCompare(String(b.updated_at)));
      let anchor = null;
      let anchorRow = null;

      for (const row of rows) {
        const matched = matchTracks(row, tracks);
        if (!matched.length) {
          summary.unmatchedRows++;
          log(`  [MISS] work ${workId} -- no track matches "${row.file_name}" (${row.total_time}s)`);
          continue;
        }
        summary.matchedRows++;
        anchor = matched[0];
        anchorRow = row;

        for (const track of matched) {
          const contentHash = await resolveHash(track, workDir, hashCache, summary, log);
          if (!contentHash) {
            summary.progressSkipped++;
            continue;
          }
          const key = `${user}\u0000${workId}\u0000${contentHash}`;
          if (existingProgress.has(key) && !overwrite) {
            summary.progressSkipped++;
            continue;
          }
          const duration = typeof track.duration === 'number' ? track.duration : row.total_time;
          const completed = duration > 0 && row.play_time >= COMPLETE_RATIO * duration;

          if (dryRun) {
            log(`  [P-DRY] ${user} / ${workId} / ${track.title} -> ${row.play_time}s${completed ? ' (completed)' : ''}`);
          } else {
            await dbApi.upsertTrackProgress(user, workId, contentHash, row.play_time, completed);
            existingProgress.add(key);
          }
          summary.progressWritten++;
        }
      }

      // --- t_play_history: the "recently played" entry, anchored on the last
      // track the user actually played, with that folder's queue rebuilt. ---
      if (!anchor) continue;
      if (existingHistory.has(`${user}\u0000${workId}`) && !overwrite) {
        summary.playHistorySkipped++;
        continue;
      }

      // The queue must carry content hashes: the resume-from-history path
      // never refetches the tree, so a queue persisted without them can never
      // report per-track progress again (backend/AGENTS.md 6, "Tracks
      // response"). That means hashing the anchor's whole folder, not just the
      // tracks the legacy rows named.
      const queue = [];
      for (const t of tracks.filter(t => t.subtitle === anchor.subtitle)) {
        queue.push(toQueueItem(t, await resolveHash(t, workDir, hashCache, summary, log), work.title));
      }
      const index = queue.findIndex(q => q.trackId === anchor.trackId);
      if (index === -1) {
        summary.playHistorySkipped++;
        continue;
      }
      const state = JSON.stringify({ queue, index, seconds: anchorRow.play_time });

      if (dryRun) {
        log(`  [H-DRY] ${user} / ${workId} -- "${anchor.title}" ${index + 1}/${queue.length} @ ${anchorRow.play_time}s (${anchorRow.updated_at})`);
      } else {
        // Carry the original timestamps: the history list orders by
        // updated_at, so CURRENT_TIMESTAMP would file a 2023 session as today.
        await dbApi.knex.raw(
          `INSERT INTO t_play_history (user_name, work_id, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_name, work_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at`,
          [user, workId, state, rows[0].created_at, anchorRow.updated_at]);
        existingHistory.add(`${user}\u0000${workId}`);
      }
      summary.playHistoryWritten++;
    }

    // --- t_review: ratings, review text and progress, filling gaps only ---
    let oldReviews = await oldKnex('t_review')
      .select('user_name', 'work_id', 'rating', 'review_text', 'progress');
    if (onlyUser) oldReviews = oldReviews.filter(r => r.user_name === onlyUser);

    for (const r of oldReviews) {
      const user = userMap[r.user_name] || r.user_name;
      const workId = toCanonicalId(r.work_id);
      if (!works.has(workId)) continue;

      const rating = r.rating || null;             // old rows use 0 for "unrated"
      const reviewText = r.review_text || '';
      const progress = r.progress || null;
      if (rating === null && !reviewText && progress === null) continue;

      const current = await dbApi.knex('t_review')
        .select('rating', 'review_text', 'progress')
        .where({ user_name: user, work_id: workId }).first();

      // Never clobber something the user has set since. Each field is filled
      // independently, so a work that already has a rating can still receive
      // its old progress.
      const keep = (currentValue, oldValue) =>
        (overwrite ? (oldValue ?? currentValue) : (currentValue ?? oldValue));
      const merged = {
        rating: keep(current && current.rating !== null ? current.rating : null, rating),
        review_text: keep(current && current.review_text ? current.review_text : null, reviewText) || '',
        progress: keep(current && current.progress ? current.progress : null, progress),
      };
      if (current
        && merged.rating === (current.rating ?? null)
        && merged.review_text === (current.review_text || '')
        && merged.progress === (current.progress ?? null)) {
        summary.reviewsSkipped++;
        continue;
      }

      if (dryRun) {
        log(`  [R-DRY] ${user} / ${workId} -- rating=${merged.rating} progress=${merged.progress || '-'}`);
      } else {
        await dbApi.updateUserReview(user, workId, merged.rating, merged.review_text, merged.progress, false, false, false);
      }
      summary.reviewsWritten++;
    }

    log('');
    log('[import-legacy-history] Done.');
    log(`  Old history rows:        ${summary.historyRows}`);
    log(`    matched to a track:    ${summary.matchedRows}`);
    log(`    unmatched:             ${summary.unmatchedRows}`);
    log(`  Works seen:              ${summary.worksTotal}`);
    log(`    not in library:        ${summary.worksMissing}`);
    log(`    root folder missing:   ${summary.worksNoDir}`);
    log(`    unreadable on disk:    ${summary.worksFailed}`);
    log(`  Hashes computed:         ${summary.hashesComputed} (${summary.hashFailed} unreadable)`);
    log(`  t_track_progress rows:   ${summary.progressWritten} written, ${summary.progressSkipped} skipped`);
    log(`  t_play_history rows:     ${summary.playHistoryWritten} written, ${summary.playHistorySkipped} skipped`);
    log(`  t_review rows:           ${summary.reviewsWritten} written, ${summary.reviewsSkipped} skipped`);
    if (dryRun) log('  (dry run -- no writes performed)');

    return summary;
  } finally {
    await oldKnex.destroy();
  }
}

module.exports = { runImport };

// CLI entry
if (require.main === module) {
  const args = process.argv.slice(2);
  const oldDbPath = args.find(a => !a.startsWith('--'));
  if (!oldDbPath) {
    console.error('Usage: node ./scripts/import-legacy-history.js <old-db.sqlite3> [--dry-run] [--overwrite] [--user <name>] [--map-user <old>=<new>]');
    process.exit(1);
  }
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? null : args[i + 1];
  };
  const userMap = {};
  args.forEach((a, i) => {
    if (a === '--map-user' && args[i + 1]) {
      const [from, to] = args[i + 1].split('=');
      if (from && to) userMap[from] = to;
    }
  });

  runImport({
    oldDbPath: path.resolve(oldDbPath),
    dryRun: args.includes('--dry-run'),
    overwrite: args.includes('--overwrite'),
    onlyUser: valueOf('--user'),
    userMap,
  })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[import-legacy-history] Fatal error:', err);
      process.exit(1);
    });
}
