# Offline downloads and durable playback-state writes (PWA)

Makes a work playable without a connection, and stops the listening you did
while disconnected from being thrown away. Frontend only — no backend change;
it builds on `/api/media/offline/:trackId`, which already exists on `main`.

## What it solves

- **No way to take a work with you.** Playback streamed from the server every
  time; losing signal ended the session.
- **Writes made while disconnected were silently discarded.** Resume position,
  play queue and listened marks/ratings were all fire-and-forget with a
  `.catch(console.error)`, so a two-hour offline session left no trace.
- **And not only while offline** — a locked phone gets its radio throttled or
  its process frozen mid-request, which loses the same writes. The old
  `keepalive`-on-`visibilitychange` flushes could narrow that window but never
  close it, since a hard kill runs no handler at all.

## How

**Downloads.** Whole-work downloads run as a Background Fetch, so they survive
the tab closing and resume across network drops; per-track stays a foreground
fetch. Bytes live in the `offline-tracks` Cache Storage bucket, Vuex holds only
the manifest, and the two are reconciled on boot because a fetch can finish
with no tab open. New `/downloads` page lists what's stored and plays from it.

**Outbox** (`utils/outbox.js`). Playback-state writes go into an IndexedDB
queue that the service worker drains on the `sync` event. The record key is
also the coalescing key, so a track re-reported every 10s stays one row. Player
writes enqueue *before* sending, which is what survives a frozen process.
Queued writes resolve as successes, so no call site changed and the deferral is
invisible. Until a row drains it doubles as the local progress mirror, so
badges and resume position reflect the offline session. Nothing consults
`navigator.onLine` — the trigger is a request that can't be shown to have
landed. This replaces the `keepalive` flush path rather than sitting beside it.

## Limitations

- **Chromium only**, with the two halves degrading differently on purpose:
  whole-work download fails **loudly** (an explicit user action shouldn't
  quietly not happen), while the outbox switches **off** — nothing would drain
  it, and a stuck row would mask the server's progress forever. Safari and
  Firefox get pre-outbox behaviour exactly. Per-track download and offline
  playback still work everywhere.
- **Needs a secure context.** No worker registers over plain HTTP, so none of
  this runs. `canSync()` keys off `SyncManager` alone — see the last checklist
  item.
- **Last-write-wins on replay**, since `upsertTrackProgress` is an unconditional
  upsert. Pre-existing on `main`; this widens the window, and only in cases
  where the write used to be lost outright. Fixing it needs a backend change.
- Manifests written before this branch lack `contentHash`/`duration` and report
  no progress for that work. Self-healing on re-download.

## Testing

`npm run lint` and `npm run build` clean. Confirmed on Chromium/Android:
downloads survive closing the app, and writes made with the server down are
captured and drain when it returns.

- [ ] Offline read path — server down, rows queued: reload and open a work,
      badges and resume should show the offline session.
- [ ] Downloads-page playback after a re-download (manifest carrying
      `contentHash`/`duration`).
- [ ] Hard kill from the task switcher — position within ~10s of where it died.
- [ ] Firefox/Safari smoke test — progress still saves, a failed rating shows an
      error rather than a success, `kikoenai` IndexedDB stays empty.
- [ ] `'SyncManager' in window` on a plain-HTTP origin. If `true`, `canSync()`
      needs `&& self.isSecureContext`, or the outbox arms where nothing drains.
