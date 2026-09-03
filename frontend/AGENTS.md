# Kikoenai Frontend — AGENTS Guide

This is the Quasar-based frontend PWA; the Express API server lives in sibling package `backend/`.

- **Language:** Vue 3 (Options API style)
- **Framework:** Quasar 2 (Material Design)
- **State:** Vuex 4
- **Router:** Vue Router 4 (history mode)
- **Audio:** Plyr (used directly, no Vue wrapper)
- **Real-time:** Socket.IO Client
- **License:** GPL-3.0-only

---

## 1. Project Structure

```
├── src/
│   ├── App.vue                           # Root component
│   ├── index.template.html               # HTML template
│   ├── utils.js                          # Shared utility functions
│   ├── material-theme.json               # Generated Material color tokens (see scripts/generate-theme.mjs)
│   ├── utils/
│   │   ├── contrast.js                   # Contrast-ratio helpers for theme-aware text colors
│   │   ├── downloads.js                  # Offline downloads: cacheFile/uncacheFile (per-track, foreground) + buildWorkDownloadPlan/startWorkDownload/reconcileDownloads/onDownloadMessage (whole-work, Background Fetch)
│   │   ├── lyrics.js                     # Per-speaker lyric colours + MAX_LYRIC_STREAMS
│   │   └── subtitles.js                  # SRT/VTT/LRC parsing + stream merging (§2.9)
│   ├── css/
│   │   ├── app.scss                      # Global styles
│   │   ├── material-theme.scss           # Generated Material theme tokens
│   │   ├── theme-utilities.scss          # Theme helper classes/mixins
│   │   └── quasar.variables.scss         # Quasar SCSS variables
│   ├── boot/                             # App boot files (run before mount)
│   │   ├── axios.js                      # Axios instance + withCredentials for the session cookie
│   │   ├── i18n.js                       # vue-i18n registration + Quasar lang sync + $tTag/$tagLang
│   │   ├── plyr.js                       # Plyr audio player boot
│   │   ├── socket.io.js                  # Socket.IO client setup
│   │   ├── contrast.js                   # Contrast helper boot
│   │   └── store.js                      # Vuex store initialization
│   ├── i18n/                             # Localization
│   │   ├── index.js                      # createI18n + locale resolution + auto-discover partials
│   │   ├── CONVENTIONS.md                # i18n key/file conventions (read before editing)
│   │   ├── tags/                         # Dynamic tag-name translation maps (JSON)
│   │   │   ├── index.js                  # translateTag(name, locale) helper
│   │   │   └── zh-CN.json, en-US.json, zh-TW.json
│   │   └── parts/                        # Per-scope vue-i18n message partials (auto-discovered)
│   │       ├── zh-CN/                    # e.g. workdetails.js, advanced.js, common.js …
│   │       ├── en-US/
│   │       ├── ja-JP/
│   │       └── zh-TW/
│   ├── router/
│   │   ├── index.js                      # Router initialization
│   │   └── routes.js                     # Route definitions
│   ├── layouts/
│   │   ├── MainLayout.vue                # Main app layout (header, drawer, player bar)
│   │   └── DashboardLayout.vue           # Admin dashboard layout
│   ├── pages/
│   │   ├── Works.vue                     # Media library browser + search
│   │   ├── Work.vue                      # Individual work detail page
│   │   ├── List.vue                      # Generic list (circles, tags, VAs)
│   │   ├── Login.vue                     # Login page
│   │   ├── Favourites.vue                # Favorites, history, progress
│   │   ├── FullScreenPlayer.vue          # Full-screen player mode
│   │   ├── TextViewer.vue                # In-app text file viewer (route /text/:trackId)
│   │   ├── Downloads.vue                 # Offline library: manifest grouped by work, rendered with WorkCard/WorkListItem (grid/list toggle, sort), storage quota, play-all, per-work/per-track remove
│   │   ├── Error404.vue                  # 404 page
│   │   └── Dashboard/
│   │       ├── Folders.vue               # Library folder management
│   │       ├── Scanner.vue               # Scan controls + progress
│   │       ├── Advanced.vue              # Advanced settings
│   │       ├── Settings.vue              # General settings
│   │       ├── Backfill.vue              # Metadata backfill progress
│   │       └── UserManage.vue            # User management (admin)
│   ├── components/
│   │   ├── AudioPlayer.vue               # Main audio player (floating panel)
│   │   ├── AudioElement.vue              # Playback engine: hidden <audio> + Plyr + mediaSession
│   │   ├── PlayerBar.vue                 # Mini player bar (bottom of screen)
│   │   ├── LyricsBar.vue                 # Lyrics display below player
│   │   ├── PIPLyrics.vue                 # Picture-in-picture lyrics overlay
│   │   ├── WorkCard.vue                  # Work card (grid mode); `oldStyle` prop switches to the legacy look; optional `coverUrl` prop overrides the cover source
│   │   ├── WorkListItem.vue              # Work list item (list mode); optional `coverUrl` prop + `side` slot for trailing actions
│   │   ├── WorkDetails.vue               # Work detail panel (metadata, review, rating; opens EditMetadata for admins)
│   │   ├── EditMetadata.vue             # Admin-only metadata edit dialog (PUT /api/work/:id)
│   │   ├── WorkTree.vue                  # Track tree view for a work
│   │   ├── Cover.vue                     # Cover image + id/release/tag chips; optional `coverUrl` prop overrides `/api/cover/:id`
│   │   ├── RecentWorks.vue               # Recently played works section
│   │   ├── Scrollable.vue                # Scrollable container helper
│   │   ├── SleepMode.vue                 # Sleep timer dialog
│   │   ├── WriteReview.vue               # Review/rating form dialog
│   │   └── FavListItem.vue               # Favorites list row item
│   ├── store/
│   │   ├── index.js                      # Vuex store creation (createStore)
│   │   ├── module-AudioPlayer/           # Audio player Vuex module
│   │   │   ├── index.js                  # Module registration
│   │   │   ├── state.js                  # State (playing, queue, volume, etc.)
│   │   │   ├── getters.js                # Getters
│   │   │   ├── mutations.js              # Mutations
│   │   │   └── actions.js                # Actions
│   │   ├── module-User/                  # User Vuex module
│   │   │   ├── index.js
│   │   │   ├── state.js                  # State (name, group, auth)
│   │   │   ├── getters.js
│   │   │   ├── mutations.js
│   │   │   └── actions.js
│   │   ├── module-Downloads/             # Offline-download manifest Vuex module
│   │   │   ├── index.js
│   │   │   ├── state.js                  # State (downloadedFiles, enableTranscoding)
│   │   │   ├── getters.js                # isDownloaded, isFileDownloaded, isWorkDownloaded, totalDownloadedBytes
│   │   │   ├── mutations.js              # ADD_DOWNLOADED_FILE, REMOVE_DOWNLOADED_FILE, SET_ENABLE_TRANSCODING
│   │   │   └── actions.js                # Unused (see src/utils/downloads.js) -- kept for structural consistency with the other modules
│   │   └── store-flag.d.ts
│   └── mixins/
│       └── Notification.js               # Notification helper mixin (showErrNotif, etc.)
├── src-pwa/                              # PWA service worker files
│   ├── custom-service-worker.js          # Hand-written Workbox SW (InjectManifest): precache, nav fallback, offline-tracks caching routes
│   ├── register-service-worker.js        # SW registration + update notification (unchanged by the InjectManifest switch)
│   └── manifest.json                     # Web app manifest
├── quasar.config.js                      # Quasar framework configuration
├── package.json
└── README.md
```

---

## 2. Architecture & Key Design Decisions

### 2.1 Framework

Built with **Quasar CLI** (`@quasar/app-webpack`) targeting **PWA mode**. The app can also be built as an SPA.

