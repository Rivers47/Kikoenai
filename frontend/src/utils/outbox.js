/*
 * Durable queue for playback-state writes.
 */

import { apiUrl, stripBasePath } from '../base-path'
import { run, OUTBOX_STORE as STORE } from './idb'
import { activeRegistration } from './service-worker'

export const SYNC_TAG = 'kikoenai-outbox'

const QUEUEABLE = [
  /^\/api\/track-progress/,
  /^\/api\/history/,
  /^\/api\/review/,
]

const endpointPath = (url) => stripBasePath(String(url))

export const isQueueable = (url) => QUEUEABLE.some((re) => re.test(endpointPath(url)))

export const canSync = () => 'SyncManager' in self

export function outboxKey ({ method, url, body }) {
  return `${method}:${endpointPath(url)}`
}

export async function enqueue ({ method, url, body }) {
  const key = outboxKey({ method, url, body })
  await run(STORE, 'readwrite', (s) => s.put({
    key,
    method,
    url,
    body: JSON.stringify(body),
    createdAt: Date.now(),
  }))
  return key
}

export async function dequeue (key) {
  await run(STORE, 'readwrite', (s) => s.delete(key))
}

export async function entries () {
  const rows = await run(STORE, 'readonly', (s) => s.getAll())
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function requestSync () {
  if (!canSync()) return
  try {
    const registration = await activeRegistration()
    if (!registration || !('sync' in registration)) return
    await registration.sync.register(SYNC_TAG)
  } catch (err) {
    console.error('outbox sync registration failed:', err)
  }
}

export async function sendOrQueue (http, { method, url, body }) {
  url = apiUrl(url)

  if (!canSync()) {
    try {
      await http({ method, url, data: body, __outboxed: true })
    } catch (err) {
      console.error(err)
    }
    return
  }

  const key = await enqueue({ method, url, body })
  try {
    await http({ method, url, data: body, __outboxed: true })
    await dequeue(key)
  } catch (err) {
    console.error('deferred to outbox:', url, err.message || err)
    await requestSync()
  }
}

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
