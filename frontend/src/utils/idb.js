/*
 * The app's one IndexedDB database, shared by every store that needs to outlive
 * the page. Kept in its own module because both the page and the service worker
 * open it, and because a second connection with a different version would block
 * the first.
 *
 * Stores:
 *   outbox    - playback-state writes awaiting delivery (utils/outbox.js)
 *   positions - the local record of where the user is in each track
 *               (utils/positions.js), which is the source of truth on this
 *               device rather than a delivery queue
 */

const DB_NAME = 'kikoenai'
// v1 had `outbox` alone. Bumping adds `positions` without touching it.
const DB_VERSION = 2

export const OUTBOX_STORE = 'outbox'
export const POSITIONS_STORE = 'positions'

let dbPromise = null

function openDb () {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
          db.createObjectStore(OUTBOX_STORE, { keyPath: 'key' })
        }
        if (!db.objectStoreNames.contains(POSITIONS_STORE)) {
          // Indexed by workId so a work's rows are one getAll rather than a scan
          // of every track ever played.
          const store = db.createObjectStore(POSITIONS_STORE, { keyPath: 'trackId' })
          store.createIndex('workId', 'workId')
        }
      }
      // A tab still holding v1 open blocks the upgrade, and the promise would
      // otherwise never settle with nothing said. Surface it instead.
      req.onblocked = () => {
        console.warn('[kikoenai] IndexedDB upgrade blocked by another open tab; close it to continue')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

/**
 * Run one request against one store and await its result.
 * @param {String} store Store name (see the exports above).
 * @param {'readonly'|'readwrite'} mode
 * @param {Function} fn Receives the object store, returns an IDBRequest.
 */
export async function run (store, mode, fn) {
  const db = await openDb()
  const request = fn(db.transaction(store, mode).objectStore(store))
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
