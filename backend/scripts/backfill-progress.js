/**
 * Backfill script (Phase 1 + Phase 2):
 *
 * Phase 1 (unchanged): mark works as "listened" when the user's play history
 * indicates they finished the last track of the folder they played.
 *
 * Phase 2 (additive): seed t_track_progress for the last-played track of each
 * work-with-history, computing its SHA-256 content hash from the file on disk.
 *
 * Rule per (user_name, work_id) in t_play_histroy:
 *   - Parse state → {queue, index, seconds}.
 *   - Phase 1: skip if t_review.progress is already terminal; if state.index
 *     === state.queue.length - 1 AND seconds >= 0.95 * lastTrack.duration
 *     → set progress='listened'.
 *   - Phase 2: resolve state.queue[state.index].hash to a file path, compute
 *     SHA-256, upsert t_track_progress with completed = seconds >= 0.95 * duration.
 *
 * Usage:
 *   node ./scripts/backfill-progress.js          # real run
 *   node ./scripts/backfill-progress.js --dry-run # preview only
 */

const path = require('path');
const db = require(path.join(__dirname, '..', 'database', 'db'));
const { config } = require(path.join(__dirname, '..', 'config'));
const { getTrackList, getContentHash } = require(path.join(__dirname, '..', 'filesystem', 'utils'));

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Given a work id and track hash (format "${workId}/${index}"), resolve the
 * file path by listing and sorting the work's audio files the same way
 * Reuses getTrackList so the index maps to the exact same file the runtime
 * would — the sort that assigns hash=index is the source of truth, and
 * reimplementing it (e.g. with localeCompare) risks drift on edge cases.
 * Returns { fullPath, title } or null.
 */
async function resolveTrackFile(workId, hash, workDir) {
  const idx = hash.indexOf('/');
  if (idx === -1) return null;
  const index = parseInt(hash.slice(idx + 1), 10);
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

async function main() {
  console.log('[backfill-progress] Starting backfill' + (DRY_RUN ? ' (DRY RUN)' : ''));
  console.log('');

  // Fetch all play history rows
  const historyRows = await db.knex('t_play_histroy').select('user_name', 'work_id', 'state');

  // Pre-fetch work directory info
  const workRows = await db.knex('t_work').select('id', 'root_folder', 'dir');
  const workDirMap = new Map();
  for (const w of workRows) {
    const rootFolder = config.rootFolders.find(rf => rf.name === w.root_folder);
    if (rootFolder) {
      workDirMap.set(w.id, path.join(rootFolder.path, w.dir));
    }
  }

  let total = 0;
  let skippedTerminal = 0;
  let skippedNoDuration = 0;
  let skippedNoDir = 0;
  let marked = 0;
  let p2Seeded = 0;
  let p2SkippedNoFile = 0;

  for (const row of historyRows) {
    total++;
    const { user_name: username, work_id: workId, state } = row;

    // Parse state
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
      skippedTerminal++;
      // Still fall through to Phase 2 below
    }

    if (index === queue.length - 1) {
      const lastTrack = queue[queue.length - 1];
      if (lastTrack && typeof lastTrack.duration === 'number' && lastTrack.duration > 0) {
        if (seconds >= 0.95 * lastTrack.duration) {
          if (!existingReview || !['listened', 'replay', 'postponed'].includes(existingReview.progress)) {
            if (DRY_RUN) {
              console.log(`  [P1-DRY] ${username} / work ${workId} — last track "${lastTrack.title}" finished (${Math.round(seconds)}s / ${Math.round(lastTrack.duration)}s)`);
            } else {
              try {
                await db.updateUserReview(username, workId, null, '', 'listened', false, true, false);
                console.log(`  [P1-OK]  ${username} / work ${workId} — marked as listened`);
              } catch (err) {
                console.error(`  [P1-ERR] ${username} / work ${workId} — ${err.message}`);
              }
            }
            marked++;
          }
        }
      } else {
        skippedNoDuration++;
      }
    }

    // --- Phase 2: seed t_track_progress for the last-played track ---
    const currentTrack = queue[index];
    if (!currentTrack || !currentTrack.hash) {
      continue;
    }

    const workDir = workDirMap.get(workId);
    if (!workDir) {
      skippedNoDir++;
      continue;
    }

    let resolved;
    try {
      resolved = await resolveTrackFile(workId, currentTrack.hash, workDir);
    } catch {
      // File may not exist on disk
    }
    if (!resolved) {
      p2SkippedNoFile++;
      if (DRY_RUN) {
        console.log(`  [P2-DRY] ${username} / work ${workId} — file not found for hash ${currentTrack.hash}, skipping`);
      }
      continue;
    }

    // Compute SHA-256
    let contentHash;
    try {
      contentHash = await getContentHash(resolved.fullPath);
    } catch (err) {
      console.error(`  [P2-ERR] ${username} / work ${workId} — hash computation failed: ${err.message}`);
      continue;
    }

    const duration = currentTrack.duration || 0;
    const completed = duration > 0 && seconds >= 0.95 * duration;

    if (DRY_RUN) {
      console.log(`  [P2-DRY] ${username} / work ${workId} — track "${resolved.title}" hash=${contentHash.slice(0, 12)}... completed=${completed} seconds=${Math.round(seconds)}`);
    } else {
      try {
        await db.upsertTrackProgress(username, workId, contentHash, seconds, completed);
        console.log(`  [P2-OK]  ${username} / work ${workId} — seeded track_progress (${completed ? 'completed' : 'partial'}, ${Math.round(seconds)}s)`);
      } catch (err) {
        console.error(`  [P2-ERR] ${username} / work ${workId} — upsert failed: ${err.message}`);
      }
    }
    p2Seeded++;
  }

  console.log('');
  console.log('[backfill-progress] Done.');
  console.log(`  Total processed:     ${total}`);
  console.log(`  Phase 1:`);
  console.log(`    Skipped (terminal):  ${skippedTerminal}`);
  console.log(`    Skipped (no duration): ${skippedNoDuration}`);
  console.log(`    Marked as listened:  ${marked}`);
  console.log(`  Phase 2:`);
  console.log(`    Skipped (no dir):     ${skippedNoDir}`);
  console.log(`    Skipped (no file):    ${p2SkippedNoFile}`);
  console.log(`    Seeded track_progress: ${p2Seeded}`);
  if (DRY_RUN) {
    console.log('  (dry run — no writes performed)');
  }
}

main().catch((err) => {
  console.error('[backfill-progress] Fatal error:', err);
  process.exit(1);
});