- **Vue 3** — existing code uses Options API (data, methods, computed, watch)
- **Vuex 4** — two modules: `AudioPlayer` and `User`
- **Vue Router 4** — history mode, SPA routing with backend fallback
- **Quasar 2** — Material Design UI components
- **Plyr** — instantiated directly (`new Plyr(...)`) on a hidden `<audio>`; its own UI is unused
- **Socket.IO Client** — real-time scan progress events

### 2.2 Routing (`router/routes.js`)

Three route groups:

| Route | Layout | Description |
|-------|--------|-------------|
| `/admin` | `DashboardLayout` | Admin dashboard (folders, scanner, advanced, settings, backfill, user mgmt) |
| `/` | `MainLayout` | Main app with persistent audio player at bottom |
| `/login` | None | Standalone login page |

Main layout routes:

| Route | Name | Page | Description |
|-------|------|------|-------------|
| `/` | `works` | Works | Media library (grid/list, sort, filter, search) — this is the real route |
| `/works` | — | redirect→`/` | Legacy path, redirects to `/` preserving query. Deliberate: the reverse direction caused a `replaceState` loop that broke back navigation |
| `/work/:id` | — | Work | Work detail + track list |
| `/fullScreenPlayer/:id?` | — | FullScreenPlayer | Full-screen player mode |
| `/text/:trackId(.*)` | — | TextViewer | In-app viewer for `.txt`/`.lrc`/`.srt`/`.ass`/`.vtt`. The param spans a slash because `trackId` is `${workId}/${index}`. Never link to `/api/media/stream/...` directly — a real navigation kills the SPA document (playback stops) and in an installed PWA back exits the app |
| `/circles` | — | List | Browse by circle (artist group) |
| `/tags` | — | List | Browse by tag |
| `/vas` | — | List | Browse by voice actor |
| `/favourites` | — | Favourites | Defaults to the history view (`props.route = 'history'`) |
| `/favourites/review` | — | Favourites | Review history |
| `/favourites/progress` | — | Favourites | Progress; bare path defaults to `marked` |
| `/favourites/progress/{marked,listening,listened,replay,postponed}` | — | Favourites | Progress by state |
| `/favourites/history` | — | Favourites | Play history |
| `/:pathMatch(.*)*` | — | Error404 | Catch-all, appended unless `MODE === 'ssr'` |

The `/favourites/*` children are generated by the `prefixRoutes` helper at the top of `routes.js`; each one renders the same `Favourites` page with different `props`.

**Key detail:** The `Works` and `Favourites` pages are kept alive via `<keep-alive :include="['Works', 'Favourites']">` in `MainLayout`, preserving the loaded list and scroll position when navigating back. The cost is that neither page refetches on return, so a review/progress change made on a work page is not reflected in a cached list until something calls `reset()`.

### 2.3 State Management (Vuex)

**`AudioPlayer` module** — Full playback state (defined in `module-AudioPlayer/state.js`):

```javascript
{
  hide: false,                    // Player panel visibility
  playing: false,                 // Play/pause state
  currentTime: 0,                 // Current playback position (seconds)
  newCurrentTime: -1,             // Seek target (-1 = none)
  duration: 0,                    // Track duration
  source: "",                     // Audio source URL
  queue: [],                      // Track queue [{hash, title, workTitle}]
  queueIndex: 0,                  // Current track index
  playMode: {id: 0, name: "order"}, // order | all repeat | repeat once | shuffle
  muted: false,
  volume: 0,
  hasLyric: false,
  currentLyrics: [],              // One entry per simultaneous lyric stream (§2.9); '' where that speaker is silent
  lyricSpeakers: [],              // Speaker name per stream, parallel to currentLyrics; null where the format has no name
  lyricOffsetSeconds: 0,
  sleepMode: false,                 // Sleep timer armed
  sleepModeType: null,              // 'minutes' | 'tracks'
  sleepStopAt: null,                // minutes mode: stop timestamp (ms)
  sleepTracksLeft: 0,               // tracks mode: tracks left after current one
  rewindSeekTime: 5,
  forwardSeekTime: 30,
  rewindSeekMode: false,          // Set true to request a rewind; AudioElement performs it and resets
  forwardSeekMode: false,         // Same, for forward seek
  swapSeekButton: false,          // Swap seek/next buttons
  flipLRChannel: false,           // Swap left/right channels (WebAudio, see AudioElement)
  visualPlayerCoverUrl: '',       // Override cover for the full-screen player
  playWorkId: 0,                  // Currently playing work ID
  playWorkVas: [],                // VAs of the playing work [{id, name}]; set from the SET_QUEUE payload, first one becomes the mediaSession artist
  workLastTrackId: '',            // Last track of the playing folder; drives auto-mark-listened
  autoMarkListened: true,         // Auto-mark the work listened when workLastTrackId ends
  enablePIPLyrics: false,         // Picture-in-picture lyrics (force-disabled on Android)
  resumeHistorySeconds: -1,       // Resume position from history (-1 = none; cleared in onCanplay)
  oldWorkCardUIStyle: false,      // Legacy card UI toggle
}
```

**`User` module** — Authentication state:

```javascript
{
  auth: false,    // Whether auth is enabled server-side
  name: '',       // Username
  group: ''       // User group
}
```

**`Downloads` module** (`module-Downloads/`) — Offline-download manifest (metadata only; actual bytes live in the service worker's `offline-tracks` Cache Storage bucket, populated by `src/utils/downloads.js`'s `cacheFile`/`uncacheFile`, not by this module):

