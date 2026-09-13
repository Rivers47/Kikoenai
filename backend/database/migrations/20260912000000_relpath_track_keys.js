/**
 * One file identity: relPath replaces the CRC32 content hash.
 *
 * A file inside a work was addressed three different ways — a positional index
 * in media URLs, a relPath in every t_work.memo map, and a CRC32 of the file's
 * contents in t_track_progress.track_key. relPath wins because the memo already
 * used it, and because the hash never bought what it appeared to: its own cache
 * was invalidated by mtime, so it inherited mtime's trust level while costing a
 * full read of every audio byte on first open of a work.
 *
 * This migration rekeys the stored data, using each work's own
 * memo.contentHash map (relPath → hash) inverted. It reads no files: migrations
 * run on every boot and a work directory may be unmounted at that moment.
 *
 * What cannot be converted is KEPT, never deleted. An older scrapeWorkMemo
 * wiped memo.contentHash on every rescan (see AGENTS.md §2.9a), so in a
 * long-lived database most works with progress rows have no hash map left to
 * invert — measured at 212 of 230 works on the author's library. Those rows are
 * not junk: the old tree endpoint would recompute the hash on next open and
 * revive them, so deleting them here would be silent data loss.
 *
 * A leftover hash-shaped track_key is inert rather than harmful: nothing looks a
 * key up by hash any more, and a relPath can never collide with one (a tracked
 * file carries an extension, so it always contains a '.'). To recover the
 * positions rather than leave them stranded, run the opt-in
 * `scripts/rekey-track-progress.js`, which reads the files to finish the job —
 * deliberately a separate tool, since reading every audio file is exactly the
 * cost this change exists to remove from the request path.
 *
 * A play-history queue item with no contentHash predates per-track progress and
 * is left on its `workId/index` handle, which routes/utils/track.js resolves
 * through its documented legacy branch — stored user data cannot be refetched
 * the way a client cache can.
 */

// `${workId}/${relPath}` — the handle the API now serves and the frontend stores.
const trackIdFor = (workId, relPath) => `${workId}/${relPath}`;

// A key this migration has not converted yet: 8 lowercase hex digits. A relPath
// cannot look like one, because a tracked file always carries an extension.
// Tested explicitly rather than inferred from "did not resolve": re-running this
// migration finds the memos already stripped, so nothing resolves and every row
// -- including the ones already converted -- would otherwise be reported as
// stranded. Must stay in step with HASH_KEY in scripts/rekey-track-progress.js.
const HASH_KEY = /^[0-9a-f]{8}$/;

/** relPath → hash, inverted to hash → relPath. First writer wins on a tie. */
const invertHashes = (memoJson) => {
  let memo;
  try {
    memo = JSON.parse(memoJson || '{}') || {};
  } catch {
    return { memo: {}, byHash: new Map() };
  }
  const source = memo.contentHash || memo.hash || {};
  const byHash = new Map();
  for (const [relPath, hash] of Object.entries(source)) {
    if (hash && !byHash.has(hash)) byHash.set(hash, relPath);
  }
  return { memo, byHash };
};

exports.up = async function (knex) {
  const works = await knex('t_work').select('id', 'memo');
  const byWork = new Map();
  for (const work of works) {
    byWork.set(String(work.id), invertHashes(work.memo));
  }

  // 1. t_track_progress: track_key from CRC32 to relPath.
  const progressRows = await knex('t_track_progress').select('user_name', 'work_id', 'track_key');
  let rekeyed = 0;
  let stranded = 0;
  for (const row of progressRows) {
    const entry = byWork.get(String(row.work_id));
    const relPath = entry && entry.byHash.get(row.track_key);
    if (!relPath) {
      // No hash map to invert. Leave the row alone -- see the note above.
      if (HASH_KEY.test(row.track_key)) stranded += 1;
      continue;
    }
    if (relPath === row.track_key) continue;
    const where = { user_name: row.user_name, work_id: row.work_id, track_key: row.track_key };
    // The target key may already exist (two hashes that mapped to one relPath);
    // the newer row is no more correct than the older, so keep one and drop this.
    const clash = await knex('t_track_progress')
      .where({ user_name: row.user_name, work_id: row.work_id, track_key: relPath })
      .first();
    if (clash) {
      await knex('t_track_progress').where(where).del();
      continue;
    }
    await knex('t_track_progress').where(where).update({ track_key: relPath });
    rekeyed += 1;
  }

  // 2. t_play_history: queue item trackIds from `workId/index` to `workId/relPath`.
  const historyRows = await knex('t_play_history').select('user_name', 'work_id', 'state');
  let converted = 0;
  let untouched = 0;
  for (const row of historyRows) {
    if (!row.state) continue;
    let state;
    try {
      state = JSON.parse(row.state);
    } catch {
      continue;
    }
    if (!state || !Array.isArray(state.queue)) continue;

    const entry = byWork.get(String(row.work_id));
    let changed = false;
    let resolvedAll = true;
    for (const item of state.queue) {
      const hash = item.contentHash;
      const relPath = hash && entry && entry.byHash.get(hash);
      if (relPath) {
        item.trackId = trackIdFor(row.work_id, relPath);
        changed = true;
      } else {
        resolvedAll = false;
      }
      // contentHash is no longer anyone's key; drop it either way so the queue
      // stops re-uploading a dead field on every history PUT.
      if ('contentHash' in item) {
        delete item.contentHash;
        changed = true;
      }
      // The pre-rename spelling of trackId. Fold it in so there is one field.
      if ('hash' in item) {
        if (!item.trackId) item.trackId = item.hash;
        delete item.hash;
        changed = true;
      }
    }
    if (!resolvedAll) untouched += 1;
    if (!changed) continue;
    await knex('t_play_history')
      .where({ user_name: row.user_name, work_id: row.work_id })
      .update({ state: JSON.stringify(state) });
    converted += 1;
  }

  // 3. memo.contentHash is now dead weight. Strip it, having used it above.
  let stripped = 0;
  for (const work of works) {
    const entry = byWork.get(String(work.id));
    if (!entry || !entry.memo) continue;
    if (!('contentHash' in entry.memo) && !('hash' in entry.memo)) continue;
    delete entry.memo.contentHash;
    delete entry.memo.hash;
    await knex('t_work').where('id', work.id).update({ memo: JSON.stringify(entry.memo) });
    stripped += 1;
  }

  console.log(
    `[relpath-track-keys] progress: ${rekeyed} rekeyed, ${stranded} left hash-keyed; `
    + `history: ${converted} rows rewritten, ${untouched} with unresolved items left on the legacy handle; `
    + `memo: ${stripped} works stripped of contentHash`
  );
  if (stranded) {
    console.log(
      `[relpath-track-keys] ${stranded} per-track positions could not be rekeyed because their work's `
      + 'memo held no hashes. They are kept, not deleted; run "node scripts/rekey-track-progress.js" '
      + 'to recover them by reading the files, or "--purge" to discard them.'
    );
  }
};

exports.down = async function () {
  // Irreversible by construction: the memo hashes this migration keyed off are
  // stripped, and recomputing them means reading every audio file — which is
  // the cost the change exists to remove. Restore from a backup instead.
  throw new Error('20260912000000_relpath_track_keys is not reversible; restore a database backup');
};
