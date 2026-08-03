/**
 * Backfill script: mark works as "listened" when the user's play history
 * indicates they finished the last track of the folder they played.
 *
 * Rule per (user_name, work_id) in t_play_histroy:
 *   - Parse state → {queue, index, seconds}.
 *   - Skip if t_review.progress is already terminal (listened/replay/postponed).
 *   - lastTrack = state.queue[state.queue.length - 1].
 *   - If state.index === state.queue.length - 1 AND seconds >= 0.95 * lastTrack.duration
 *     → set progress='listened' (upsert, progressOnly, no autoMark).
 *
 * Usage:
 *   node ./scripts/backfill-progress.js          # real run
 *   node ./scripts/backfill-progress.js --dry-run # preview only
 */

// Bootstrap db from the same config as the main app. Do NOT force NODE_ENV:
// knexfile only defines development/upgrade/test; db.js defaults to
// 'development', which points at the real db.sqlite3 (config.databaseFolderDir).
const path = require('path');
const db = require(path.join(__dirname, '..', 'database', 'db'));

const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  console.log('[backfill-progress] Starting backfill' + (DRY_RUN ? ' (DRY RUN)' : ''));
  console.log('');

  // Fetch all play history rows
  const historyRows = await db.knex('t_play_histroy').select('user_name', 'work_id', 'state');

  let total = 0;
  let skippedTerminal = 0;
  let skippedNoDuration = 0;
  let marked = 0;

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

    // Skip if already in a terminal state
    const existingReview = await db.knex('t_review')
      .select('progress')
      .where('user_name', '=', username)
      .andWhere('work_id', '=', workId)
      .first();
    if (existingReview && ['listened', 'replay', 'postponed'].includes(existingReview.progress)) {
      skippedTerminal++;
      continue;
    }

    // Not the last track → not finished
    if (index !== queue.length - 1) {
      continue;
    }

    const lastTrack = queue[queue.length - 1];
    if (!lastTrack || typeof lastTrack.duration !== 'number' || lastTrack.duration <= 0) {
      skippedNoDuration++;
      continue;
    }

    // Check if the user was near the end of the last track
    if (seconds < 0.95 * lastTrack.duration) {
      continue;
    }

    // Qualified: mark as listened
    if (DRY_RUN) {
      console.log(`  [DRY] ${username} / work ${workId} — last track "${lastTrack.title}" finished (${Math.round(seconds)}s / ${Math.round(lastTrack.duration)}s)`);
    } else {
      try {
        await db.updateUserReview(username, workId, null, '', 'listened', false, true, false);
        console.log(`  [OK]  ${username} / work ${workId} — marked as listened`);
      } catch (err) {
        console.error(`  [ERR] ${username} / work ${workId} — ${err.message}`);
      }
    }
    marked++;
  }

  console.log('');
  console.log('[backfill-progress] Done.');
  console.log(`  Total processed:  ${total}`);
  console.log(`  Skipped (terminal): ${skippedTerminal}`);
  console.log(`  Skipped (no duration): ${skippedNoDuration}`);
  console.log(`  Marked as listened: ${marked}`);
  if (DRY_RUN) {
    console.log('  (dry run — no writes performed)');
  }
}

main().catch((err) => {
  console.error('[backfill-progress] Fatal error:', err);
  process.exit(1);
});