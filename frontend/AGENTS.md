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
│   │   └── downloads.js                  # Offline downloads: cacheFile/uncacheFile (per-track, foreground) + buildWorkDownloadPlan/startWorkDownload/reconcileDownloads/onDownloadMessage (whole-work, Background Fetch)
│   ├── css/
│   │   ├── app.scss                      # Global styles
│   │   ├── material-theme.scss           # Generated Material theme tokens
│   │   ├── theme-utilities.scss          # Theme helper classes/mixins
│   │   └── quasar.variables.scss         # Quasar SCSS variables
│   ├── boot/                             # App boot files (run before mount)
│   │   ├── axios.js                      # Axios instance + withCredentials for the session cookie
│   │   ├── i18n.js                       # vue-i18n registration + Quasar lang sync + $tTag
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
│   │   ├── WorkCard.vue                  # Work card (grid mode); optional `coverUrl` prop overrides the cover source
│   │   ├── OldWorkCard.vue               # Legacy work card style
│   │   ├── WorkListItem.vue              # Work list item (list mode); optional `coverUrl` prop + `side` slot for trailing actions
│   │   ├── WorkDetails.vue               # Work detail panel (metadata, review, rating; opens EditMetadata for admins)
│   │   ├── EditMetadata.vue             # Admin-only metadata edit dialog (PUT /api/work/:id)
│   │   ├── WorkTree.vue                  # Track tree view for a work
│   │   ├── CoverSFW.vue                  # Cover image with NSFW blur; optional `coverUrl` prop overrides `/api/cover/:id`
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
| `/favourites/folder` | — | Favourites | Folder view |
| `/favourites/history` | — | Favourites | Play history |
| `/:pathMatch(.*)*` | — | Error404 | Catch-all, appended unless `MODE === 'ssr'` |

The `/favourites/*` children are generated by the `prefixRoutes` helper at the top of `routes.js`; each one renders the same `Favourites` page with different `props`.

