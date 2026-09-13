/**
 * Backfill script (Phase 1 + Phase 2):
 *
 * Phase 1: mark works as "listened" when the user's play history indicates
 * they finished the last track of the folder they played.
 *
 * Phase 2: seed t_track_progress for the last-played track of each
 * work-with-history, keyed by the work-relative path its queue item resolves to.
 *
 * Rule per (user_name, work_id) in t_play_history:
 *   - Parse state → {queue, index} (+ seconds on legacy rows).
 *   - Resolve the position of the parked track: state.seconds if the row still
 *     carries one, otherwise t_track_progress for that (user, work, relPath).
 *     History rows written since the play-history / track-progress split hold no
 *     seconds at all — requiring one here made the whole script a no-op on them.
 *   - Phase 1: skip if t_review.progress is already terminal; if state.index
 *     === state.queue.length - 1 AND the track is finished (its progress row is
 *     flagged completed, or seconds >= 0.95 * lastTrack.duration)
 *     → set progress='listened'.
 *   - Phase 2: seed t_track_progress for legacy rows only — resolve the queue
 *     item's trackId to a relPath, then upsert with
 *     completed = seconds >= 0.95 * duration. Reads no files.
 *
 * Usage:
 *   node ./scripts/backfill-progress.js          # real run
 *   node ./scripts/backfill-progress.js --dry-run # preview only
 *
 * Also exported as runBackfill({ dryRun }).
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'database', 'db'));
const { config } = require(path.join(__dirname, '..', 'config'));
const { listWorkTracks } = require(path.join(__dirname, '..', 'filesystem', 'workFiles'));

/**
 * Run the backfill. Collects log lines instead of writing to stdout so the
 * admin endpoint can return them to the UI. Returns { logs, summary }.
 * log(msg) pushes a plain string; callers that want console output wrap it.
 * dbApi defaults to the live database module; tests pass { knex, ...makeQueries(knex) }
 * over an in-memory database.
 */
