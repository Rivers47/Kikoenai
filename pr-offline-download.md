# Offline downloads, durable playback position, and a file listing that lives in the database

Makes a work playable without a connection, stops listening done while
disconnected from being thrown away, and takes the filesystem off the request
path entirely.

Based on `11704ee`. The HTTP API gains one endpoint and two optional fields;
everything else is internal, so nothing here is blocked by the 1.0 freeze.

## What it solves

- **No way to take a work with you.** Playback streamed from the server every
  time, and losing signal ended the session.
- **Playback position existed only on the server.** Every position write was a
  network write, which made unload-time delivery load-bearing — and nothing
  available is reliable everywhere. `keepalive` survives the document dying but
  not the OS suspending the process; Background Sync is Chromium-only.
- **The same resume behaved differently depending on where you started it.** The
  work page's file tree read one derivation of a position, the info panel and
  Recent Works read another, and a delayed write made them contradict each other.
- **Every media request walked a directory.** `resolveTrack` rebuilt a work's
  file list from disk, so each stream, download, `check-lrc` and progress write
  cost a `stat` per file in the folder. Playing a 20-track work was dozens of
  walks, on works that run to hundreds of files.

## How

### Offline downloads

- `GET /api/media/offline/:id/*path` — the best offline-friendly copy of a
  track. A lossless source transcodes to Opus on first request and caches to
  disk; lossy audio and text serve as-is. Always served by Express, never the
  `offloadMedia` proxy, which maps to the original file and has nowhere to put a
  transcode.
- **Two download paths, chosen by `canBackgroundFetch()`.** Background Fetch
  where it exists, otherwise a serial `cacheFile()` loop in the page. So this is
  no longer Chromium-only: elsewhere the user is told to keep the tab open and
  watches `n / total` on the button, since there is no OS notification.
- Both are all-or-nothing. Background Fetch discards its batch on any non-2xx;
  the foreground loop uncaches what it fetched and rethrows. `isWorkDownloaded`
  keys on the metadata rows being promoted, so a half-cached work never looks
  complete.
- **Transcode cache key** is a digest of `(relPath, mtime, bitrate)`. The bitrate
  belongs in it: keyed on the source alone, changing `transcodeBitrate` served
  the old bitrate from cache forever, and nothing prunes that directory.

### Playback position, local-first

- Position is written to IndexedDB on every tick and every state change, so it is
  durable the moment it is observed and no request has to survive an unload.
- The server push is throttled to 60s during continuous playback but **forced**
  on pause, track change, seek, track end and page hide. Roughly 360 → 60 writes
  per hour of listening.
- `resolvePosition` is the one reconciliation rule — newest `observedAt` wins —
  and every consumer uses it: the file tree badge, the info panel, the Favourites
  badge, and all three resume entry points. They cannot disagree any more.
- Server-side, `trackProgressFor` owns the single query and `getTrackProgress` /
  `applyTrackProgressSeconds` are projections over it. They had already drifted
  (one selected `updated_at`, the other did not), which is what made the tree and
  the panel contradict each other.

### Durable writes

- An IndexedDB outbox captures any playback-state write that cannot be shown to
  have reached the server, replayed by the service worker's `sync` event. Not
  only the offline case — a locked phone with a throttled radio loses the same
  writes.
- Switched off without Background Sync, since nothing would drain the store. Off
  Chromium this degrades to send-and-log, and the **local position store covers
  the same-device case regardless**, which is the point of local-first.

### The file listing

- `t_work_file` (`work_id`, `rel_path`, `duration`, `mtime`, `track_title`) holds
  a work's files. `filesystem/workFiles.js` is the only way in, returning exactly
  the shape the old walk returned. Measured on a 43-file work: first read 1 walk,
  every read after **0**, five media requests **0**.
- The three scan paths maintain it. "Scan file changes" now refreshes durations
  *and* the listing in one pass, so a scan cannot update one and forget the other.
- Migration `20260913000000` seeds it from `t_work.memo` — **no filesystem
  access** — then leaves `files_indexed_at` NULL so each work completes its own
  listing with a single walk on first read. 30,476 rows across 1,804 works in 4s
  on a real library, every duration preserved.

## Trade-offs taken deliberately

- **A file deleted on disk stays listed until a rescan, and playing it 404s.**
  Previously it silently vanished from the tree. This is the cost of not touching
  the filesystem on reads; the scan button is the fix. A work whose folder is
  unmounted now lists its tracks and fails to play, where before the tree was
  empty.
- **The foreground download dies with its tab.** Navigating away abandons it.
  `reconcileDownloads` cleans the rows up on next boot.
- **Client clocks are trusted** for `observedAt`. Comparisons are
  client-to-client and for the single-device case the *same* clock, so ordinary
  drift cancels out. No defence against a deliberately wrong clock.
- **Renaming a file loses its position**, since the key is the path. The app's own
  answer to ugly filenames is `memo.trackTitles`, so renaming is already rare.

## Known gaps

- ~~`duration`/`mtime`/`track_title` duplicated with `t_work.memo`~~ — done.
  `20260914000000` drops the column; `probeAudioDurations` reads its invalidation
  state from the rows, `getTrackList` is a pure walker, and `isContainLyric`
  (written on every scan, read nowhere) is gone. `POST /api/scan/:id` returns
  `{files}` instead of `{memo}`.
- **Offline playback still needs a production build.** Dev unregisters the worker
  for HMR's sake, so downloads work in dev via the foreground path but nothing
  serves them from cache.
- **`zh-TW` is missing the older download strings** and falls back to `zh-CN`.
  Pre-existing.

## Testing

`npm test` in `backend/` (174 passing) and `npm run lint` from the root. The
assertions worth knowing about:

- `work-file-listing.js` — the database listing orders **identically** to the
  filesystem walk, and a work still lists its tracks after its folder is deleted,
  which is what proves no walk is happening.
- `progress-projections.js` — the two progress projections report the same
  `seconds` and `observedAt`; the test that would have caught the original drift.
- `track-progress-freshness.js` — a stale write cannot clobber a newer position,
  including the SQLite trap that integers sort below text in `updated_at`.

Needs a browser, not covered by the suite: whole-work download on Firefox
(foreground) and Chromium (background); play → pause → Recent Works → refresh,
with the panel and tree agreeing on first load; and cross-device reconciliation.
