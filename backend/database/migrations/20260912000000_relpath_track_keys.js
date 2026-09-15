/**
 * One file identity: relPath replaces the CRC32 content hash.
 */

// `${workId}/${relPath}` — the handle the API now serves and the frontend stores.
const trackIdFor = (workId, relPath) => `${workId}/${relPath}`;

// Must stay in step with HASH_KEY in scripts/rekey-track-progress.js.
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

/** Every relPath the memo knows, spelled the way trackIds are (forward slashes). */
const memoPaths = (memo) => new Set(
  ['duration', 'mtime', 'trackTitles']
    .flatMap((field) => Object.keys((memo && memo[field]) || {}))
    .map((relPath) => String(relPath).split('\\').join('/'))
);

const POSITIONAL = /^\d+$/;

/**
 * The work a trackId prefix names, as this history row spells it. Only the
 * pre-text-id numeric spelling of the row's own work (`1636129` for `01636129`)
 * is rewritten: a queue can hold tracks of other works, and those are left alone.
 */
const workIdForPrefix = (prefix, rowWorkId) => {
  if (prefix === rowWorkId) return rowWorkId;
  const bare = (id) => id.replace(/^0+/, '');
  return POSITIONAL.test(prefix) && POSITIONAL.test(rowWorkId) && bare(prefix) === bare(rowWorkId)
    ? rowWorkId
    : null;
};

/** Rebuild a positional item's relPath from its title and folder, if the memo has that file. */
const relPathFromItem = (item, paths) => {
  if (typeof item.title !== 'string' || !item.title) return null;
  let candidate = null;
  if (typeof item.subtitle === 'string') {
    candidate = `${item.subtitle.split('\\').join('/')}/${item.title}`;
  } else if (item.subtitle === null) {
    candidate = item.title;
  } else {
    // Older queue items dropped the folder: accept the name only when it is unique.
    const matches = [...paths].filter((p) => p === item.title || p.endsWith(`/${item.title}`));
    if (matches.length === 1) candidate = matches[0];
  }
  // A guessed path that is not on the list would 404, where the old handle still plays.
  return candidate && paths.has(candidate) ? candidate : null;
};

/**
 * Convert an item still on a positional or legacy-prefixed handle. Returns true
 * when the item now holds a `workId/relPath` trackId, false when it was left alone.
 * Mutates the item; the pre-rename `hash` field is folded in by the caller after.
 */
const resolveLegacyHandle = (item, rowWorkId, byWork) => {
  const handle = typeof item.trackId === 'string' ? item.trackId : item.hash;
  if (typeof handle !== 'string') return false;
  const slash = handle.indexOf('/');
  if (slash <= 0) return false;
  const rest = handle.slice(slash + 1);
  const workId = workIdForPrefix(handle.slice(0, slash), rowWorkId);
  if (!workId) return !POSITIONAL.test(rest);

  if (!POSITIONAL.test(rest)) {
    // Already a relPath; only the prefix may need respelling.
    item.trackId = trackIdFor(workId, rest);
    return true;
  }
  const entry = byWork.get(workId);
  const relPath = entry && relPathFromItem(item, entry.paths);
  if (!relPath) {
    if (workId !== handle.slice(0, slash)) item.trackId = `${workId}/${rest}`;
    return false;
  }
  item.trackId = trackIdFor(workId, relPath);
  return true;
};

exports.up = async function (knex) {
  const works = await knex('t_work').select('id', 'memo');
  const byWork = new Map();
  for (const work of works) {
    const entry = invertHashes(work.memo);
    entry.paths = memoPaths(entry.memo);
    byWork.set(String(work.id), entry);
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

    const rowWorkId = String(row.work_id);
    const entry = byWork.get(rowWorkId);
    let changed = false;
    let resolvedAll = true;
    for (const item of state.queue) {
      const hash = item.contentHash;
      const relPath = hash && entry && entry.byHash.get(hash);
      const before = item.trackId;
      if (relPath) {
        item.trackId = trackIdFor(row.work_id, relPath);
      } else if (!resolveLegacyHandle(item, rowWorkId, byWork)) {
        resolvedAll = false;
      }
      if (item.trackId !== before) changed = true;
      // contentHash is no longer anyone's key; drop it either way so the queue
      // stops re-uploading a dead field on every history PUT.
      if ('contentHash' in item) {
        delete item.contentHash;
        changed = true;
      }
      // A stored default stream/download URL still names the old handle, and
      // AudioElement prefers mediaStreamUrl over the trackId -- so it would keep
      // playing the positional URL and skip a downloaded copy. The player derives
      // the default itself; only an offload URL (no /api/) is worth keeping.
      for (const [field, route] of [['mediaStreamUrl', '/api/media/stream/'], ['mediaDownloadUrl', '/api/media/download/']]) {
        if (typeof item[field] === 'string' && item[field].includes(route)) {
          delete item[field];
          changed = true;
        }
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