async function runBackfill({ dryRun = false, log = (m) => console.log(m), dbApi = db } = {}) {
  log(`[backfill-progress] Starting backfill${dryRun ? ' (DRY RUN)' : ''}`);
  log('');

  const historyRows = await dbApi.knex('t_play_history').select('user_name', 'work_id', 'state');

  const workRows = await dbApi.knex('t_work').select('id', 'root_folder', 'dir');
  const workDirMap = new Map();
  for (const w of workRows) {
    const rootFolder = config.rootFolders.find(rf => rf.name === w.root_folder);
    if (rootFolder) {
      workDirMap.set(w.id, path.join(rootFolder.path, w.dir));
    }
  }

  // Pre-fetch every t_track_progress row, indexed two ways. byTrack answers
  // "where is this user parked in this track", which is the only place a
  // position lives for history rows written after the play-history /
  // track-progress split. existingProgress answers "is this work seeded":
  // once a work is seeded the live player keeps its progress current, so
  // redoing it on every backfill run is pure waste. Skip those here.
  const progressRows = await dbApi.knex('t_track_progress')
    .select('user_name', 'work_id', 'track_key', 'seconds', 'completed');
  const byTrack = new Map();
  const existingProgress = new Set();
  for (const r of progressRows) {
    byTrack.set(`${r.user_name}\u0000${r.work_id}\u0000${r.track_key}`, r);
    existingProgress.add(`${r.user_name}\u0000${r.work_id}`);
  }

  const summary = {
    total: 0,
    skippedTerminal: 0,
    skippedNoDuration: 0,
    skippedNoDir: 0,
    skippedAlreadySeeded: 0,
    marked: 0,
    p2Seeded: 0,
    p2SkippedNoFile: 0,
    p2SkippedNoSeconds: 0,
    dryRun
  };

  for (const row of historyRows) {
    summary.total++;
    const { user_name: username, work_id: workId, state } = row;

    let parsed;
    try {
      parsed = JSON.parse(state);
    } catch {
      continue;
    }
    const { queue, index } = parsed || {};
    if (!Array.isArray(queue) || typeof index !== 'number') {
      continue;
    }
    const currentTrack = queue[index];

    // Position of the parked track. Legacy rows carry state.seconds; current
    // ones keep it in t_track_progress, keyed by the track's relPath.
    // null means "unknown" — both phases fall back rather than skipping the row.
    const parkedRelPath = currentTrack
      ? await resolveRelPath(workId, currentTrack.trackId || currentTrack.hash, workDirMap.get(workId), dbApi)
      : null;
    const trackProgress = parkedRelPath
      ? byTrack.get(`${username}\u0000${workId}\u0000${parkedRelPath}`)
      : undefined;
    let seconds = null;
    if (typeof parsed.seconds === 'number') {
      seconds = parsed.seconds;
    } else if (trackProgress && typeof trackProgress.seconds === 'number') {
      seconds = trackProgress.seconds;
    }

    // --- Phase 1: mark listened ---
    const existingReview = await dbApi.knex('t_review')
      .select('progress')
      .where('user_name', '=', username)
      .andWhere('work_id', '=', workId)
      .first();
    if (existingReview && ['listened', 'replay', 'postponed'].includes(existingReview.progress)) {
      summary.skippedTerminal++;
      // Still fall through to Phase 2 below
    }

    if (index === queue.length - 1) {
      const lastTrack = queue[queue.length - 1];
      // The player already decides "finished" when it writes a progress row, so
      // its completed flag settles it on its own — the duration comparison is
      // the fallback for legacy rows, whose seconds is all we have.
      const completedFlag = !!(trackProgress && trackProgress.completed);
      const hasDuration = !!(lastTrack && typeof lastTrack.duration === 'number' && lastTrack.duration > 0);
      if (completedFlag || hasDuration) {
        if (completedFlag || (seconds !== null && seconds >= 0.95 * lastTrack.duration)) {
          if (!existingReview || !['listened', 'replay', 'postponed'].includes(existingReview.progress)) {
            if (dryRun) {
              const position = seconds === null ? '?' : Math.round(seconds);
              const total = hasDuration ? Math.round(lastTrack.duration) : '?';
              log(`  [P1-DRY] ${username} / work ${workId} — last track "${lastTrack.title}" finished (${position}s / ${total}s)`);
            } else {
              try {
                await dbApi.updateUserReview(username, workId, null, '', 'listened', false, true, false);
                log(`  [P1-OK]  ${username} / work ${workId} — marked as listened`);
              } catch (err) {
                log(`  [P1-ERR] ${username} / work ${workId} — ${err.message}`);
              }
            }
            summary.marked++;
          }
        }
      } else {
        summary.skippedNoDuration++;
      }
    }

    // --- Phase 2: seed t_track_progress for the last-played track ---
    if (!currentTrack || !(currentTrack.trackId || currentTrack.hash)) {
      continue;
    }
    // Skip works already seeded — see existingProgress comment above.
    if (existingProgress.has(`${username}\u0000${workId}`)) {
      summary.skippedAlreadySeeded++;
      continue;
    }

    // Nothing to seed: no stored position and no progress row to copy one from.
    if (seconds === null) {
      summary.p2SkippedNoSeconds++;
      continue;
    }

    // track_key is the work-relative path, which the queue item's own trackId
    // already carries — a legacy `workId/index` handle is resolved through the
    // same sorted file list the runtime uses. No file is ever read.
    if (!parkedRelPath) {
      summary.p2SkippedNoFile++;
      if (dryRun) {
        log(`  [P2-DRY] ${username} / work ${workId} — could not resolve trackId ${currentTrack.trackId || currentTrack.hash}, skipping`);
      }
      continue;
    }
    const trackTitle = currentTrack.title || parkedRelPath;

    const duration = currentTrack.duration || 0;
    const completed = duration > 0 && seconds >= 0.95 * duration;

    if (dryRun) {
      log(`  [P2-DRY] ${username} / work ${workId} — track "${trackTitle}" relPath=${parkedRelPath} completed=${completed} seconds=${Math.round(seconds)}`);
    } else {
      try {
        await dbApi.upsertTrackProgress(username, workId, parkedRelPath, seconds, completed);
        log(`  [P2-OK]  ${username} / work ${workId} — seeded track_progress (${completed ? 'completed' : 'partial'}, ${Math.round(seconds)}s)`);
      } catch (err) {
        log(`  [P2-ERR] ${username} / work ${workId} — upsert failed: ${err.message}`);
      }
    }
    summary.p2Seeded++;
  }

  log('');
  log('[backfill-progress] Done.');
  log(`  Total processed:     ${summary.total}`);
  log('  Phase 1:');
  log(`    Skipped (terminal):  ${summary.skippedTerminal}`);
  log(`    Skipped (no duration): ${summary.skippedNoDuration}`);
  log(`    Marked as listened:  ${summary.marked}`);
  log('  Phase 2:');
  log(`    Skipped (no dir):     ${summary.skippedNoDir}`);
  log(`    Skipped (no file):    ${summary.p2SkippedNoFile}`);
  log(`    Skipped (no position): ${summary.p2SkippedNoSeconds}`);
  log(`    Skipped (already seeded): ${summary.skippedAlreadySeeded}`);
  log(`    Seeded track_progress: ${summary.p2Seeded}`);
  if (dryRun) {
    log('  (dry run — no writes performed)');
  }

  return summary;
}

module.exports = { runBackfill };

/**
 * Resolve a stored track handle to the work-relative path that keys
 * t_track_progress.
 *
 * A current handle is `${workId}/${relPath}` and needs no lookup. A legacy one
 * is `${workId}/${index}`, and the index is resolved through listWorkTracks so it
 * maps to the exact same file the runtime would pick — the sort that assigned
 * the index is the source of truth, and reimplementing it risks drift.
 * Returns the relPath, or null.
 */
async function resolveRelPath(workId, trackId, workDir, dbApi) {
  if (!trackId) return null;
  const slash = trackId.indexOf('/');
  if (slash === -1) return null;
  const tail = trackId.slice(slash + 1);

  // Anything but a bare index is already the path (a tracked file always has an
  // extension, so a pure-digit single segment cannot be one).
  if (!/^\d+$/.test(tail)) return tail;
  if (!workDir) return null;

  const index = parseInt(tail, 10);
  if (isNaN(index) || index < 0) return null;
  // From t_work_file; only the sorted paths are needed here.
  const tracks = await listWorkTracks(workId, workDir, { dbApi });
  if (index >= tracks.length) return null;
  return tracks[index].shortFilePath;
}

// CLI entry: node ./scripts/backfill-progress.js [--dry-run]
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  runBackfill({ dryRun, log: (m) => console.log(m) })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[backfill-progress] Fatal error:', err);
      process.exit(1);
    });
}