**Key detail:** The `Works` page is kept alive via `<keep-alive include="Works">` in `MainLayout`, preserving scroll position and state when navigating back.

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
  currentLyric: '',
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
  downloadedFiles: [], // { url, workId, trackId, type: 'audio'|'lyric'|'cover'|'metadata', title, workTitle, bytes, downloadedAt }[], persisted to LocalStorage `downloaded_files`
  enableTranscoding: false, // from GET /api/config/shared, fetched once in MainLayout.vue on boot; gates whether download UI is shown
}
```
Unlike `AudioPlayer`/`User`, has no real actions (matches the existing convention — this app uses Vuex for state+mutations only, never `dispatch`; async orchestration lives in component methods or `src/utils/downloads.js`). Key getters: `isDownloaded(trackId)` (audio only — drives `AudioElement.vue`'s `source` computed and the per-track UI toggle), `isFileDownloaded(trackId)` (any type — used for lyric files, which have their own trackId), `isWorkDownloaded(workId)`, `totalDownloadedBytes`. `Downloads.vue` reads the raw `downloadedFiles` state and groups it by `workId` itself (the manifest order within a work is the tree order the download walked).

### 2.4 Boot Files

| Boot File | File | Purpose |
|-----------|------|---------|
| `axios.js` | `src/boot/axios.js` | Configures Axios defaults (Content-Type, `withCredentials`); clears the legacy `jwt-token` LocalStorage key; exposes `$axios` globally |
| `i18n.js` | `src/boot/i18n.js` | Registers `vue-i18n`, syncs the Quasar lang pack to the current locale, exposes `$tTag(name)` globally, exports `changeLanguage(locale)` |
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
- **LyricsBar.vue** — Parses LRC files and syncs with playback position.
- **PIPLyrics.vue** — Picture-in-picture mode for desktop browsers (disabled on Android).
- Configuration like seek times, L/R channel flip, auto-mark-listened, and PIP lyrics are persisted in `LocalStorage` (keys are exported from `store/module-AudioPlayer/state.js`).

### 2.6 Communication with Backend

- **REST API:** All data operations via Axios (`/api/*` endpoints). **The frontend stores no credential of any kind.** Auth is a server-side session in an `HttpOnly` cookie (`kikoeru_sid`) that the browser attaches automatically, including to `<audio>`, `<img>`, and download URLs.
- **Never append `?token=` to an API URL.** That pattern was removed when auth moved to cookies; media and cover URLs are now built bare, e.g. `/api/media/stream/${trackId}` and `/api/cover/${workId}?type=sam`.
- `<audio crossorigin="anonymous">` in `AudioElement.vue` sets credentials mode `same-origin`, so the cookie *is* sent on same-origin media requests. Do not change this to `use-credentials` without testing playback.
- **WebSocket (Socket.IO):** Used for real-time scan progress updates. The client connects after auth and **both emits and listens**: it emits `PERFORM_SCAN`, `PERFORM_UPDATE`, `PERFORM_LYRIC_SCAN`, `KILL_SCAN_PROCESS`, `ON_SCANNER_PAGE`, and listens for `SCAN_INIT_STATE`, `SCAN_TASKS`, `SCAN_FAILED_TASKS`, `SCAN_MAIN_LOGS`, `SCAN_RESULTS`, `SCAN_FINISHED`, `SCAN_ERROR` (all handled in `pages/Dashboard/Scanner.vue`).
- **Seek times are client-side:** `rewindSeekTime` / `forwardSeekTime` are read from `LocalStorage` in `module-AudioPlayer/state.js` (defaults 5s / 30s), not fetched from the server.

### 2.7 Key Frontend Features

1. **Infinite Scroll:** `Works.vue` uses `q-infinite-scroll` to paginate results (triggers `onLoad()` callback).

2. **Cover Blurring:** `CoverSFW.vue` handles NSFW content blurring with a toggle.
3. **Sleep Timer:** `SleepMode.vue` (opened from the bedtime button in `AudioPlayer.vue`'s settings row) stops playback either after a chosen number of minutes (5-min slider steps) or after a chosen number of tracks past the current one. The armed timer is persisted in `SessionStorage` under the `sleepTimer` key (`SLEEP_TIMER_KEY`) and restored on reload; stop logic lives in `AudioElement.vue` (`onTimeupdate` for minutes, `onEnded` for tracks).
4. **Dark Mode:** Toggled via Quasar's `Dark` plugin, persisted in browser across sessions.
5. **Progress Tracking:** Users can mark works as `listening`, `listened`, `replay`, or `postponed`.
6. **Work Card Variants:** Two card styles — modern `WorkCard.vue` (hover-reveal tags) and legacy `OldWorkCard.vue` (always-show tags), toggleable via LocalStorage key `old_work_card_ui_style_key`.
7. **Metadata Editing (admin only):** `WorkDetails.vue` shows an "edit metadata" button (i18n key) only when the current user is an admin (computed `isAdmin`: auth disabled, or `group === 'administrator'`, or `name === 'admin'`). It opens `EditMetadata.vue`, which PUTs to `/api/work/:id` with `{title, nsfw, release, circle, tags[], vas[], illustrators[], scriptWriters[], series}` — **tag names sent are the canonical Japanese names** (the backend canonicalizes them again via `resolveTagLabel`). Tag/VA/illustrator/script-writer/series inputs use Quasar `q-select` with `use-input` autocomplete, fetching options from `/api/tags`, `/api/vas`, `/api/illustrators`, `/api/script_writers`, `/api/seriess` (note the irregular plural `seriess`). For tags, the option **label** is the translated name (`$tTag`) but the bound **value** is the canonical Japanese name, so users can search in their language while storage stays canonical. On save, the dialog emits `saved` and `WorkDetails.vue` re-reads the work metadata.
8. **Keyboard Shortcuts:** Space for play/pause, arrow keys for seeking, etc. (handled in AudioPlayer).

### 2.8 Internationalization (i18n)

Two separate translation layers, kept apart:

1. **Static UI strings** → `vue-i18n` v9 (legacy mode, Options API). `$t('scope.key')` in templates, `this.$t(...)` in script. The instance is created in `src/i18n/index.js` and registered by `src/boot/i18n.js` (in the `boot` array, `quasar.config.js`).
2. **Dynamic tag names** → `translateTag(name, locale)` in `src/i18n/tags/index.js`, exposed as `$tTag(name)` via the i18n boot. Tag names are DATA (canonical Japanese from the backend), so they live in hand-maintained JSON maps (`src/i18n/tags/{zh-CN,en-US,zh-TW}.json`), NOT in the vue-i18n catalog. `ja-JP` is the identity (no map). Unmapped tags fall back to the Japanese name.

**Locales:** `zh-CN` (base/`fallbackLocale`, complete), `en-US`, `ja-JP` (complete), `zh-TW` (stub, falls back to `zh-CN`).

**Catalog layout:** per-scope partial files under `src/i18n/parts/<locale>/<scope>.js` (scope = `.vue` filename lowercased), auto-discovered by `require.context` in `src/i18n/index.js` — adding a partial file is enough; do NOT edit `index.js` per scope. Shared strings live under scope `common` (`parts/<locale>/common.js`). Conventions are documented in `src/i18n/CONVENTIONS.md` (read before editing).

**Locale resolution (per-user):** on boot, `getInitialLocale()` checks LocalStorage `app_language` → else matches `navigator.language` (exact, then prefix; `zh-TW`/`zh-HK` → `zh-CN`) → else `zh-CN`. The choice is persisted in LocalStorage `app_language`.

**Language switcher:** a clickable item in the `MainLayout.vue` sidebar (icon `language`) cycles through locales on click, calling `changeLanguage(locale)` from `src/boot/i18n.js`, which updates `vue-i18n`, the Quasar lang pack (`Quasar.lang.set`), and LocalStorage. The dead server `tagLanguage` config and its radio group were **removed** (scrapers always fetch Japanese; tag language is now a display concern, resolved client-side).

**Quasar lang sync:** `src/boot/i18n.js` dynamically imports the matching `quasar/lang/*` pack (`zh-CN`, `en-US`, `ja`; `zh-TW` reuses `zh-CN`) and falls back to `en-US` on load failure. `quasar.config.js` `framework.lang: 'en-US'` remains the build-time default and is overridden at boot.

**Tag identity vs display:** the backend stores canonical Japanese tag names (canonicalized via `backend/scraper/tag-aliases.json` — see `backend/AGENTS.md` §2.3). The frontend's tag-translation maps are keyed by that canonical name, so the frontend never deals with renames. Display sites use `$tTag(tag.name)`; the editor (`EditMetadata.vue`) keeps canonical `tag.name` as the stored/bound value.

---

## 3. Critical Conventions & Gotchas

- **Session Management:** The session cookie is `HttpOnly`, so JS cannot read it and there is nothing to manage client-side. `MainLayout.initUser()` calls `GET /api/auth/me` on boot; a 401 redirects to `/login`. Logout is `POST /api/auth/logout`, which destroys the server-side session — clearing client state alone is no longer enough.
- **Keep-Alive:** `Works` page is wrapped in `<keep-alive include="Works">` in `MainLayout.vue`. Its `activated` hook should be used for data refreshes when returning from other pages.
- **SPA History Fallback:** The backend uses `connect-history-api-fallback` so Vue Router handles all non-`/api` routes. No hash routing needed.
- **Dev Server Proxy:** In development (`quasar dev`), `quasar.config.js` proxies `/api` and `/socket.io` to `localhost:8888` (the backend).
- **Service Worker:** PWA mode uses Workbox in **InjectManifest** mode — the worker is hand-written at `src-pwa/custom-service-worker.js`, not generated. `quasar.config.js` now carries only *build-time* PWA options (`extendInjectManifestOptions` → the precache `exclude` list, and `extendPWACustomSWConf` → the esbuild target); all *runtime* behaviour (`skipWaiting`/`clientsClaim`, navigation fallback, caching routes) lives in the worker file. The switch from GenerateSW was required because a generated worker can only express routes, and the offline-download feature needs SW event handlers (Background Fetch).
  - The worker excludes `/api/*` and `/media/*` from navigation fallback, and registers three routes (all into a single `offline-tracks` Cache Storage bucket): `CacheFirst` + `RangeRequestsPlugin` on `/api/media/offline/*` (tracks/lyrics), `CacheFirst` on `/api/cover/*` (work covers), and `NetworkFirst` on `/api/work/:id`, `/api/tracks/:id`, `/api/work/:id/memo`, `/api/review` (work-detail page JSON — live data when online, cached snapshot as offline fallback). The first two are populated only by the explicit download action (`src/utils/downloads.js`), never by ordinary streaming; the third also auto-populates on any successful browse, since JSON metadata is small and bounding it risks evicting a downloaded work's snapshot.
  - **Match routes on `url.pathname`, never on an `^/api/...`-anchored RegExp.** Workbox's `RegExpRoute` execs the pattern against the *absolute* URL (`url.href`, e.g. `https://host/api/...`), so a leading `^\/api\/` can never match. The original `runtimeCaching` config made exactly this mistake and all three routes were silently dead — downloads were written to Cache Storage by the page but never served back from it, so offline playback did not work. (`NavigationRoute`'s denylist is unaffected: it matches on `url.pathname + url.search`, which is why navigation exclusion always worked.)
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
- **Cover cache keys:** each cover variant is a *separate* Cache Storage entry (`/api/cover/:id`, `?type=main`, `?type=sam`), and different components request different ones (`CoverSFW` the bare URL, `WorkListItem`/the player `?type=sam`, `WorkDetails`/the Downloads page `?type=main`). `WorkDetails.toggleWorkOfflineDownload` therefore caches all three. Manifests written before that change hold only `?type=main`, which is why `Downloads.vue` passes the manifest's own cover URL down via the `coverUrl` prop instead of relying on the default variant being cached.
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
  | `app_language` | string | UI locale (`zh-CN`/`en-US`/`ja-JP`/`zh-TW`); set by the MainLayout sidebar language switcher, auto-detected from browser on first load |
  | `downloaded_files` | array | Offline-download manifest (`module-Downloads/state.js`): `{url, workId, trackId, type, title, workTitle, bytes, downloadedAt}[]`. Metadata only — actual bytes live in the service worker's Cache Storage, not here. |
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

## 6. API Contract (Consumed from Backend)

| Endpoint | Method | Used In | Purpose |
|----------|--------|---------|---------|
| `/api/auth/me` | GET | `MainLayout.vue` | Get current user + auth status |
| `/api/auth/me` | POST | `Login.vue` | Log in; server sets the session cookie. **Login POSTs to `/api/auth/me`** — there is no `/api/auth/login` |
| `/api/auth/logout` | POST | `MainLayout.vue` | Destroy the server-side session and clear the cookie |
| `/api/works` | GET | `Works.vue` | List/search works (paginated, sorted, filtered) |
| `/api/work/:id` | GET | `Work.vue`, `Downloads.vue` | Get work metadata + playback state. `Downloads.vue` fetches one per downloaded work to render real `WorkCard`s; served from the SW cache when offline |
| `/api/work/:id/memo` | GET | `Work.vue` | Get work memo incl. lazily-computed content hashes (`{ contentHash: { relPath: contentHash } }`). Only endpoint reading audio file bytes; fetched after tree renders, merged onto nodes by `relPath` to populate per-track badges. |
| `/api/tags` | GET | `List.vue` | List all tags |
| `/api/circles` | GET | `List.vue` | List all circles |
| `/api/vas` | GET | `List.vue` | List all VAs |
| `/api/media/stream/:trackId` | GET | `AudioElement.vue`, `WorkTree.vue` | Stream a track (supports Range). Feeds `<audio src>` directly; the session cookie authenticates it, so the URL carries no credential |
| `/api/media/download/:trackId` | GET | `WorkTree.vue` | Download a file |
| `/api/media/offline/:trackId` | GET | `AudioElement.vue`, `WorkTree.vue`, `WorkDetails.vue`, `src/utils/downloads.js` | Best offline-friendly copy of a track (transcoded Opus for lossless sources, as-is otherwise). Populates the `offline-tracks` Cache Storage bucket via the explicit download action; `AudioElement.vue`'s `source` computed prefers this URL once a track is downloaded, online or offline (see `module-Downloads`). |
| `/api/media/check-lrc/:trackId` | GET | `AudioElement.vue` | Check whether a track has lyrics; returns `{result, trackId, lyricExtension}` |
| `/api/cover/:id` | GET | `CoverSFW.vue`, `AudioElement.vue`, `WorkListItem.vue`, `Downloads.vue` | Get cover image (`?type=main\|240x240\|sam`). Each variant is its own cache key — see the cover-cache-keys note in §3 |
| `/api/tracks/:id` | GET | `Work.vue` | Track tree for a work (see Phase 2 note below) |
| `/api/review` | GET/PUT/DELETE | `WorkDetails.vue`, `Favourites.vue`, `AudioElement.vue` | Work reviews; the work is identified by a `work_id` body field or query param, not a path segment. PUT with `progressOnly=true` and `autoMark=true` only writes `progress='listened'` if existing is not terminal (listened/replay/postponed). |
| `/api/review/progress` | DELETE | `WorkDetails.vue` | Clear only `progress` (NULL), preserving rating/review_text. If the row has no rating/review_text, the whole row is deleted. Query `work_id`. |
| `/api/history` | GET | `Favourites.vue`, `RecentWorks.vue` | List works with playback history. Optional `excludeFinished` (`all`|`listened`, default `listened`). Response items include nullable `progress`. |
| `/api/search` | GET | `Works.vue` | Keyword search |
| `/api/version` | GET | `MainLayout.vue` | Version + update info |
| `/api/config/admin` | GET/PUT | `Folders.vue`, `Advanced.vue` | Admin config read/write |
| `/api/credentials/user` | POST/PUT/DELETE | `UserManage.vue` | Create / update / delete a user |
| `/api/credentials/users` | GET | `UserManage.vue` | List users (admin) |
| `/api/backfill/progress` | GET | `Backfill.vue` | Metadata backfill progress |
| `/api/refresh/:id` | POST | `WorkDetails.vue` | Re-fetch metadata for one work |
| `/api/work/scan/:id` | POST | `WorkDetails.vue` | Rescan a single work |
| `/api/{tags,circles,vas,illustrators,script_writers,seriess}/:id/works` | GET | `List.vue`, `Works.vue` | Works filtered by that entity |
| `/api/work/:id` | PUT | `EditMetadata.vue` | Manually edit work metadata (admin only). Work id is a string: DLsite RJ-padded (`\d{6,8}`) or Fanza cid (`d_\d+`). |
| `/api/illustrators` | GET | `EditMetadata.vue` | List illustrators (autocomplete) |
| `/api/script_writers` | GET | `EditMetadata.vue` | List script writers (autocomplete) |
| `/api/seriess` | GET | `EditMetadata.vue` | List series (autocomplete; irregular plural) |
| `/api/track-progress` | PUT | `AudioElement.vue`, `AudioPlayer.vue` | Report per-track playback progress. Accepts `{work_id, contentHash, seconds, completed}`. Fire-and-forget write. |

> **Tracks response (Phase 2):** `GET /api/tracks/:id` returns `{ tree, trackProgress }` (breaking shape change; `Work.vue` handles both via `response.data.tree || response.data`). The tree is built from the directory listing + `memo` **without reading audio file bytes** — `contentHash` on audio nodes is populated only from cached `memo.hash` (null/undefined where not yet hashed). Audio nodes carry `relPath` (relative path from work root) as the stable key the frontend uses to merge late-arriving hashes from `GET /api/work/:id/memo` (the only endpoint reading file bytes). `trackProgress` is a `{contentHash: {seconds, completed}}` map.

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
