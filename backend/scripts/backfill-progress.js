/**
 * Backfill script (Phase 1 + Phase 2):
 *
 * Phase 1 (unchanged): mark works as "listened" when the user's play history
 * indicates they finished the last track of the folder they played.
 *
 * Phase 2 (additive): seed t_track_progress for the last-played track of each
 * work-with-history, computing its SHA-256 content hash from the file on disk.
 *
 * Rule per (user_name, work_id) in t_play_history:
 *   - Parse state → {queue, index, seconds}.
 *   - Phase 1: skip if t_review.progress is already terminal; if state.index
 *     === state.queue.length - 1 AND seconds >= 0.95 * lastTrack.duration
 *     → set progress='listened'.
 *   - Phase 2: resolve state.queue[state.index].trackId to a file path, compute
 *     SHA-256, upsert t_track_progress with completed = seconds >= 0.95 * duration.
 *
 * Usage:
 *   node ./scripts/backfill-progress.js          # real run
 *   node ./scripts/backfill-progress.js --dry-run # preview only
 *
 * Also exported as runBackfill({ dryRun }) for the /api/backfill admin endpoint.
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'database', 'db'));
const { config } = require(path.join(__dirname, '..', 'config'));
const { getTrackList, getContentHash } = require(path.join(__dirname, '..', 'filesystem', 'utils'));

/**
 * Run the backfill. Collects log lines instead of writing to stdout so the
 * admin endpoint can return them to the UI. Returns { logs, summary }.
 * log(msg) pushes a plain string; callers that want console output wrap it.
 */
async function runBackfill({ dryRun = false, log = (m) => console.log(m) } = {}) {
  log(`[backfill-progress] Starting backfill${dryRun ? ' (DRY RUN)' : ''}`);
  log('');

  const historyRows = await db.knex('t_play_history').select('user_name', 'work_id', 'state');

  const workRows = await db.knex('t_work').select('id', 'root_folder', 'dir');
  const workDirMap = new Map();
  for (const w of workRows) {
    const rootFolder = config.rootFolders.find(rf => rf.name === w.root_folder);
    if (rootFolder) {
      workDirMap.set(w.id, path.join(rootFolder.path, w.dir));
    }
  }

  // Pre-fetch (user_name, work_id) pairs that already have a t_track_progress
  // row. Phase 2's expensive step is getContentHash (reads + SHA-256s the whole
  // file); once a work is seeded, the live player keeps its progress current,
  // so re-hashing on every backfill run is pure waste. Skip those here.
  const existingProgressRows = await db.knex('t_track_progress')
    .distinct('user_name', 'work_id');
  const existingProgress = new Set();
  for (const r of existingProgressRows) {
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
    const { queue, index, seconds } = parsed || {};
    if (!Array.isArray(queue) || typeof index !== 'number' || typeof seconds !== 'number') {
      continue;
    }

    // --- Phase 1: mark listened ---
    const existingReview = await db.knex('t_review')
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
      if (lastTrack && typeof lastTrack.duration === 'number' && lastTrack.duration > 0) {
        if (seconds >= 0.95 * lastTrack.duration) {
          if (!existingReview || !['listened', 'replay', 'postponed'].includes(existingReview.progress)) {
            if (dryRun) {
              log(`  [P1-DRY] ${username} / work ${workId} — last track "${lastTrack.title}" finished (${Math.round(seconds)}s / ${Math.round(lastTrack.duration)}s)`);
            } else {
              try {
                await db.updateUserReview(username, workId, null, '', 'listened', false, true, false);
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
    const currentTrack = queue[index];
    if (!currentTrack || !(currentTrack.trackId || currentTrack.hash)) {
      continue;
    }

    // Skip works already seeded — see existingProgress comment above. This
    // is the guard that keeps re-runs from re-hashing every audio file.
    if (existingProgress.has(`${username}\u0000${workId}`)) {
      summary.skippedAlreadySeeded++;
      continue;
    }

    const workDir = workDirMap.get(workId);
    if (!workDir) {
      summary.skippedNoDir++;
      continue;
    }

    let resolved;
    try {
      resolved = await resolveTrackFile(workId, currentTrack.trackId || currentTrack.hash, workDir);
    } catch {
      // File may not exist on disk
    }
    if (!resolved) {
      summary.p2SkippedNoFile++;
      if (dryRun) {
        log(`  [P2-DRY] ${username} / work ${workId} — file not found for trackId ${currentTrack.trackId || currentTrack.hash}, skipping`);
      }
      continue;
    }

    let contentHash;
    try {
      contentHash = await getContentHash(resolved.fullPath);
    } catch (err) {
      log(`  [P2-ERR] ${username} / work ${workId} — hash computation failed: ${err.message}`);
      continue;
    }

    const duration = currentTrack.duration || 0;
    const completed = duration > 0 && seconds >= 0.95 * duration;

    if (dryRun) {
      log(`  [P2-DRY] ${username} / work ${workId} — track "${resolved.title}" hash=${contentHash.slice(0, 12)}... completed=${completed} seconds=${Math.round(seconds)}`);
    } else {
      try {
        await db.upsertTrackProgress(username, workId, contentHash, seconds, completed);
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
  log(`    Skipped (already seeded): ${summary.skippedAlreadySeeded}`);
  log(`    Seeded track_progress: ${summary.p2Seeded}`);
  if (dryRun) {
    log('  (dry run — no writes performed)');
  }

  return summary;
}

module.exports = { runBackfill };

/**
 * Given a work id and track hash (format "${workId}/${index}"), resolve the
 * file path by listing and sorting the work's audio files the same way
 * Reuses getTrackList so the index maps to the exact same file the runtime
 * would — the sort that assigns hash=index is the source of truth, and
 * reimplementing it (e.g. with localeCompare) risks drift on edge cases.
 * Returns { fullPath, title } or null.
 */
async function resolveTrackFile(workId, trackId, workDir) {
  const idx = trackId.indexOf('/');
  if (idx === -1) return null;
  const index = parseInt(trackId.slice(idx + 1), 10);
  if (isNaN(index) || index < 0) return null;

  // getTrackList with an empty memo returns the sorted list with hash/title/
  // subtitle (durations/contentHash are memo-derived and absent, which is fine
  // here — we only need the path). No ffprobe I/O is triggered.
  const tracks = await getTrackList(workId, workDir, {});
  if (index >= tracks.length) return null;
  const track = tracks[index];
  // Reconstruct the absolute path the same way routes/media.js does.
  const fullPath = path.join(workDir, track.subtitle || '', track.title);
  return { fullPath, title: track.title };
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