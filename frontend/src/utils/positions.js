/*
 * Where the user is in each track, recorded on this device.
 *
 * This is the local source of truth, not a delivery queue likeutils/outbox.js,
 * whose rows are deleted the moment they reach the server.
 */

import { run, POSITIONS_STORE as STORE } from './idb'

/**
 * The server returns observedAt as 'YYYY-MM-DD HH:MM:SS' in UTC
 * @param {String|Number} stamp Server text, or epoch ms from a local row.
 * @returns {Number} epoch ms, or 0 when unusable.
 */
export function toEpoch (stamp) {
  if (typeof stamp === 'number') return stamp
  if (!stamp) return 0
  const ms = Date.parse(`${String(stamp).replace(' ', 'T')}Z`)
  return Number.isNaN(ms) ? 0 : ms
}

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
 * One work's positions
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
 * The position for one track, from whichever side observed it later.
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
 * device's own record.
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