```javascript
{
  downloadedFiles: [], // { url, workId, trackId, type: 'audio'|'lyric'|'cover'|'metadata', title, workTitle, bytes, downloadedAt, contentHash?, duration? }[], persisted to LocalStorage `downloaded_files`
  enableTranscoding: false, // from GET /api/config/shared, fetched once in MainLayout.vue on boot; gates whether download UI is shown
}
```
Unlike `AudioPlayer`/`User`, has no real actions (matches the existing convention — this app uses Vuex for state+mutations only, never `dispatch`; async orchestration lives in component methods or `src/utils/downloads.js`). Key getters: `isDownloaded(trackId)` (audio only — drives `AudioElement.vue`'s `source` computed and the per-track UI toggle), `isFileDownloaded(trackId)` (any type — used for lyric files, which have their own trackId), `isWorkDownloaded(workId)`, `totalDownloadedBytes`. `Downloads.vue` reads the raw `downloadedFiles` state and groups it by `workId` itself (the manifest order within a work is the tree order the download walked).

### 2.4 Boot Files

> **`base-path.js` must stay first in the `boot` array.** It repoints webpack's
> chunk loader at the deploy path prefix at module scope, and the next boot file
> along (`i18n`) can trigger a dynamic import. See §2.6b.

| Boot File | File | Purpose |
|-----------|------|---------|
| `base-path.js` | `src/boot/base-path.js` | Sets `__webpack_public_path__` from the runtime deploy prefix. **Listed first.** |
| `axios.js` | `src/boot/axios.js` | Configures Axios defaults (Content-Type, `withCredentials`); prefixes every request URL with the deploy path (§2.6b); clears the legacy `jwt-token` LocalStorage key; exposes `$axios` globally |
| `i18n.js` | `src/boot/i18n.js` | Registers `vue-i18n`, syncs the Quasar lang pack and `<html lang>` to the current locale, exposes `$tTag(name)` and `$tagLang` globally, exports `changeLanguage(locale)` / `changeTagLanguage(locale)` |
| `store.js` | `src/boot/store.js` | Initializes Vuex store |
| `contrast.js` | `src/boot/contrast.js` | Contrast-ratio helpers for picking theme-aware text colors (`src/utils/contrast.js`) |
| `plyr.js` | `src/boot/plyr.js` | Imports Plyr + its CSS, exposes the `Plyr` class as `$Plyr` (no component is registered) |
| `socket.io.js` | `src/boot/socket.io.js` | Creates Socket.IO client (autoConnect: false); exposes `$socket` globally |

### 2.5 Audio Player Architecture

The audio player is a multi-component system fixed at the bottom of `MainLayout`:

```
MainLayout
├── PlayerBar        # Mini bar (always visible at bottom)
├── AudioPlayer      # Floating panel (toggle-able, shows cover + controls)
│   └── AudioElement # The actual playback engine (hidden <audio> + Plyr + mediaSession)
├── LyricsBar        # Lyrics display (below player)
└── PIPLyrics        # Picture-in-picture lyrics overlay
```

- **AudioPlayer.vue** — Floating card at bottom-right with cover art, track controls, seek bar, volume, playback mode. Presentational only: it renders `AudioElement` and drives it through Vuex.
- **AudioElement.vue** — The playback engine, and the only component that touches the media element. Holds a `display:none` `<audio crossorigin>` with `Plyr` instantiated on it directly (`controls: ['progress']`); Plyr's own UI is never shown, so it acts purely as an event/property façade over the native element. Also owns:
  - `navigator.mediaSession` metadata and lock-screen action handlers (`updateMediaSessionMetadata`), which map play/pause/next/prev/seek back onto Vuex mutations.
  - Optional L/R channel swap (`applyFlipLRChannel`) via a WebAudio `createMediaElementSource → ChannelSplitter → ChannelMerger → destination` graph. `createMediaElementSource` is a one-way door — once called, that `AudioContext` owns the element's output permanently — so the graph is built lazily on first use and only *rewired* on toggle, never torn down until unmount.
  - **Background playback (Android):** `ended` is bound as a direct native listener on the media element, *not* `player.on('ended')` — Plyr proxies the same native event, and registering both advanced the queue two tracks at a time. The next track's source is loaded imperatively (`_loadSource`) **synchronously inside the `ended` handler**, because Chrome freezes hidden pages and the `nextTick`-deferred `source` watcher can lag by minutes. `_loadSource` compares `media.currentSrc` and no-ops when the watcher later fires with the same URL. Do not reintroduce a `<source :src>` binding here; see commit `6fb856c`.
- **PlayerBar.vue** — Compact mini-bar always visible when a track is playing (contains basic controls).
- **LyricsBar.vue** — Draggable, resizable lyric bar. Renders one coloured line per lyric stream, stacked (§2.9); parsing and playback sync live in `AudioElement.vue`.
- **PIPLyrics.vue** — Picture-in-picture mode for desktop browsers (disabled on Android).
- Configuration like seek times, L/R channel flip, auto-mark-listened, and PIP lyrics are persisted in `LocalStorage` (keys are exported from `store/module-AudioPlayer/state.js`).

### 2.6 Communication with Backend

- **REST API:** All data operations via Axios (`/api/*` endpoints). **The frontend stores no credential of any kind.** Auth is a server-side session in an `HttpOnly` cookie (`kikoeru_sid`) that the browser attaches automatically, including to `<audio>`, `<img>`, and download URLs.
- **Never append `?token=` to an API URL.** That pattern was removed when auth moved to cookies; media and cover URLs are now built bare, e.g. `/api/media/stream/${trackId}` and `/api/cover/${workId}?type=sam`.
- `<audio crossorigin="anonymous">` in `AudioElement.vue` sets credentials mode `same-origin`, so the cookie *is* sent on same-origin media requests. Do not change this to `use-credentials` without testing playback.
- **WebSocket (Socket.IO):** Used for real-time scan progress updates. The client connects after auth and **both emits and listens**: it emits `PERFORM_SCAN`, `PERFORM_UPDATE`, `PERFORM_LYRIC_SCAN`, `KILL_SCAN_PROCESS`, `ON_SCANNER_PAGE`, and listens for `SCAN_INIT_STATE`, `SCAN_TASKS`, `SCAN_FAILED_TASKS`, `SCAN_MAIN_LOGS`, `SCAN_RESULTS`, `SCAN_FINISHED`, `SCAN_ERROR` (all handled in `pages/Dashboard/Scanner.vue`).
- **Seek times are client-side:** `rewindSeekTime` / `forwardSeekTime` are read from `LocalStorage` in `module-AudioPlayer/state.js` (defaults 5s / 30s), not fetched from the server.

### 2.6b Deploy Path Prefix (`src/base-path.js`)

The backend can be configured (`config.basePath`, e.g. `/kikoeru`) to serve the
whole app under a sub-path so it can share a hostname with other self-hosted
services. **One build has to work at any prefix** — there is no per-deployment
rebuild — which splits every URL in the app into two kinds:

| URL kind | How it gets the prefix |
|----------|------------------------|
| Baked in at build time — `<script>`/`<link>` hrefs, SW precache manifest, web app manifest | `build.publicPath` is the placeholder `/__KIKO_BASE__/`; the backend swaps it for the real prefix while serving `index.html`, `sw.js` and `manifest.json` |
| Built at runtime — API calls, router base, Socket.IO path, SW registration | `src/base-path.js` reads `window.__KIKO_BASE__`, injected into `index.html` by that same pass |

`src/base-path.js` exports `basePath` (`''` or `/prefix`, never trailing-slashed),
`apiUrl(url)`, `appUrl(url)` (the same for non-`/api` paths — the Background
Fetch notification icon, the worker's `openWindow` target) and
`stripBasePath(pathname)` (the inverse, for matching an incoming URL against a root-relative
pattern).

**It resolves the prefix differently in the service worker.** There is no
`window` there and no `index.html` to read the injection from, so it falls back
to `self.registration.scope`, which carries the prefix because the worker is
registered with an explicit `scope` (below). The worker imports this module
(via `utils/outbox.js` and its own caching routes), and without that fallback
every offline route would match against a prefix of `''` and silently never
fire on a sub-path install.

**Rules when adding a request:**

- **Through `$axios`? Do nothing.** A request interceptor in `boot/axios.js`
  runs `apiUrl()` over every URL, so the ~40 existing call sites — and any new
  one — are handled. This is why there is no `axios.defaults.baseURL`: that
  would apply a *second* time to URLs already prefixed by hand.
- **Anywhere else — `<img>`/`<audio>` `src`, `fetch`, `window.open` — wrap it
  in `apiUrl()`.** Those never touch axios. `apiUrl` is idempotent, so wrapping
  something that later goes through axios is harmless.
- **Backend-supplied URLs (`mediaStreamUrl`, `mediaDownloadUrl`) already carry
  the prefix.** Do not wrap them; only the `/api/media/...` fallback branch
  beside them needs it (`WorkTree.vue`, `AudioElement.vue`).
- **A URL that becomes a Cache Storage key must be prefixed at the point it is
  built** — `buildWorkDownloadPlan`/`cacheFile` in `src/utils/downloads.js`, and
  the rows `sendOrQueue` writes to the outbox. These go to Background Fetch, a
  bare `fetch()` and `cache.put()`, none of which run an interceptor, and a
  CacheFirst route that looks up a key nobody wrote is just a cache miss.
- **`quasar dev` injects no global**, so `basePath` is `''` and every URL is
  exactly what it was before this existed. A prefix is only ever exercised
  through the backend.

Both ends of Socket.IO apply the prefix themselves, because it hangs off the
raw HTTP server rather than the Express router: `boot/socket.io.js` sets
`path: \`${basePath}/socket.io\``, mirroring `backend/socket.js`.

The service worker is registered at `${basePath}/sw.js` **with an explicit
`scope`** — a worker can never control a broader path than its own URL, so a
sub-path install would otherwise register a worker that controls nothing.

### 2.7 Key Frontend Features

1. **Infinite Scroll:** `Works.vue` uses `q-infinite-scroll` to paginate results (triggers `onLoad()` callback).

2. **Cover Blurring:** None. `Cover.vue` renders the cover plus its id/release/tag chips, nothing else. It was called `CoverSFW.vue` until the NSFW blur it was named for turned out never to have been wired up — `:nsfw` was the literal `false` at every call site from the initial commit onward — at which point the dead branch and the misleading name both went. The only age-rating control is the server-side `nsfw=0|1|2` filter in `Works.vue` — see `nsfwFilter` in `backend/database/queries.js`.
3. **Sleep Timer:** `SleepMode.vue` (opened from the bedtime button in `AudioPlayer.vue`'s settings row) stops playback either after a chosen number of minutes (5-min slider steps) or after a chosen number of tracks past the current one. The armed timer is persisted in `SessionStorage` under the `sleepTimer` key (`SLEEP_TIMER_KEY`) and restored on reload; stop logic lives in `AudioElement.vue` (`onTimeupdate` for minutes, `onEnded` for tracks).
4. **Dark Mode:** Toggled via Quasar's `Dark` plugin, persisted in browser across sessions.
5. **Progress Tracking:** Users can mark works as `listening`, `listened`, `replay`, or `postponed`.
6. **Work Card Variants:** One component, `WorkCard.vue`, renders both styles: the modern one (tags revealed on hover over the cover) and, with `oldStyle` set, the legacy one (tag chips below the body, text price/sold line, `mic` icon on VA chips). `Works.vue` binds the prop to `oldWorkCardUIStyle`, persisted under LocalStorage key `old_work_card_ui_style_key`. Both share the `workcard` i18n scope.
7. **Metadata Editing (admin only):** `WorkDetails.vue` shows an "edit metadata" button (i18n key) only when the current user is an admin (computed `isAdmin`: auth disabled, or `group === 'administrator'`, or `name === 'admin'`). It opens `EditMetadata.vue`, which PUTs to `/api/work/:id` with `{title, nsfw, release, circle, tags[], vas[], illustrators[], scriptWriters[], series}` — **tag names sent are the canonical Japanese names** (the backend canonicalizes them again via `resolveTagLabel`). Tag/VA/illustrator/script-writer/series inputs use Quasar `q-select` with `use-input` autocomplete, fetching options from `/api/tags`, `/api/vas`, `/api/illustrators`, `/api/script_writers`, `/api/seriess` (note the irregular plural `seriess`). For tags, the option **label** is the translated name (`$tTag`) but the bound **value** is the canonical Japanese name, so storage stays canonical. **`filterTags` matches the typed text against the canonical name only** (`o.name`), not against the displayed label — deliberately, to stay consistent with `/api/search`, which is parsed server-side and understands canonical Japanese alone. The same applies to `filteredItems` in `List.vue`. Do not "fix" either to match the translated name without changing the backend too. On save, the dialog emits `saved` and `WorkDetails.vue` re-reads the work metadata.
8. **Keyboard Shortcuts:** Space for play/pause, arrow keys for seeking, etc. (handled in AudioPlayer).

### 2.9 Multi-speaker lyrics

A track voiced by several speakers shows several lyric lines at once, stacked in
one bar, one colour per speaker. There are no speaker names anywhere in the
feature — the numbered files carry none — so colour is the only distinction.

**Where the streams come from.** `GET /api/media/check-lrc/:trackId` returns one
entry per numbered sidecar file (`01 Track.1.lrc`, `01 Track.2.lrc`, …; rules in
`backend/AGENTS.md` §2.8b). On top of that, a single `.vtt` may carry WebVTT
voice spans (`<v Alice>text</v>`), which `AudioElement.vue` splits into one
stream per voice — so one backend entry can expand into several streams. `.lrc`
and `.srt` have no per-line speaker field and never expand.

**Speaker names come only from WebVTT**, the one format with anywhere to put
one, in this order:

1. a cue's voice span, `<v Alice>` — for several speakers inside one file;
2. the file header, `WEBVTT - Alice` (the free text the spec allows after
   `WEBVTT`, with an optional `- ` stripped) — for a track split one speaker
   per file, where there is no cue to hang a span off. A leading BOM is
   tolerated, since hand-written files often carry one.

A nameless `<v>` counts as unnamed and shares a stream with untagged cues.
Streams from `.lrc`, `.srt` and unlabelled `.vtt` files are anonymous and render
as text alone, told apart by colour. Names are fixed for the track, so
they are published once per load through `SET_LYRIC_SPEAKERS` rather than
riding along on every line change.

**The internal model is the cue list** (`{time, voice, text}`) that
`parseSubtitleCues` produces. All of this parsing lives in `src/utils/subtitles.js`
rather than in the component, because `scripts/check-lyrics.mjs` imports it to
check real folders (`npm run check:lyrics -- <folder>`); keep it dependency-free,
which is why `mergeLyricStreams` takes the parser class as an argument. It — the speaker is read off the cue *before* the LRC
conversion, so nothing is lost by converting "down" to a format with no speaker
field. The per-stream LRC text is only the wire format into `lrc-file-parser`,
which is the timing engine and reads nothing else. **Do not try to make WebVTT
the internal representation:** it means replacing that engine with native
`TextTrack`/`cuechange` or a hand-rolled scheduler, and re-deriving the seek,
pause/resume and lyric-offset behaviour documented above, for no gain.

**How they are played.** `AudioElement.vue` runs **exactly one** `lrc-file-parser`
`Lyric` instance (`lrcObj`), over a timeline that `mergeLyricStreams` interleaves
from all the speakers: one LRC line per distinct timestamp, whose text is its own
index into a `frames` table holding what every speaker shows at that moment. Each
tick publishes a whole frame through `SET_CURRENT_LYRICS`, so a line arriving for
one speaker never clears the line another is still holding, and speakers cannot
drift apart under seeking or the offset slider.

> **Never run more than one playing `Lyric` at a time.** `lrc-file-parser` keeps
> its scheduler in a module-level singleton (`timeoutTools` in
> `lrc-file-parser.esm.js`), not per instance: a second instance's `start()`
> overwrites the first's callback without cancelling its pending animation
> frame, and `pause()` nulls that callback, so the orphaned frame fires and
> throws `this.callback is not a function`. It only shows on multi-speaker
> tracks, which makes it look intermittent. Parse-only instances are fine —
> `setLyric` never touches the scheduler, and `mergeLyricStreams` uses one per
> stream to read `lines` and fold in each stream's own `[offset:]` tag.

**Lines persist until that speaker's next one**, gaps included — LRC semantics,
applied to all three formats for consistency. A speaker who has stopped talking
therefore stays on screen beside one who has not. This is deliberate, not an
oversight: WebVTT and SRT do carry a cue end time, `parseSubtitleCues` matches
it and drops it, and honouring it was considered and declined (2026-08-29) —
clearing at cue end would blank the bar between cues on single-speaker tracks
too. Do not wire the end time up without asking first.

**How they are drawn.** `LyricsBar.vue` renders `currentLyrics` as stacked
block-level lines (silent speakers are `v-show`n away; the bar grows upward, so
its baseline does not move) and `PIPLyrics.vue` paints the same lines onto its
canvas, splitting the PiP window's line budget between whoever is speaking. A
speaker's name is drawn inline ahead of the text, never on a row of its own —
the PiP window is only a couple of lines tall and cannot spare the height. On
the canvas the name is folded into the string before wrapping, since a canvas
has no text layout and a separately styled run would need its own measuring.
Both colour a stream through `src/utils/lyrics.js`, which maps a stream index to
a `--lyric-speaker-N` token. Those are **Material 3 custom colours**, not
hand-picked hexes: `Lyric Speaker 1..6` in `src/material-theme.json`
`extendedColors`, hues evenly spaced around the HCT circle at one chroma and
tone so no speaker reads as louder than another, and `harmonized: false`
because harmonizing pulls every hue toward the seed — which is exactly what
tells the speakers apart. `npm run theme` gives each one a tonal palette per
scheme. `MAX_LYRIC_STREAMS` must match how many exist — streams past it are
dropped, not given a repeated colour.

**Single-speaker playback is unchanged:** one stream keeps the plain
`--on-surface-variant` colour and renders exactly as before.

### 2.10 Internationalization (i18n)

Two separate translation layers, kept apart:

1. **Static UI strings** → `vue-i18n` v9 (legacy mode, Options API). `$t('scope.key')` in templates, `this.$t(...)` in script. The instance is created in `src/i18n/index.js` and registered by `src/boot/i18n.js` (in the `boot` array, `quasar.config.js`).
2. **Dynamic tag names** → `translateTag(name, locale)` in `src/i18n/tags/index.js`, exposed as `$tTag(name)` via the i18n boot. Tag names are DATA (canonical Japanese from the backend), so they live in hand-maintained JSON maps (`src/i18n/tags/{zh-CN,en-US,zh-TW}.json`), NOT in the vue-i18n catalog. `ja-JP` is the identity (no map). Unmapped tags fall back to the Japanese name.

**Locales:** `zh-CN` (base/`fallbackLocale`), `en-US`, `ja-JP`, `zh-TW` — all complete and in key parity (33 scopes each).

**Catalog layout:** per-scope partial files under `src/i18n/parts/<locale>/<scope>.js` (scope = `.vue` filename lowercased), auto-discovered by `require.context` in `src/i18n/index.js` — adding a partial file is enough; do NOT edit `index.js` per scope. Shared strings live under scope `common` (`parts/<locale>/common.js`). Conventions are documented in `src/i18n/CONVENTIONS.md` (read before editing).

**Locale resolution (per-user):** on boot, `getInitialLocale()` checks LocalStorage `app_language` → else matches `navigator.language` (exact, then prefix; `zh-TW`/`zh-HK` → `zh-CN`) → else `zh-CN`. The choice is persisted in LocalStorage `app_language`.

**Language switchers:** both live in `pages/Dashboard/Settings.vue` as `q-select`s. The UI one calls `changeLanguage(locale)` from `src/boot/i18n.js` (updates `vue-i18n`, the Quasar lang pack via `Quasar.lang.set`, `<html lang>`, and LocalStorage); the tag one calls `changeTagLanguage(locale)`. The dead server `tagLanguage` config and its radio group were **removed** (scrapers always fetch Japanese; tag language is now a display concern, resolved client-side).

**Tag language is independent of the UI language.** `tagLocalePref` (LocalStorage `tag_language`) holds either one of the four locales or the sentinel `FOLLOW_UI` (`'follow'`, the default), which resolves to the current UI locale. `getCurrentTagLocale()` does that resolution; `$tTag` is bound to it, **not** to `getCurrentLocale()`. Setting it to `ja-JP` gives untranslated (canonical) tag names under any UI language, which is the identity map and therefore always complete.

> **Neither locale is reactive, and that is load-bearing on where the switchers live.** `$tTag` is a plain `globalProperties` function reading a module-level `let`, and `Cover.vue`, `WorkListItem.vue` and `List.vue` render tag names without a single `$t` call — nothing repaints on a locale change. It works because `App.vue` is a bare `<router-view>` and `/admin` (`DashboardLayout`) and `/` (`MainLayout`) are sibling route records: reaching Settings unmounts `MainLayout`, taking the `<keep-alive>` that holds `Works`/`Favourites` with it, so every tag is rendered fresh on the way back. **Move either switcher into `MainLayout`** — a drawer item, a dialog, a quick-toggle — **and this breaks**; make `currentLocale`/`tagLocalePref` `ref`s at that point so render functions subscribe.

**Han unification / `lang` attributes.** Roboto and the rest of Quasar's default stack carry no CJK glyphs, so Han characters resolve through the browser's fallback — and the browser picks *which* CJK face from the `lang` attribute, falling back to its own language setting when there isn't one. `index.template.html` ships a bare `<html>`, so `boot/i18n.js` sets `document.documentElement.lang` from the UI locale (`htmlLang()`: `zh-Hans`/`zh-Hant`/`ja`/`en`). Because tags can be in a *different* language than the UI, every element rendering a tag name carries its own `:lang="$tagLang"` — `Cover`, `WorkCard`, `WorkDetails`, `WorkListItem`, the tag `q-btn`s in `List.vue`, and the autocomplete in `EditMetadata.vue`. The already-attached chips in `EditMetadata.vue` are hardcoded `lang="ja"` since they always show the canonical Japanese name. **Add `:lang="$tagLang"` to any new element that renders `$tTag`** — without it, Japanese kanji get drawn with Simplified-Chinese glyph shapes for a zh-configured browser.
>
> `PIPLyrics.vue` is exempt and cannot be fixed this way: a `<canvas>` has no cascade and no language context, so the font stack is the only lever. It samples `<body>`'s computed `fontFamily` (commit `4680f126`) instead of the old hardcoded stack, which used to lead with PingFang SC / Hiragino Sans GB and forced SC glyphs on Japanese lyrics.

**Quasar lang sync:** `src/boot/i18n.js` dynamically imports the matching `quasar/lang/*` pack (`zh-CN`, `en-US`, `ja`, `zh-TW`) and falls back to `en-US` on load failure. `quasar.config.js` `framework.lang: 'en-US'` remains the build-time default and is overridden at boot.

**Tag identity vs display:** the backend stores canonical Japanese tag names (canonicalized via `backend/scraper/tag-aliases.json` — see `backend/AGENTS.md` §2.3). The frontend's tag-translation maps are keyed by that canonical name, so the frontend never deals with renames. Display sites use `$tTag(tag.name)`; the editor (`EditMetadata.vue`) keeps canonical `tag.name` as the stored/bound value.

---

## 3. Critical Conventions & Gotchas

- **Session Management:** The session cookie is `HttpOnly`, so JS cannot read it and there is nothing to manage client-side. `MainLayout.initUser()` calls `GET /api/auth/me` on boot; a 401 redirects to `/login`. Logout is `POST /api/auth/logout`, which destroys the server-side session — clearing client state alone is no longer enough.
- **Keep-Alive:** `Works` and `Favourites` are wrapped in `<keep-alive :include="['Works', 'Favourites']">` in `MainLayout.vue`. Their `activated` hooks should be used for data refreshes when returning from other pages. A cached page stays mounted, so any `q-infinite-scroll` on it keeps listening to scroll events while it is off-screen — both pages therefore freeze their scroller in `deactivated` (`stopLoad = true`) and thaw it in `activated`.
- **SPA History Fallback:** The backend uses `connect-history-api-fallback` so Vue Router handles all non-`/api` routes. No hash routing needed.
- **Dev Server Proxy:** In development (`quasar dev`), `quasar.config.js` proxies `/api` and `/socket.io` to `localhost:8888` (the backend).
- **Service Worker:** PWA mode uses Workbox in **InjectManifest** mode — the worker is hand-written at `src-pwa/custom-service-worker.js`, not generated. `quasar.config.js` now carries only *build-time* PWA options (`extendInjectManifestOptions` → the precache `exclude` list, and `extendPWACustomSWConf` → the esbuild target); all *runtime* behaviour (`skipWaiting`/`clientsClaim`, navigation fallback, caching routes) lives in the worker file. The switch from GenerateSW was required because a generated worker can only express routes, and the offline-download feature needs SW event handlers (Background Fetch).
  - The worker excludes `/api/*` and `/media/*` from navigation fallback, and registers three routes (all into a single `offline-tracks` Cache Storage bucket): `CacheFirst` + `RangeRequestsPlugin` on `/api/media/offline/*` (tracks/lyrics), `CacheFirst` on `/api/cover/*` (work covers), and `NetworkFirst` on `/api/work/:id`, `/api/tracks/:id`, `/api/review` (work-detail page JSON — live data when online, cached snapshot as offline fallback). The first two are populated only by the explicit download action (`src/utils/downloads.js`), never by ordinary streaming; the third also auto-populates on any successful browse, since JSON metadata is small and bounding it risks evicting a downloaded work's snapshot.
  - **Match routes on the pathname, never on an `^/api/...`-anchored RegExp — and strip the deploy prefix first.** The matchers call `appPath(url)` (`stripBasePath(url.pathname)`), because under a sub-path install every pathname arrives as `/prefix/api/...`; on a root-served install it is the identity. Workbox's `RegExpRoute` execs the pattern against the *absolute* URL (`url.href`, e.g. `https://host/api/...`), so a leading `^\/api\/` can never match. The original `runtimeCaching` config made exactly this mistake and all three routes were silently dead — downloads were written to Cache Storage by the page but never served back from it, so offline playback did not work. (`NavigationRoute`'s denylist is unaffected: it matches on `url.pathname + url.search`, which is why navigation exclusion always worked. **Keep those denylist patterns unanchored** — under a deploy path prefix the pathname is `/kikoeru/api/...`, and an anchored `^\/api\/` would miss it, silently handing API requests the SPA shell while offline.)
  - The old warning about `require('workbox-range-requests')` no longer applies — that package only crashed when imported from the Node-side config file; inside the worker it is imported normally.
  - The custom SW is bundled by **esbuild**, not webpack/babel — the only part of the app that is. Quasar's default browser target includes `safari14`, and esbuild refuses to emit the destructuring the `workbox-*` packages use for that target (a Safari 14.0 engine bug it cannot lower). `extendPWACustomSWConf` raises the floor to `safari14.1` for this bundle alone; the app's own target is untouched. The `workbox-{core,precaching,routing,strategies,range-requests}` packages are now explicit devDependencies rather than transitive ones.
  - See `module-Downloads` (§2.3) and the `/api/media/offline/:id/:index` endpoint (§6, `backend/AGENTS.md` §6) for the rest of the feature.
- **Whole-work downloads use Background Fetch (Chromium only).** `WorkDetails.toggleWorkOfflineDownload` no longer loops over files itself — it builds the plan (`buildWorkDownloadPlan`), commits every manifest row with `pending: true`, then hands the whole batch to the browser via `startWorkDownload`. Registration ids are `kikoenai-work-<workId>`.
  - **The page never sees completion.** The browser downloads with no tab open and wakes the service worker, which moves the records into `offline-tracks` and `postMessage`s any open client (`kikoenai/download-{success,fail,abort}`). `MainLayout.initOfflineDownloads` listens for those, and on boot calls `reconcileDownloads()` to catch fetches that finished while the app was closed.
  - **Why rows are written up front:** only the page knows track titles, and the SW must not have to invent metadata. It reports which URLs landed; `PROMOTE_DOWNLOADED_FILES` clears `pending` and fills in `bytes`.
  - **All `module-Downloads` getters ignore `pending` rows.** This preserves the existing semantics exactly — `isWorkDownloaded` still keys on `metadata` rows as the completion marker, and `isDownloaded` must not return true for a track still in flight or `AudioElement` would switch playback to a URL that is not cached yet. Rows from the per-track foreground path have no `pending` flag and are unaffected, as are manifests written before this change.
  - **Reconcile only examines pending rows**, and skips works with an in-flight registration (`backgroundFetch.getIds()`) — otherwise a boot during an active download would drop its rows. It early-returns before touching `backgroundFetch`, which is what keeps it from throwing on engines that lack the API.
  - **Lyrics need two cached things, not one.** The `.lrc`/`.srt`/`.vtt` file is downloaded as a `lyric` row, but `AudioElement.loadLrcFile` first calls `/api/media/check-lrc/<trackId>` to find out *which* file holds the lyrics — so that lookup is in the plan too (as a `metadata` row with `trackId: null`) and has its own `NetworkFirst` route. It returns 200 `{result: false}` for tracks without lyrics, so including every audio track is safe.
  - **One failed request fails the whole batch.** Background Fetch fires `backgroundfetchfail` if *any* record ends non-2xx, and the SW then caches nothing for that work. A single track whose transcode 500s therefore discards the entire work download rather than leaving it half-cached. (Deliberate — it keeps `isWorkDownloaded` honest — but it makes whole-work downloads only as reliable as the least reliable track.)
  - **No capability detection, by design.** `assertBackgroundFetchSupport()` throws `[kikoenai] missing required API: BackgroundFetch` on engines without it. This branch targets Chromium and fails loudly on purpose; the fallback to the foreground path is deliberately not written yet. Per-track downloads still use the foreground `cacheFile()` and work everywhere.
- **Playback-state writes go through an IndexedDB outbox (`src/utils/outbox.js`), replayed by Background Sync.** A write is captured whenever it cannot be shown to have reached the server. That is *not* only the offline case — the common one is a locked phone whose radio is throttled or whose process is frozen mid-request. Nothing in the module consults `navigator.onLine`.
  - DB `kikoenai` v1, one store `outbox`, keyPath `key` = `` `${method}:${url}:${work_id}:${contentHash}` ``. The key *is* the coalescing key, so `put()` overwrites and a track re-reported every 10s stays one row. Replay is oldest-first by `createdAt`.
  - **Rows store the URL that will actually be sent**, deploy prefix included — `drain()` replays them with a bare `fetch()`, where no axios interceptor runs to add one. The `QUEUEABLE` patterns stay root-relative, so every match strips the prefix first (`endpointPath`).
  - **Queueable endpoints only:** `/api/track-progress`, `/api/history`, `/api/review` (which covers `/api/review/progress`). Admin config, credentials, metadata edits and scan/refresh are deliberately excluded — replaying those hours later is a footgun.
  - **Two capture paths.** `sendOrQueue()` enqueues *before* sending and deletes the row on success — used by the player, because a request killed when the OS freezes the page runs no `catch` at all. Everything else is captured by the `boot/axios.js` response interceptor, which enqueues on transport error and resolves with a **synthetic success** (`{ data: { message: t('common.success') } }`), so no call site needs a "queued" code path and the deferral is invisible. `sendOrQueue` marks its config `__outboxed` so the interceptor does not queue the same request twice and delete the row it just wrote.
  - `boot/axios.js` also sets a 10s timeout **on queueable writes only** — without one a throttled radio hangs forever and no handler runs. It is not a global default because `POST /api/backfill/progress` runs the whole library synchronously.
  - **`enqueue()` does not register a sync**; while online that would have the worker replay a row the caller is about to deliver itself. `requestSync()` is called on boot (`MainLayout.initOfflineDownloads` — picks up rows from a process that was killed outright), on page hide, and whenever a delivery attempt fails.
  - **`drain()` throwing is the retry mechanism** — a rejected `waitUntil` makes Chromium re-fire `sync` with backoff. 401/403 keeps the row (the session lapsed, the write was fine); other 4xx drops it, or it would wedge the queue forever.
  - **Offline reads come from the same rows.** `pendingProgress(workId)` returns a `{contentHash: {seconds, completed}}` map shaped like the server's, spread over `trackProgress` in `Work.vue:requestTracks` (which runs even when the request failed) and used for `resumeHistorySeconds` in `Downloads.playWork`. A row exists only while its write is undelivered, so it disappears once the server is authoritative again — no timestamps, no staleness bookkeeping.
  - **Last-write-wins, by choice.** `upsertTrackProgress` (`backend/database/queries.js`) is an unconditional upsert with no timestamp comparison, so a row replayed hours later clobbers a newer value written from another device. Accepted rather than adding a client clock to the payload.
  - **Switched off entirely without Background Sync (`canSync()`, i.e. non-Chromium).** The outbox is the one place in this feature set that *detects* a capability instead of failing loudly, because nothing would ever drain the store: a row would outlive its write and `pendingProgress()` would mask the server's value forever, including newer progress from another device. So `sendOrQueue` degrades to a plain send-and-log, `queueWrite` returns `null` so the call site sees its transport error (a synthetic success would be a lie when nothing will deliver it), and `pendingProgress` returns `{}` — which also neutralises rows left by a build predating the guard. Net effect on Safari/Firefox: pre-outbox behaviour, exactly.
  - **Needs a secure context, like everything service-worker-backed here.** On a plain-HTTP origin (a raw LAN IP, say) no worker registers, so `sync` never fires, Background Fetch throws, and the app will not install as a PWA. IndexedDB still works, so writes are captured and simply never drain — which reads as a broken outbox rather than an undeliverable one. Test over HTTPS, or grant the origin `chrome://flags/#unsafely-treat-insecure-origin-as-secure`.
  - This **replaced** the `keepalive` `fetch` flushes on `visibilitychange` (`flushHistoryOnHide` / the deleted `_flushTrackProgressOnHide`). Those were hand-rolled attempts at the same durability; a row that survives the freeze plus a worker that delivers it afterwards is strictly stronger. The 10s interval stays — it sets position *freshness*, not durability.
- **Deploy path prefix:** never hardcode a root-absolute `/api/...` string into an `<img>`/`<audio>` `src` or a `fetch` — wrap it in `apiUrl()` from `src/base-path.js`. Axios call sites are handled by an interceptor. See §2.6b.
- **Cover cache keys:** each cover variant is a *separate* Cache Storage entry (`/api/cover/:id`, `?type=main`, `?type=sam`), and different components request different ones (`Cover` the bare URL, `WorkListItem`/the player `?type=sam`, `WorkDetails`/the Downloads page `?type=main`). `WorkDetails.toggleWorkOfflineDownload` therefore caches all three. Manifests written before that change hold only `?type=main`, which is why `Downloads.vue` passes the manifest's own cover URL down via the `coverUrl` prop instead of relying on the default variant being cached.
- **LocalStorage Keys (reserved):**
  | Key | Type | Purpose |
  |-----|------|---------|
  | `swap_seek_button` | boolean | Swap seek/next buttons |
  | `flip_lr_channel` | boolean | Swap left/right audio channels |
  | `auto_mark_listened` | boolean | Auto-mark a work as listened on last track end (default `true`) |
  | `rewind_seek_time` | number | Rewind step in seconds (default 5) |
  | `forward_seek_time` | number | Forward step in seconds (default 30) |
  | `enable_pip_lyrics` | boolean | Picture-in-picture lyrics (force-disabled on Android) |
  | `ai_server_url` | string | AI server URL (unused?) |
  | `old_work_card_ui_style_key` | boolean | Legacy card UI toggle |
  | `app_language` | string | UI locale (`zh-CN`/`en-US`/`ja-JP`/`zh-TW`); set by the Settings language switcher, auto-detected from browser on first load |
  | `tag_language` | string | Tag display locale — one of the four locales, or `follow` (default) to track `app_language`. See §2.10 |
  | `downloaded_files` | array | Offline-download manifest (`module-Downloads/state.js`): `{url, workId, trackId, type, title, workTitle, bytes, downloadedAt}[]`, plus `contentHash`/`duration` on audio rows. Metadata only — actual bytes live in the service worker's Cache Storage, not here. Those two extra fields are what lets `Downloads.playWork` build a queue that can report progress and show a track length with no tree to read from; manifests written before they were recorded simply lack them. |
  | `downloads_list_mode` | boolean | Downloads page grid/list toggle (separate from the Works page's `listMode`) |
  | `downloads_sort_by` | string | Downloads page sort (`downloadedAt`/`title`/`size`) |

---

## 4. Dependencies

| Dependency | Purpose |
|------------|---------|
| `quasar` | UI framework (Material Design components) |
| `@quasar/app-webpack` | Build toolchain (webpack-based) |
| `vue` + `vue-router` + `vuex` | Core SPA framework (Vue 3) |
| `vue-i18n` | UI string internationalization (v9, legacy mode) |
| `axios` | HTTP client for REST API |
| `socket.io-client` | WebSocket client for scan progress |
| `plyr` | Façade over the hidden `<audio>` element (its own UI is unused) |
| `lrc-file-parser` | LRC lyrics file parser |
| `@quasar/extras` | Roboto font + Material icons (see `extras` in `quasar.config.js`) |
| `register-service-worker` | PWA service worker registration |
| `sass` | SCSS preprocessing |
| `@material/material-color-utilities` | (dev) Generates `material-theme.json` via `npm run theme` |

---

## 5. Scripts

```bash
npm install        # Install dependencies

npm run dev        # quasar dev -m pwa (proxies /api + /socket.io to localhost:8888)

npm run build      # quasar build -m pwa --debug  (NOTE: debug build)
npm run build:prod # quasar build -m pwa          (use this for releases)

npm test           # Run ESLint
npm run theme      # Regenerate material-theme.json / .scss from the seed color
```

Both build targets are **PWA**, not SPA, and output to `../backend/dist` (`distDir` in
`quasar.config.js`) so the backend serves them as static content.

---

## 5b. Track Titles

`WorkTree.vue` renders a track as `item.trackTitle || item.title`. `title` is always the real filename; `trackTitle` is an optional scraped/extracted display name present only on audio nodes whose work has `memo.trackTitles` populated. When both exist the filename is shown as a caption underneath.

Never swap the two: `title` is what the backend builds media URLs from (see `backend/AGENTS.md` §2.9b).

## 6. API Contract (Consumed from Backend)

| Endpoint | Method | Used In | Purpose |
|----------|--------|---------|---------|
| `/api/auth/me` | GET | `MainLayout.vue` | Get current user + auth status |
| `/api/auth/me` | POST | `Login.vue` | Log in; server sets the session cookie. **Login POSTs to `/api/auth/me`** — there is no `/api/auth/login` |
| `/api/auth/logout` | POST | `MainLayout.vue` | Destroy the server-side session and clear the cookie |
| `/api/works` | GET | `Works.vue` | List/search works (paginated, sorted, filtered) |
| `/api/work/:id` | GET | `Work.vue`, `Downloads.vue` | Get work metadata + playback state. `Downloads.vue` fetches one per downloaded work to render real `WorkCard`s; served from the SW cache when offline |
| `/api/tags` | GET | `List.vue` | List all tags |
| `/api/circles` | GET | `List.vue` | List all circles |
| `/api/vas` | GET | `List.vue` | List all VAs |
| `/api/media/stream/:trackId` | GET | `AudioElement.vue`, `WorkTree.vue` | Stream a track (supports Range). Feeds `<audio src>` directly; the session cookie authenticates it, so the URL carries no credential |
| `/api/media/download/:trackId` | GET | `WorkTree.vue` | Download a file |
| `/api/media/offline/:trackId` | GET | `AudioElement.vue`, `WorkTree.vue`, `WorkDetails.vue`, `src/utils/downloads.js` | Best offline-friendly copy of a track (transcoded Opus for lossless sources, as-is otherwise). Populates the `offline-tracks` Cache Storage bucket via the explicit download action; `AudioElement.vue`'s `source` computed prefers this URL once a track is downloaded, online or offline (see `module-Downloads`). |
| `/api/media/check-lrc/:trackId` | GET | `AudioElement.vue` | Lyric sidecar files for a track; returns `{result, lyrics: [{trackId, lyricExtension}]}`, one entry per speaker (see §2.9). `trackId`/`lyricExtension` are also returned flat for pre-multi-speaker clients, and `AudioElement.vue` still falls back to them. |
| `/api/cover/:id` | GET | `Cover.vue`, `AudioElement.vue`, `WorkListItem.vue`, `Downloads.vue` | Get cover image (`?type=main\|240x240\|sam`). Each variant is its own cache key — see the cover-cache-keys note in §3 |
| `/api/tracks/:id` | GET | `Work.vue` | Track tree for a work (see Phase 2 note below) |
| `/api/review` | GET/PUT/DELETE | `WorkDetails.vue`, `Favourites.vue`, `AudioElement.vue` | Work reviews; the work is identified by a `work_id` body field or query param, not a path segment. PUT with `progressOnly=true` and `autoMark=true` only writes `progress='listened'` if existing is not terminal (listened/replay/postponed). |
| `/api/review/progress` | DELETE | `WorkDetails.vue` | Clear only `progress` (NULL), preserving rating/review_text. If the row has no rating/review_text, the whole row is deleted. Query `work_id`. |
| `/api/history` | GET | `Favourites.vue`, `RecentWorks.vue` | List works with playback history. Optional `excludeFinished` (`all`|`listened`, default `listened`). Response items include nullable `progress`. |
| `/api/search` | GET | `Works.vue` | **The only filter mechanism.** `filter` is an E-Hentai style filter (`va:"name$"`, `circle:under_score`, `-tag:NTR`, ANDed); parsed server-side, see `backend/AGENTS.md` §2.3b. Every label link builds one via `labelRoute()` in `src/utils.js`; the per-entity `/:id/works` endpoints are gone |
| `/api/version` | GET | `MainLayout.vue` | Version + update info |
| `/api/config/admin` | GET/PUT | `Folders.vue`, `Advanced.vue` | Admin config read/write |
| `/api/credentials/user` | POST/PUT/DELETE | `UserManage.vue` | Create / update / delete a user |
| `/api/credentials/users` | GET | `UserManage.vue` | List users (admin) |
| `/api/backfill/progress` | GET | `Backfill.vue` | Metadata backfill progress |
| `/api/refresh/:id` | POST | `WorkDetails.vue` | Re-fetch metadata for one work |
| `/api/work/scan/:id` | POST | `WorkDetails.vue` | Rescan a single work |
| `/api/work/:id` | PUT | `EditMetadata.vue` | Manually edit work metadata (admin only). Work id is a string: DLsite RJ-padded (`\d{6,8}`) or Fanza (`d\d+`, underscore-free — `isFanzaId`/`fanzaCid` in `src/utils.js`; DMM's own `d_215444` only appears in links out to DMM). |
| `/api/illustrators` | GET | `EditMetadata.vue` | List illustrators (autocomplete) |
| `/api/script_writers` | GET | `EditMetadata.vue` | List script writers (autocomplete) |
| `/api/seriess` | GET | `EditMetadata.vue` | List series (autocomplete; irregular plural) |
| `/api/track-progress` | PUT | `AudioElement.vue`, `AudioPlayer.vue` | Report per-track playback progress. Accepts `{work_id, contentHash, seconds, completed}`. Fire-and-forget write. |

> **Tracks response:** `GET /api/tracks/:id` returns `{ tree, trackProgress }` (breaking shape change; `Work.vue` handles both via `response.data.tree || response.data`). Audio nodes arrive with `contentHash` already populated — the backend hashes before building the tree — so progress badges paint on first render and any queue committed from the tree carries its hashes. The first open of a work is slower for it (the backend streams the audio once, then caches by mtime). `trackProgress` is a `{contentHash: {seconds, completed}}` map. **Do not reintroduce a second request for hashes:** a queue committed before hashes arrive is serialized into `t_play_history` by `toQueueItem`, and the resume-from-history paths (`RecentWorks.vue`, `FavListItem.vue`) never fetch the tree, so such a row can never recover its hashes — `POST /api/backfill/progress` is the only repair.

> **Note:** Library scanning is **not** a REST endpoint. `Scanner.vue` triggers scans over Socket.IO (`PERFORM_SCAN` / `PERFORM_UPDATE` / `PERFORM_LYRIC_SCAN` / `KILL_SCAN_PROCESS`) and listens for the `SCAN_*` events.

---

## 7. Monorepo Integration

Build output goes directly into `backend/dist/` (configured via `distDir` in `quasar.config.js`).

- **Workspace scripts:** `npm run dev:frontend` / `npm run build:frontend` from root.
- **Dev proxy:** `quasar dev` proxies `/api` and `/socket.io` to `localhost:8888`.
- **Socket.IO client:** Exposed globally as `$socket` (`src/boot/socket.io.js`), connects after auth. Drives library scanning in `Scanner.vue` — emits `PERFORM_SCAN` / `PERFORM_UPDATE` / `PERFORM_LYRIC_SCAN` / `KILL_SCAN_PROCESS` / `ON_SCANNER_PAGE` and listens for `SCAN_INIT_STATE`, `SCAN_TASKS`, `SCAN_FAILED_TASKS`, `SCAN_MAIN_LOGS`, `SCAN_RESULTS`, `SCAN_FINISHED`, `SCAN_ERROR`.

---

## 8. Common Development Tasks

### Adding a new page
1. Create a Vue component in `src/pages/` (or `src/pages/Dashboard/`).
2. Add a route entry in `router/routes.js`.
3. Add a navigation link in `MainLayout.vue`'s `links` array if needed.
4. **i18n:** create `src/i18n/parts/{zh-CN,en-US,ja-JP}/<scope>.js` (scope = filename lowercased) with the page's keys, and use `$t('scope.key')` for all user-visible strings. See `src/i18n/CONVENTIONS.md`.

### Adding a new component
1. Create a Vue component in `src/components/`.
2. Import and register it in the parent component.
3. **i18n:** same as adding a page — create the three per-scope partials and use `$t`/`$tTag`. Do NOT edit `src/i18n/index.js` (partials are auto-discovered).

### Adding a new Vuex store module
1. Create a directory under `src/store/module-<Name>/` with `index.js`, `state.js`, `getters.js`, `mutations.js`, `actions.js`.
2. Import and register it in `src/store/index.js`.

### Adding a new boot file
1. Create file in `src/boot/` following the Quasar boot pattern.
2. Add the filename (without extension) to the `boot` array in `quasar.config.js`.
### Adding a persisted setting (LocalStorage)
1. Add a new key constant in `module-AudioPlayer/state.js` (see existing pattern with `SWAP_SEEK_BUTTON_KEY` etc.).
2. Add the state field with initialization from `LocalStorage.getItem()`.
3. Add corresponding mutation and use it in the component.

---

## 9. Testing

- **Linting:** ESLint with Vue plugin
- **Run:** `npm test` from `frontend/`, or `npm run lint` from the repo root (there is no root `npm test`). The root script lints the backend first and **currently fails** on a pre-existing `backend/app.js` hashbang error, so run the frontend lint directly when checking frontend changes.

---

## 10. Development Tips

- **Auth in dev:** If auth is enabled, log in via `/login` first. The session cookie survives hot reloads. Note `config.auth` defaults to `false` outside `NODE_ENV=production`, so auth is usually off in dev.
- **Dark mode:** Quasar's `Dark` plugin respects OS preference (`dark: auto`). Toggle via `Dark.toggle()` in `MainLayout.vue`.
- **Component debugging:** Install Vue DevTools for inspecting Vuex state and component hierarchy.
