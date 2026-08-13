/*
 * Durable queue for playback-state writes.
 *
 * A write is captured whenever it cannot be shown to have reached the server:
 * genuinely offline, but just as often online with the phone locked and the
 * radio throttled or the process frozen mid-request. Nothing here consults
 * navigator.onLine -- the trigger is a failed or killed request, not a flag.
 *
 * Delivery is the service worker's `sync` event, which survives the page being
 * frozen or closed. This module is imported by both sides: the page enqueues,
 * the worker drains.
 */

const DB_NAME = 'kikoenai'
const DB_VERSION = 1
const STORE = 'outbox'

export const SYNC_TAG = 'kikoenai-outbox'

// Endpoints whose writes are safe to replay minutes or hours later. Admin
// config, credentials, metadata edits and scan/refresh are deliberately absent:
// a stale replay of those is a footgun, and they are never issued from a locked
// phone anyway.
const QUEUEABLE = [
  /^\/api\/track-progress/,
  /^\/api\/history/,
  /^\/api\/review/,
]

const PROGRESS_URL = '/api/track-progress'

export const isQueueable = (url) => QUEUEABLE.some((re) => re.test(url))

let dbPromise = null

function openDb () {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE, { keyPath: 'key' })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  }
  return dbPromise
}

// A transaction goes inactive as soon as control returns to the event loop, so
// `fn` must issue its request in the same synchronous block that opens it --
// hence the callback rather than returning the store to an awaiting caller.
async function run (mode, fn) {
  const db = await openDb()
  const request = fn(db.transaction(STORE, mode).objectStore(STORE))
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/*
 * The key is also the coalescing key: put() overwrites, so a track re-reported
 * every 10s stays a single row for the whole session. work_id and contentHash
 * come from the body because neither appears in the URL; the review endpoints
 * distinguish themselves through their query string, which getUri() has already
 * folded into `url`.
 */
export function outboxKey ({ method, url, body }) {
  const b = body || {}
  return `${method}:${url}:${b.work_id ?? ''}:${b.contentHash ?? ''}`
}

// Deliberately does not register a sync: while online this would fire `sync`
// immediately and have the worker replay a row the caller is about to deliver
// itself. Callers register when they know delivery failed, or is about to
// become impossible -- see requestSync().
export async function enqueue ({ method, url, body }) {
  const key = outboxKey({ method, url, body })
  await run('readwrite', (s) => s.put({
    key,
    method,
    url,
    body: JSON.stringify(body),
    createdAt: Date.now(),
  }))
  return key
}

export async function dequeue (key) {
  await run('readwrite', (s) => s.delete(key))
}

export async function entries () {
  const rows = await run('readonly', (s) => s.getAll())
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

/*
 * Ask the browser to drain the store. Fires when it next believes the network
 * is usable -- immediately if it already does, with backoff after that.
 *
 * Called on boot (to pick up rows left by a process that was killed outright),
 * on page hide (the last moment we are certain to run), and whenever a delivery
 * attempt fails. Registering with an empty store is a harmless no-op.
 */
export async function requestSync () {
  try {
    const registration = await navigator.serviceWorker.ready
    await registration.sync.register(SYNC_TAG)
  } catch (err) {
    // Never let scheduling failure surface: the row is already durable and
    // some later caller will re-register.
    console.error('outbox sync registration failed:', err)
  }
}

/*
 * Queue the write, then attempt it, then drop the row once the server confirms.
 *
 * Enqueue-first rather than enqueue-on-catch because the failure this exists
 * for -- the OS freezing a backgrounded player mid-request -- runs no catch at
 * all. `http` is the caller's axios instance, passed in so this module stays
 * dependency-free and can be bundled into the service worker.
 */
export async function sendOrQueue (http, { method, url, body }) {
  const key = await enqueue({ method, url, body })
  try {
    // __outboxed keeps the axios interceptor from queueing this a second time
    // and reporting a synthetic success, which would make the catch below
    // unreachable and delete the row we just wrote.
    await http({ method, url, data: body, __outboxed: true })
    await dequeue(key)
  } catch (err) {
    console.error('deferred to outbox:', url, err.message || err)
    await requestSync()
  }
}

/*
 * Unsynced progress for one work, shaped like the server's trackProgress map so
 * it can be spread straight over it. This is the whole offline read path: a row
 * exists only while its write is undelivered, so it vanishes the moment the
 * server becomes authoritative again.
 */
export async function pendingProgress (workId) {
  const out = {}
  for (const entry of await entries()) {
    if (!entry.url.startsWith(PROGRESS_URL)) continue
    let body
    try { body = JSON.parse(entry.body) } catch { continue }
    if (String(body.work_id) !== String(workId) || !body.contentHash) continue
    out[body.contentHash] = { seconds: body.seconds, completed: body.completed }
  }
  return out
}

/*
 * Replay, oldest first. Called from the service worker's `sync` handler, so
 * throwing is meaningful: it rejects the waitUntil and Chromium re-fires the
 * event with backoff.
 */
export async function drain () {
  for (const entry of await entries()) {
    const res = await fetch(entry.url, {
      method: entry.method,
      headers: { 'Content-Type': 'application/json' },
      body: entry.body,
      // Carries the HttpOnly session cookie.
      credentials: 'same-origin',
    })

    // 401/403 means the session lapsed, not that the write was bad -- keep it
    // for after the next login. Other 4xx are permanent and would wedge the
    // queue forever.
    if (res.status === 401 || res.status === 403 || res.status >= 500) {
      throw new Error(`outbox replay failed (${res.status}): ${entry.key}`)
    }
    await dequeue(entry.key)
  }
}
