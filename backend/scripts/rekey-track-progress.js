/**
 * Recover per-track positions that migration 20260912000000 could not rekey.
 *
 * track_key is now a work-relative path. The migration converted the rows it
 * could by inverting t_work.memo.contentHash, but an older scrapeWorkMemo wiped
 * that map on every rescan (AGENTS.md §2.9a), so in a long-lived database most
 * works have no hashes left to invert. Their rows were kept rather than deleted,
 * still keyed by CRC32, and this tool finishes the job by reading the files.
 *
 * It is deliberately a separate, opt-in CLI rather than part of the migration:
 * reading every audio file of every affected work is exactly the cost that was
 * removed from the request path, and it must not happen unasked on a boot.
 * CRC32 lives here and nowhere else for the same reason.
 *
 *   node ./scripts/rekey-track-progress.js [--dry-run] [--purge]
 *
 *   --dry-run  report what would change, write nothing
 *   --purge    discard the leftover rows instead of recovering them
 */

process.env.FREEZE_CONFIG_FILE = process.env.FREEZE_CONFIG_FILE || '1';

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');
const db = require(path.join(__dirname, '..', 'database', 'db'));
const { config } = require(path.join(__dirname, '..', 'config'));
const { getTrackList } = require(path.join(__dirname, '..', 'filesystem', 'utils'));

// A key the migration left behind: 8 lowercase hex digits. A relPath cannot look
// like one, because a tracked file always carries an extension.
const HASH_KEY = /^[0-9a-f]{8}$/;

const crc32 = (filePath) => new Promise((resolve, reject) => {
  let crc = 0;
  const stream = fs.createReadStream(filePath);
  stream.on('data', (chunk) => { crc = zlib.crc32(chunk, crc); });
  stream.on('end', () => resolve((crc >>> 0).toString(16).padStart(8, '0')));
  stream.on('error', reject);
});

/**
 * dbApi defaults to the live database module; tests pass { knex } like
 * backfill-progress.js does.
 */
async function run({ dryRun = false, purge = false, log = console.log, dbApi = db } = {}) {
  const rows = await dbApi.knex('t_track_progress').select('user_name', 'work_id', 'track_key', 'seconds');
  const stale = rows.filter((row) => HASH_KEY.test(row.track_key));
  if (!stale.length) {
    log('Nothing to do: every track_key is already a relative path.');
    return { stale: 0, recovered: 0, purged: 0, unresolved: 0 };
  }
  log(`${stale.length} hash-keyed rows across ${new Set(stale.map(r => r.work_id)).size} works.`);

  if (purge) {
    if (!dryRun) {
      for (const row of stale) {
        await dbApi.knex('t_track_progress')
          .where({ user_name: row.user_name, work_id: row.work_id, track_key: row.track_key })
          .del();
      }
    }
    log(`${dryRun ? 'Would purge' : 'Purged'} ${stale.length} rows.`);
    return { stale: stale.length, recovered: 0, purged: stale.length, unresolved: 0 };
  }

  const byWorkId = new Map();
  for (const row of stale) {
    if (!byWorkId.has(row.work_id)) byWorkId.set(row.work_id, []);
    byWorkId.get(row.work_id).push(row);
  }

  let recovered = 0;
  let unresolved = 0;
  for (const [workId, workRows] of byWorkId) {
    const work = await dbApi.knex('t_work').select('root_folder', 'dir').where('id', workId).first();
    const rootFolder = work && config.rootFolders.find((f) => f.name === work.root_folder);
    if (!rootFolder) {
      log(`  work ${workId}: root folder missing, skipping ${workRows.length} rows`);
      unresolved += workRows.length;
      continue;
    }

    const workDir = path.join(rootFolder.path, work.dir);
    let tracks;
    try {
      tracks = await getTrackList(workId, workDir, {});
    } catch (err) {
      log(`  work ${workId}: cannot list files (${err.message}), skipping ${workRows.length} rows`);
      unresolved += workRows.length;
      continue;
    }

    // Hash only the audio files this work actually needs matched.
    const wanted = new Set(workRows.map((r) => r.track_key));
    const byHash = new Map();
    for (const track of tracks) {
      if (byHash.size === wanted.size) break;
      const fullPath = path.join(workDir, track.subtitle || '', track.title);
      try {
        const hash = await crc32(fullPath);
        if (wanted.has(hash) && !byHash.has(hash)) byHash.set(hash, track.shortFilePath);
      } catch {
        // Unreadable file: nothing to match it to.
      }
    }

    for (const row of workRows) {
      const relPath = byHash.get(row.track_key);
      if (!relPath) {
        unresolved += 1;
        continue;
      }
      if (dryRun) {
        log(`  [DRY] ${row.user_name} / ${workId}: ${row.track_key} -> ${relPath} (${Math.round(row.seconds)}s)`);
        recovered += 1;
        continue;
      }
      const clash = await dbApi.knex('t_track_progress')
        .where({ user_name: row.user_name, work_id: workId, track_key: relPath })
        .first();
      const where = { user_name: row.user_name, work_id: workId, track_key: row.track_key };
      if (clash) {
        await dbApi.knex('t_track_progress').where(where).del();
        continue;
      }
      await dbApi.knex('t_track_progress').where(where).update({ track_key: relPath });
      recovered += 1;
    }
  }

  log(`${dryRun ? 'Would recover' : 'Recovered'} ${recovered} rows; ${unresolved} could not be matched`
    + ' (file changed, renamed or gone). Re-run with --purge to discard what is left.');
  return { stale: stale.length, recovered, purged: 0, unresolved };
}

module.exports = { run };

if (require.main === module) {
  run({ dryRun: process.argv.includes('--dry-run'), purge: process.argv.includes('--purge') })
    .then(() => db.knex.destroy())
    .catch(async (err) => {
      console.error('[rekey-track-progress]', err);
      await db.knex.destroy();
      process.exit(1);
    });
}
