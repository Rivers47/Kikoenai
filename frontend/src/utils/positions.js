/*
 * Where the user is in each track, recorded on this device.
 *
 * This is the local source of truth, not a delivery queue -- which is the whole
 * difference from utils/outbox.js, whose rows are deleted the moment they reach
 * the server. A row here persists, so position survives a reload, an offline
 * session, and a process killed without warning, none of which depend on a
 * request completing.
 *
 * That is what lets the server push be throttled (see SERVER_PUSH_MS in
 * AudioPlayer): the server is an eventually-consistent replica for reading on
 * another device, not the only place the position exists.
 */

import { run, POSITIONS_STORE as STORE } from './idb'

/**
 * The server returns observedAt as 'YYYY-MM-DD HH:MM:SS' -- space-separated,
 * UTC, and with no timezone marker. Date.parse treats an unmarked string like
 * that as *local* time, so parsing it directly would shift every server value
 * by the machine's offset and make local win every comparison. Normalize to
 * ISO with an explicit Z.
 * @param {String|Number} stamp Server text, or epoch ms from a local row.
 * @returns {Number} epoch ms, or 0 when unusable.
 */
export function toEpoch (stamp) {
  if (typeof stamp === 'number') return stamp
  if (!stamp) return 0
  const ms = Date.parse(`${String(stamp).replace(' ', 'T')}Z`)
  return Number.isNaN(ms) ? 0 : ms
}

/**
 * Record a position locally. Skips the write when a stored row is newer: these
 * are fired from async handlers and can land out of order.
 */
export async function savePosition ({ trackId, workId, seconds, completed, observedAt }) {
  if (!trackId || !workId) return
  const stamp = observedAt || Date.now()
  const existing = await run(STORE, 'readonly', (s) => s.get(trackId))
  if (existing && toEpoch(existing.observedAt) > stamp) return
  await run(STORE, 'readwrite', (s) => s.put({
    trackId,
    workId: String(workId),
    seconds,
    completed: !!completed,
    observedAt: stamp,
  }))
}

/**
 * One work's positions, shaped exactly like the server's trackProgress map so
 * the two can be merged without adapting either side.
 * @returns {Promise<Object>} { [trackId]: { seconds, completed, observedAt } }
 */
export async function positionsForWork (workId) {
  const out = {}
  if (workId === undefined || workId === null) return out
  const rows = await run(STORE, 'readonly',
    (s) => s.index('workId').getAll(IDBKeyRange.only(String(workId))))
  for (const row of rows || []) {
    out[row.trackId] = {
      seconds: row.seconds,
      completed: row.completed,
      observedAt: row.observedAt,
    }
  }
  return out
}

/**
 * Newest observation wins, per track -- the same rule the server applies on
 * write (backend/AGENTS.md §2.9c), so the two cannot disagree about precedence.
 *
 * Returns the merged map plus the trackIds where the local copy was newer: the
 * caller pushes those so the server catches up. Without that, a position whose
 * throttled push was lost to a hard kill would stay on this device forever.
 */
/**
 * The position for one track, from whichever side observed it later.
 *
 * Every consumer goes through this -- the file tree badge, the info panel, and
 * all three resume entry points -- because they used to read different things:
 * the tree read the merged trackProgress map while the panel and Recent Works
 * read `state.seconds` from the server's history join. Same underlying row, two
 * derivations, so a throttled push made them contradict each other and made the
 * same resume behave differently depending on which page you started from.
 *
 * @param {Object} local a row from positionsForWork(), or undefined
 * @param {{seconds: Number, observedAt: String|Number}} server `state.seconds` +
 *   `state.secondsObservedAt`, or a trackProgress entry
 * @returns {{seconds: Number, completed: Boolean, observedAt}|null}
 */
export function resolvePosition (local, server) {
  const hasServer = server && typeof server.seconds === 'number';
  if (!local) return hasServer ? server : null;
  if (!hasServer) return local;
  return toEpoch(server.observedAt) >= toEpoch(local.observedAt) ? server : local;
}

/**
 * The position a history row should resume from, reconciled against this
 * device's own record. `state` is a history row's `state` -- it carries the
 * parked queue item plus the server's `seconds`/`secondsObservedAt`.
 *
 * Used by every resume entry point and by the work page's info panel, so they
 * cannot report different numbers for the same row.
 * @returns {Promise<Number>} seconds, or -1 for "nothing to resume"
 */
export async function resumeSecondsFor (workId, state) {
  if (!state || !Array.isArray(state.queue)) return -1
  const parked = state.queue[state.index]
  if (!parked || !parked.trackId) return typeof state.seconds === 'number' ? state.seconds : -1

  let local
  try {
    local = (await positionsForWork(workId))[parked.trackId]
  } catch (err) {
    console.error('local position read failed:', err)
  }
  const resolved = resolvePosition(local, {
    seconds: state.seconds,
    observedAt: state.secondsObservedAt,
  })
  return resolved && typeof resolved.seconds === 'number' ? resolved.seconds : -1
}

export function mergePositions (serverMap, localMap) {
  const merged = { ...(serverMap || {}) }
  const localNewer = []
  for (const [trackId, local] of Object.entries(localMap || {})) {
    // Same rule as resolvePosition, applied across a whole work.
    if (resolvePosition(local, merged[trackId]) !== local) continue
    merged[trackId] = local
    localNewer.push(trackId)
  }
  return { merged, localNewer }
}
