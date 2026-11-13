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
│   ├── index.html                        # HTML template (this one, not src/index.template.html)
│   ├── utils.js                          # Shared utility functions
│   ├── material-theme.json               # Generated Material color tokens (see scripts/generate-theme.mjs)
│   ├── utils/
│   │   ├── contrast.js                   # Contrast-ratio helpers for theme-aware text colors
│   │   ├── downloads.js                  # Offline downloads: cacheFile/uncacheFile (per-track, foreground) + buildWorkDownloadPlan/startWorkDownload/reconcileDownloads/onDownloadMessage (whole-work, Background Fetch)
│   │   ├── idb.js                        # The one IndexedDB database, shared by outbox + positions (§3b)
│   │   ├── service-worker.js             # activeRegistration(): the worker lookup that cannot hang
│   │   ├── lyrics.js                     # Per-speaker lyric colours + MAX_LYRIC_STREAMS
│   │   ├── outbox.js                     # Durable delivery queue for playback-state writes, drained by Background Sync
│   │   ├── positions.js                  # Local-first playback position: savePosition/positionsForWork/mergePositions (§3b)
│   │   └── subtitles.js                  # SRT/VTT/LRC parsing + stream merging (§2.9)
│   ├── css/
│   │   ├── app.scss                      # Global styles
│   │   ├── material-theme.scss           # Generated Material theme tokens
│   │   ├── theme-utilities.scss          # Theme helper classes/mixins
│   │   └── quasar.variables.scss         # Quasar SCSS variables
│   ├── boot/                             # App boot files (run before mount)
│   │   ├── axios.js                      # Axios instance + withCredentials for the session cookie
│   │   ├── i18n.js                       # vue-i18n registration + Quasar lang sync + language switchers
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
│   │   ├── TextViewer.vue                # In-app text file viewer (route /text/:trackId)
│   │   ├── Downloads.vue                 # Offline library: manifest grouped by work, rendered with WorkCard/WorkListItem (grid/list toggle, sort), storage quota, play-all, per-work/per-track remove
│   │   ├── Settings.vue                  # Per-user settings (theme, language, tag language, player prefs) — route /settings, in MainLayout
│   │   ├── Error404.vue                  # 404 page
│   │   └── Dashboard/
│   │       ├── Folders.vue               # Library folder management
│   │       ├── Scanner.vue               # Scan controls + progress
│   │       ├── Advanced.vue              # Advanced settings
│   │       └── UserManage.vue            # User management (admin)
│   ├── components/
│   │   ├── AudioPlayer.vue               # Main audio player (floating panel)
│   │   ├── AudioElement.vue              # Playback engine: hidden <audio> + Plyr + mediaSession
│   │   ├── PlayerBar.vue               # Docked three-row player bar (mounted; see §2.5)
│   │   ├── LyricsBar.vue                 # Floating lyric window above the bar (see §2.9)
│   │   ├── LyricsFullScreen.vue          # Full-screen scrolling lyrics overlay (see §2.9)
│   │   ├── SeekUndoPill.vue              # "Back to mm:ss" pill after a seek-bar jump
│   │   ├── WorkCard.vue                  # Work card (grid mode); `oldStyle` prop switches to the legacy look; optional `coverUrl` prop overrides the cover source
│   │   ├── WorkListItem.vue              # Work list item (list mode); optional `coverUrl` prop + `side` slot for trailing actions
│   │   ├── WorkDetails.vue               # Work detail panel (metadata, review, rating; opens EditMetadata for admins)
│   │   ├── EditMetadata.vue             # Admin-only metadata edit dialog (PUT /api/work/:id)
│   │   ├── EditTrackTitles.vue          # Admin-only track-title edit dialog, opened from EditMetadata (PUT /api/work/:id/file-metadata)
│   │   ├── TranscribeTracks.vue         # Admin-only ASR dialog, opened from EditMetadata (TRANSCRIBE_WORK over Socket.IO)
│   │   ├── WorkTree.vue                  # Track tree view for a work
│   │   ├── WorkDescription.vue           # Scraped DLsite description, sanitized markup via v-html (Description tab of Work.vue)
│   │   ├── WorkGallery.vue               # Work-page cover carousel: cover + scraped images
│   │   ├── ImageViewer.vue               # Maximized image viewer with pinch/wheel zoom + pan (work tree and gallery)
│   │   ├── Cover.vue                     # Cover image + id/release/tag chips (cards/lists/player); optional `coverUrl` prop overrides `/api/cover/:id`
│   │   ├── RecentWorks.vue               # Recently played works section
│   │   ├── Scrollable.vue                # One-line marquee for long titles (§3: never leave it running)
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
| `/admin` | `DashboardLayout` | Admin dashboard (folders, scanner, advanced, user mgmt). Only reachable from the drawer for admins — see §2.2a |
| `/` | `MainLayout` | Main app with persistent audio player at bottom |
| `/login` | None | Standalone login page |

Main layout routes:

| Route | Name | Page | Description |
|-------|------|------|-------------|
| `/` | `works` | Works | Media library (grid/list, sort, filter, search) — this is the real route |
| `/works` | — | redirect→`/` | Legacy path, redirects to `/` preserving query. Deliberate: the reverse direction caused a `replaceState` loop that broke back navigation |
| `/work/:id` | — | Work | Work detail + track list. The browsed folder is in the query: `?path=foo/bar` (slash-joined folder names — a slash cannot occur in a folder name, so nothing needs escaping) plus the `#work-tree` anchor, and an open image preview adds `&img=<filename>`, so walking into a folder or opening an image is a history entry and Back goes up one level / closes the preview instead of leaving the work. Paging through images `replace`s rather than pushes, so a folder of 200 images does not need 200 Backs. `Work.vue` therefore watches `$route.params.id`, not `$route` — a query change must not refetch |
| `/text/:trackId(.*)` | — | TextViewer | In-app viewer for `.txt`/`.lrc`/`.srt`/`.ass`/`.vtt`. The param spans slashes because `trackId` is `${workId}/${relPath}`, and a relPath may itself contain subdirectories. Never link to `/api/media/stream/...` directly — a real navigation kills the SPA document (playback stops) and in an installed PWA back exits the app |
| `/settings` | — | Settings | Per-user settings: theme, UI language, tag language, and the player/card preferences (`AudioPlayer` Vuex state). Rendered inside `MainLayout`; `/admin/settings` redirects here. The old admin-dashboard copy of this page was removed, so the only general-settings page is this one |
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

### 2.2a Drawer entries and admin gating

The `MainLayout` drawer is built from a `links` array rendered through `getLinks()`, which drops an entry when `adminOnly` is set and the user is not an admin (`isAdmin`: auth disabled, `User.group === 'administrator'`, or `name === 'admin'` — the same rule `WorkDetails.vue` uses) and when `Full Screen` has no work to open. So **`Settings` (`/settings`) is for everyone and `Admin` (`/admin`) only renders for admins**; the admin dashboard's own drawer entry list lives in `DashboardLayout.vue` and intentionally contains no general-settings page any more. This hides the button only — `/admin` is not route-guarded, and the admin APIs behind it are the actual enforcement (`GET/PUT /api/config/admin` and the admin-only Socket.IO handshake).

**Key detail:** The `Works` and `Favourites` pages are kept alive via `<keep-alive :include="['Works', 'Favourites']">` in `MainLayout`, preserving the loaded list and scroll position when navigating back. The cost is that neither page refetches on return, so a review/progress change made on a work page is not reflected in a cached list until something calls `reset()`.

### 2.3 State Management (Vuex)

**`AudioPlayer` module** — Full playback state (defined in `module-AudioPlayer/state.js`):

```javascript
{
  hide: false,                    // Player panel visibility
  playing: false,                 // Play/pause state
  currentTime: 0,                 // Position in the current track (seconds); set with queueIndex by selectTrack, and a newly loaded track starts from it
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
| `i18n.js` | `src/boot/i18n.js` | Registers `vue-i18n`, syncs the Quasar lang pack and `<html lang>` to the current locale, exports `changeLanguage(locale)` / `changeTagLanguage(locale)` (tag-name translation moved to the `useTagTranslate()` composable) |
| `store.js` | `src/boot/store.js` | Initializes Vuex store |
| `contrast.js` | `src/boot/contrast.js` | Contrast-ratio helpers for picking theme-aware text colors (`src/utils/contrast.js`) |
| `theme.js` | `src/boot/theme.js` | Applies the saved theme preference (LocalStorage `theme_mode` → Quasar `Dark.set`, `src/utils/theme.js`) |
| `plyr.js` | `src/boot/plyr.js` | Imports Plyr + its CSS, exposes the `Plyr` class as `$Plyr` (no component is registered) |
| `socket.io.js` | `src/boot/socket.io.js` | Creates Socket.IO client (autoConnect: false); exposes `$socket` globally |

### 2.5 Audio Player Architecture

The audio player is a multi-component system fixed at the bottom of `MainLayout`:

```
MainLayout
├── PlayerBar      # Docked bar (always visible at bottom when a track plays)
├── AudioPlayer      # The phone's card (cover + controls)
│   └── AudioElement # The actual playback engine (hidden <audio> + Plyr + mediaSession)
├── LyricsBar        # Floating lyric window above the docked bar
└── LyricsFullScreen # Full-screen scrolling lyrics, inset above the bar
```

- **AudioPlayer.vue** — The phone's player card (full screen under 600px; `openPanel()` refuses on a wide screen). Cover, controls, seek, volume (desktop only — phones use the hardware keys and iOS's media volume is read-only), play mode, and `open_in_full` for `LyricsFullScreen`, which also leaves panel mode and so closes the card. Its `⋯` holds the L/R channel toggle and "open work details"; the lyric-offset editor and its sync helper were removed, so nothing sets `lyricOffsetSeconds` any more (the sampling and overlay code still reads it, at 0). Presentational: it renders `AudioElement` and drives it through Vuex.
- **AudioElement.vue** — The playback engine, and the only component that touches the media element. Holds a `display:none` `<audio crossorigin>` with `Plyr` instantiated on it directly (`controls: ['progress']`); Plyr's own UI is never shown, so it acts purely as an event/property façade over the native element. Also owns:
  - `navigator.mediaSession` metadata and lock-screen action handlers (`updateMediaSessionMetadata`), which map play/pause/next/prev/seek back onto Vuex mutations.
  - Optional L/R channel swap (`applyFlipLRChannel`) via a WebAudio `createMediaElementSource → ChannelSplitter → ChannelMerger → destination` graph. `createMediaElementSource` is a one-way door — once called, that `AudioContext` owns the element's output permanently — so the graph is built lazily on first use and only *rewired* on toggle, never torn down until unmount.
  - **Background playback (Android):** `ended` is bound as a direct native listener on the media element, *not* `player.on('ended')` — Plyr proxies the same native event, and registering both advanced the queue two tracks at a time. The next track's source is loaded imperatively (`_loadSource`) **synchronously inside the `ended` handler**, because Chrome freezes hidden pages and the `nextTick`-deferred `source` watcher can lag by minutes. `_loadSource` compares `media.currentSrc` and no-ops when the watcher later fires with the same URL. Do not reintroduce a `<source :src>` binding here; see commit `6fb856c`.
  - **Lyric changes are scheduled to their cue times (§3).** `setLyricStreams` precomputes `_lyricBoundaries`: the sorted union of every cue `start` and every finite cue `end` across all streams, i.e. every instant at which `cueTextAt` can return something different. `sampleLyrics()` publishes the current frame through `SET_CURRENT_LYRICS` and then arms **one `setTimeout`** for the next boundary (`_scheduleLyricSample`), measured in media time (`(next - now) / playbackRate`) and disarmed while paused, ended, stalled or hidden. Its callback re-samples and re-arms, so a timer that fired late (coalesced by the OS, or behind a long task) corrects itself instead of accumulating error. Every other caller — `onTimeupdate`, `seeked`, `onPause`, `onPlaying`, `ratechange`, `visibilitychange`, the `lyricOffsetSeconds` watcher — just calls `sampleLyrics()`, which leaves the schedule correct as a side effect. `timeupdate` (~4x/s) is only a backstop that heals anything the OS swallowed; it publishes nothing unless the text actually changed.
- **PlayerBar.vue** — The bar mounted today: full-bleed 128px (84px under 600px), three rows, transport centred, up to seven actions. `MainLayout` keeps `.padding-bottom-play-bar` in step with its height. The transport shows the current time on the left and the total on the right. Because the transport is centred, the cluster thins out as the window narrows: play mode and the sleep timer move into `⋯` below 1024px (`narrow`), the times drop below 900px and the seek buttons below 800px. Tapping or swiping the bar opens the panel on phones only; `⋯` entries appear only while their button is off the bar. The queue button opens the **play list dialog**, not the panel — its flag is shared state (`queueDialogOpen`) because the dialog lives in `AudioPlayer`. Volume is desktop-only: a button on the bar from 1024px up, and the same slider in `⋯` below that (`volumeInMenu`) — never on phones, which have hardware keys. The L/R channel swap is always a checkable `⋯` entry, at every width. `hide` follows `matchMedia('(min-width: 600px)')` via `SET_HIDE`.
- **SeekUndoPill.vue** — "Back to 12:34" after a seek-bar jump, plus the hollow ghost handle it draws on both seek bars (`useSeekUndo()`, one shared 500 ms clock). **Only the seek bar arms it**: the rail (`seekTo`) and the panel's **`q-slider`** (`onChangeSlider` — not Plyr's progress control, which is `display: none`). The ±seconds buttons, `←`/`→` and lyric rows never arm it, and a jump within 1 s of the current position is ignored. One window, one memory: `ARM_SEEK_UNDO` keeps the first target only while the pill is up (30 s), so a run of scrubbing returns to where the run started and a jump after it has faded starts a new run. Visibility is derived from `seekUndo.at`, never a flag plus a `setTimeout` that a newer seek could outrun.
- **LyricsBar.vue** — Draggable lyric window: one coloured line per stream, stacked (§2.9). Default spot is 132px above the bottom; in panel mode the baseline is placed just above the card's artwork, because settings, seek, transport and volume all sit below it. Measure that with layout metrics (`offsetTop`/`offsetHeight` plus the card's `marginBottom`), never `getBoundingClientRect` — the card slides with `translateY`, and a rect read off-screen or mid-slide pushes the window past the bottom edge. The dragged position is component data bound as a style: the element is destroyed whenever the lyrics go quiet, so a DOM-only position would be lost.
- **LyricsFullScreen.vue** — Full-screen lyric view (§2.9). An overlay, not a route: `fixed`, inset `0 0 128px 0` (`84px` under 600px), `z-index: 3050` — below the bar's `3100` on purpose, so the bar stays visible and keeps owning playback. Follows the active line at 38% of its height; clicking a row seeks to that row's start. Opening it forces `hide = true` (the inset is measured against the bar) and closes the drawer so the bar gets the full width. It is independent of the CC toggle and of whether the track has lyrics: with nothing to draw it is simply blank, so neither button closes or disables the other.
- Configuration like seek times, L/R channel flip, and auto-mark-listened are persisted in `LocalStorage` (keys are exported from `store/module-AudioPlayer/state.js`).

### 2.6 Communication with Backend

- **REST API:** All data operations via Axios (`/api/*` endpoints). **The frontend stores no credential of any kind.** Auth is a server-side session in an `HttpOnly` cookie (`kikoeru_sid`) that the browser attaches automatically, including to `<audio>`, `<img>`, and download URLs.
- **Never append `?token=` to an API URL.** That pattern was removed when auth moved to cookies; media and cover URLs are now built bare, e.g. `/api/media/stream/${trackId}` and `/api/cover/${workId}?type=sam`.
- `<audio crossorigin="anonymous">` in `AudioElement.vue` sets credentials mode `same-origin`, so the cookie *is* sent on same-origin media requests. Do not change this to `use-credentials` without testing playback.
- **WebSocket (Socket.IO):** Used for real-time scan progress updates. The client connects after auth and **both emits and listens**: it emits `PERFORM_SCAN`, `PERFORM_UPDATE`, `PERFORM_WORK_FILE_SCAN`, `KILL_SCAN_PROCESS`, `ON_SCANNER_PAGE`, and listens for `SCAN_MAIN_LOG`, `SCAN_TASK_ADD`, `SCAN_TASK_LOG`, `SCAN_TASK_REMOVE`, `SCAN_FAILED_TASK`, `SCAN_RESULT`, `SCAN_INIT_STATE`, `SCAN_FINISHED`, `SCAN_ERROR` (all handled in `pages/Dashboard/Scanner.vue`). **Scanning is no longer its only use:** `EditTrackTitles.vue` emits `SUGGEST_TRACK_TITLES` and listens for `SUGGEST_TRACK_TITLES_RESULT`/`SUGGEST_TRACK_TITLES_ERROR`, and `TranscribeTracks.vue` emits `TRANSCRIBE_WORK`/`TRANSCRIBE_CANCEL` and listens for `TRANSCRIBE_PROGRESS`/`TRANSCRIBE_RESULT`/`TRANSCRIBE_ERROR` — all sent back to that socket alone rather than broadcast. Anything that can outrun a proxy's request timeout belongs here rather than on a route. Payloads are in `backend/AGENTS.md` §7 — keep the two tables in sync.
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

2. **Work page tabs + cover gallery:** `Work.vue` puts the file tree and the scraped description in `q-tabs` + `q-tab-panels`. **The open tab is plain component state, deliberately not in the url** — a reload or a shared link opens on Files. Putting it in the query was tried and dropped as not worth the machinery; `q-route-tabs` was never an option either, since its active state is matched on the path, which is identical for both tabs, so neither would ever highlight without real child routes. The panels are `keep-alive`, and the tree's own folder/image state lives in `?path=`/`?img=`, so switching tabs keeps the open folder and its scroll position. The tab bar only renders when the work has a description at all. The cover itself is `WorkGallery.vue` — a `q-carousel` over the cover plus every **downloaded** scraped image (see `workImageUrl`), with arrows and an `n/N` counter; a work with nothing downloaded shows just the cover and no counter. Clicking a slide opens **`ImageViewer.vue`**, the same maximized pinch/wheel-zoom viewer the file tree uses — it was lifted out of `WorkTree.vue` for this, and takes `[{name, url}]` plus a two-way `index`, leaving the *source* of that index to the caller: the tree keeps it in `?img=` (so Back closes the preview), the gallery keeps it in the carousel's own slide number. The gallery derives its slide urls and its viewer list from one array, so an image with no local file drops out of both at once rather than shifting the captions by one. `Cover.vue` is untouched and still used by the cards, lists and player; its id/release overlays have no room in the carousel, so the work page prints them next to the title instead.
3. **Cover Blurring:** None. `Cover.vue` renders the cover plus its id/release/tag chips, nothing else. It was called `CoverSFW.vue` until the NSFW blur it was named for turned out never to have been wired up — `:nsfw` was the literal `false` at every call site from the initial commit onward — at which point the dead branch and the misleading name both went. The only age-rating control is the server-side `nsfw=0|1|2` filter in `Works.vue` — see `nsfwFilter` in `backend/database/queries.js`.
4. **Sleep Timer:** `SleepMode.vue` (opened from the bedtime button in `AudioPlayer.vue`'s settings row) stops playback either after a chosen number of minutes (5-min slider steps) or after a chosen number of tracks past the current one. The armed timer is persisted in `SessionStorage` under the `sleepTimer` key (`SLEEP_TIMER_KEY`) and restored on reload; stop logic lives in `AudioElement.vue` (`onTimeupdate` for minutes, `onEnded` for tracks).

   **A tracks-mode stop leaves the queue parked on the track that just finished** — advancing there would report progress for a track the user never heard — so the advance is deferred to their next play (`_advanceIfAtEndOfTrack`, called from the `playing` watcher). A resume opens the same way: the position stored in `t_track_progress` is the end of that track, so the player shows the end of it and only moves on when the user presses play.

   **The position is the whole state.** There is no marker, no session-storage key, nothing to keep in sync: `_atEndOfTrack` asks whether playback sits within `FINISHED_EPSILON_SECONDS` of the current track's duration, and that is true whether the timer fired a second ago, the tab was discarded and rebuilt from history, or the timer stopped on the phone and the resume is on the desktop. What must never happen is *playing* from there without advancing, because an ended media element is the one position browsers disagree on: Chrome rewinds to 0 on the next `play()` (what the spec says an ended element does) and replays the finished track, while Firefox fires `ended` and advances by itself. Both the `playing` watcher and the media-session `play` handler check before letting the element start.

   Firefox needs one more thing: it answers the resume seek by firing `ended`, so `onEnded` runs on a resume that never started and its default branch would advance and play on its own. The guard there is `media.played` — empty until the element has rendered something — and **not** the `playing` state: the spec fires `pause` before `ended`, so `onPause` has already cleared `playing` by the time a *normal* track end reaches `onEnded`, and testing it there stops every advance in the queue. The guard also keeps the spurious event from reporting track progress or marking the work complete.

   Two things the end-of-track check has to be careful about, both about *which* position it is reading:

   - **Until the element has loaded the current track, its clock says nothing about it**: 0 while a resume is still loading, or the outgoing track's position. Picking a track by hand while paused runs the `playing` watcher before the `source` watcher swaps the element over. So the check reads the element only when `_mediaHoldsCurrentTrack` and `readyState >= HAVE_METADATA`, and otherwise reads the store's `currentTime`, which always describes the current track (`selectTrack` in `module-AudioPlayer/mutations.js`). Without it, hand-picking a track right after a sleep-timer stop would skip a track.
   - **Duration comes from the queue item's `duration` memo** for the same reason — the element may not have loaded metadata yet.

   `_advanceIfAtEndOfTrack` zeroes `currentTime` before advancing, since it still describes the finished track. On the last track there is nothing to advance to, so it rewinds to 0 instead of leaving the element ended, which Firefox answers by stopping.

5. **Dark Mode:** Quasar's `Dark` plugin. The three-way choice (follow system / light / dark) lives in `pages/Settings.vue` and is persisted in LocalStorage `theme_mode` by `src/utils/theme.js`; `src/boot/theme.js` re-applies it before mount. There is no drawer toggle.
6. **Progress Tracking:** Users can mark works as `listening`, `listened`, `replay`, or `postponed`.
7. **Work Card Variants:** One component, `WorkCard.vue`, renders both styles: the modern one (tags revealed on hover over the cover) and, with `oldStyle` set, the legacy one (tag chips below the body, text price/sold line, `mic` icon on VA chips). `Works.vue` binds the prop to `oldWorkCardUIStyle`, persisted under LocalStorage key `old_work_card_ui_style_key`. Both share the `workcard` i18n scope.
8. **Metadata Editing (admin only):** `WorkDetails.vue` shows an "edit metadata" button (i18n key) only when the current user is an admin (computed `isAdmin`: auth disabled, or `group === 'administrator'`, or `name === 'admin'`). It opens `EditMetadata.vue`, which PUTs to `/api/work/:id` with `{title, nsfw, release, circle, tags[], vas[], illustrators[], scriptWriters[], series}` — **tag names sent are the canonical Japanese names** (the backend canonicalizes them again via `resolveTagLabel`). Tag/VA/illustrator/script-writer/series inputs use Quasar `q-select` with `use-input` autocomplete, fetching options from `/api/tags`, `/api/vas`, `/api/illustrators`, `/api/script_writers`, `/api/series`. For tags, the option **label** is the translated name (`tTag`) but the bound **value** is the canonical Japanese name, so storage stays canonical. **`filterTags` matches the typed text against the canonical name only** (`o.name`), not against the displayed label — deliberately, to stay consistent with `/api/search`, which is parsed server-side and understands canonical Japanese alone. The same applies to `filteredItems` in `List.vue`. Do not "fix" either to match the translated name without changing the backend too. On save, the dialog emits `saved` and `WorkDetails.vue` re-reads the work metadata.
9. **Keyboard Shortcuts:** Space for play/pause, arrow keys for seeking, etc. (handled in AudioPlayer).
10. **Scan progress (`Dashboard/Scanner.vue`):** every `SCAN_*` event carries **one** entry and the page appends it — the old plural events re-sent the whole accumulated array on every line, which on a whole-library refresh meant re-rendering this page's un-virtualised log panel over the full results array once per work. **This was never a socket problem** (the largest message was ~526KB, 2.2ms to parse, ~382KB/s averaged over a long run — nowhere near a heartbeat timeout); it was waste, and it is what made per-line image logging too expensive to add. Three things follow, and none of them are optional:
    - **Append, never assign.** `SCAN_INIT_STATE` is the only handler that replaces state wholesale.
    - **The arrays are capped** (`MAX_MAIN_LOGS` 500, `MAX_TASK_LOGS` 200, `MAX_FAILED_TASKS` 200, `MAX_RESULTS` 500), mirroring the scanner child. The log panel is a plain `v-for`, not virtualised, so an unbounded tail is a growing DOM on top of a growing array. The complete record is in the scanner's log file, whose path is the run's first log line.
    - **`connect` re-emits `ON_SCANNER_PAGE`.** Socket.IO reconnects by itself after a drop; this is what makes the page catch up rather than stay frozen. The server answers with a fresh snapshot, or — for a run that ended while the socket was down — with the remembered `SCAN_FINISHED`.

    `onSCAN_FINISHED` pushes into `mainLogs`, **not** `allLogs`: `allLogs` is a computed, and pushing into it wrote to a cached array the next delta threw away, so the line announcing the scan had finished could vanish on the way in.

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
its baseline does not move). A speaker's name is drawn inline ahead of the
text, never on a row of its own. A multi-line SRT/WebVTT cue keeps its line
breaks (`parseSubtitleCues` joins the rows with `\n`, `.lyric-line` is
`white-space: pre-line`); LRC has one line per timestamp and cannot express one.
The bar colours a stream through `src/utils/lyrics.js`, which maps a stream index to
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

**Two lyric views, one timeline.** `LyricsBar` shows only the line being spoken; `LyricsFullScreen` scrolls the whole track, so `setLyricStreams` also publishes every cue through `SET_LYRIC_CUES` (`{name, cues:[{start, end, text, voice}]}`, ms on the lyric clock), cleared by `resetToNoLyricStatus`. The overlay flattens that into start-sorted rows — **several rows can be active at once**, because `cueTextAt` lets one cue outlive the next one starting. Clicking a row seeks to `start / 1000 - lyricOffsetSeconds`.

**The overlay is a mode, not a route.** Playback, queue and sockets survive it. Only opening the floating panel closes it (the inset is measured against the bar); the CC toggle just blanks it, and a track without lyrics is blank from the start. It pushes a `history` entry so Back closes it instead of leaving the page, and its rows use `.lyric-row` — **`.row` is Quasar's flex utility** and silently restyles anything that takes the name.

### 2.10 Internationalization (i18n)

Two separate translation layers, kept apart:

1. **Static UI strings** → `vue-i18n` v11 in **Composition API mode** (`legacy: false`, `globalInjection: false`). Components are still Options API objects, so each one declares `setup () { const { t } = useI18n(); return { t } }` (`vue-i18n`'s `useI18n()` with no options resolves to the **global scope**); templates call `t('scope.key')`, script calls `this.t(...)`. The instance is created in `src/i18n/index.js` and registered by `src/boot/i18n.js` (in the `boot` array, `quasar.config.js`). The legacy `$t`/`$te`/`$i18n` globals **do not exist** — `npm test` runs `scripts/check-i18n.mjs`, which fails on any of them (and on `legacy: true`). Non-Vue code (e.g. `boot/axios.js`) uses `i18n.global.t(...)`.
2. **Dynamic tag names** → `translateTag(name, locale)` in `src/i18n/tags/index.js`, exposed to components as the `useTagTranslate()` composable from `src/i18n/index.js`: `const { tTag, tagLang } = useTagTranslate()` in `setup()`, then `tTag(name)` / `tagLang` in templates (`this.tTag(...)` in script). It lives in `src/i18n/index.js`, not in `tags/index.js`, to avoid an import cycle. Tag names are DATA (canonical Japanese from the backend), so they live in hand-maintained JSON maps (`src/i18n/tags/{zh-CN,en-US,zh-TW}.json`), NOT in the vue-i18n catalog. `ja-JP` is the identity (no map). Unmapped tags fall back to the Japanese name.

**Locales:** `zh-CN` (base/`fallbackLocale`), `en-US`, `ja-JP`, `zh-TW` — all complete and in key parity (33 scopes each).

**Catalog layout:** per-scope partial files under `src/i18n/parts/<locale>/<scope>.js` (scope = `.vue` filename lowercased), auto-discovered by `require.context` in `src/i18n/index.js` — adding a partial file is enough; do NOT edit `index.js` per scope. Shared strings live under scope `common` (`parts/<locale>/common.js`). Conventions are documented in `src/i18n/CONVENTIONS.md` (read before editing).

**Locale resolution (per-user):** on boot, `getInitialLocale()` checks LocalStorage `app_language` → else matches `navigator.language` (exact, then prefix; `zh-TW`/`zh-HK` → `zh-CN`) → else `zh-CN`. The choice is persisted in LocalStorage `app_language`.

**Language switchers:** both live in `pages/Settings.vue` as `q-select`s. The UI one calls `changeLanguage(locale)` from `src/boot/i18n.js` (updates `vue-i18n`, the Quasar lang pack via `Quasar.lang.set`, `<html lang>`, and LocalStorage); the tag one calls `changeTagLanguage(locale)`. The dead server `tagLanguage` config and its radio group were **removed** (scrapers always fetch Japanese; tag language is now a display concern, resolved client-side).

**Tag language is independent of the UI language.** `tagLocalePref` (LocalStorage `tag_language`) holds either one of the four locales or the sentinel `FOLLOW_UI` (`'follow'`, the default), which resolves to the current UI locale. `getCurrentTagLocale()` does that resolution; `useTagTranslate()` is bound to it, **not** to `getCurrentLocale()`. Setting it to `ja-JP` gives untranslated (canonical) tag names under any UI language, which is the identity map and therefore always complete.

> **Both locales are `ref`s, and that is load-bearing.** `Cover.vue`, `WorkCard.vue`, `WorkListItem.vue`, `List.vue` and `FilterTerms.vue` render tag names without a single `t` call, so nothing would repaint on a tag-locale switch unless the render subscribed to the locale state. `tTag()` and `tagLang` from `useTagTranslate()` read `currentTagLocale`, a `computed` over the two refs (`currentLocale`, `tagLocalePref`), which is what makes a switch repaint already-mounted pages — including the `<keep-alive>`d `Works`/`Favourites`, since `pages/Settings.vue` now sits **inside** `MainLayout` and reaching it no longer unmounts anything. **Do not turn those two back into plain `let`s** (nor snapshot `tagLang` at setup): the chips would go stale until the next remount.

**Han unification / `lang` attributes.** Roboto and the rest of Quasar's default stack carry no CJK glyphs, so Han characters resolve through the browser's fallback — and the browser picks *which* CJK face from the nearest `lang` attribute, falling back to its own language setting when there isn't one. **Two owners, no overlap:** `<html lang>`/`dir` belong to Quasar — `Quasar.lang.set(pack)` writes the pack's `isoName` (`zh-CN`, `zh-TW`, `ja`, `en-US`), and `boot/i18n.js` awaits the initial pack load so that attribute is in place before the first paint; `htmlLang()` (`zh-Hans`/`zh-Hant`/`ja`/`en`) is used **only** for the per-element tag `lang`, never for the document. Because tags can be in a *different* language than the UI, every element rendering a tag name carries its own `:lang="tagLang"` — `Cover`, `WorkCard`, `WorkDetails`, `WorkListItem`, the tag `q-btn`s in `List.vue`, and the autocomplete in `EditMetadata.vue` (each pulls `tagLang` from `useTagTranslate()`). The already-attached chips in `EditMetadata.vue` are hardcoded `lang="ja"` since they always show the canonical Japanese name. **Add `:lang="tagLang"` to any new element that renders `tTag(...)`** — without it, Japanese kanji get drawn with Simplified-Chinese glyph shapes for a zh-configured browser.

**Quasar lang sync:** `src/boot/i18n.js` dynamically imports the matching `quasar/lang/*` pack (`zh-CN`, `en-US`, `ja`, `zh-TW`) and falls back to `en-US` on load failure; it also owns `<html lang>`/`dir` (see the Han unification note above), which is why the boot file is `async` and the initial pack load is awaited — Quasar mounts only after async boots settle, so no paint ever happens without a `lang`. `quasar.config.js` `framework.lang: 'en-US'` remains the build-time default and is overridden at boot.

**Tag identity vs display:** the backend stores canonical Japanese tag names (canonicalized via `backend/scraper/tag-aliases.json` — see `backend/AGENTS.md` §2.3). The frontend's tag-translation maps are keyed by that canonical name, so the frontend never deals with renames. Display sites use `tTag(tag.name)`; the editor (`EditMetadata.vue`) keeps canonical `tag.name` as the stored/bound value.

---

## 3. Critical Conventions & Gotchas

- **Session Management:** The session cookie is `HttpOnly`, so JS cannot read it and there is nothing to manage client-side. `MainLayout.initUser()` calls `GET /api/auth/me` on boot; a 401 redirects to `/login`. Logout is `POST /api/auth/logout`, which destroys the server-side session — clearing client state alone is no longer enough.
- **Keep-Alive:** `Works` and `Favourites` are wrapped in `<keep-alive :include="['Works', 'Favourites']">` in `MainLayout.vue`. Their `activated` hooks should be used for data refreshes when returning from other pages. A cached page stays mounted, so any `q-infinite-scroll` on it keeps listening to scroll events while it is off-screen — both pages therefore freeze their scroller in `deactivated` (`stopLoad = true`) and thaw it in `activated`.
- **Paginated list pages (`Works`, `Favourites`) own every in-flight request.** `q-infinite-scroll`'s first `@load` fires before the parent's `mounted()`, so anything restored in `mounted()` arrives *after* the first request has already gone out; the older response must be droppable or the list ends up contradicting the UI. `Works.vue` therefore bumps `_generation` in `reset()` and applies a response only if its generation still matches, joins concurrent callers onto one `_inFlight` promise, and reads `page`/`filter` once per request — **do not merge a response read from live `pagination`/`filter`.** For the same reason the persisted list settings (`sortCategoryOption`, `nsfwOption`, `sortInDesc`, `listMode`, `showLabel`, `detailMode`) are read in `data()` rather than restored in `mounted()`: a restore through the watchers issues a page‑1 request with the defaults, and whichever of the two page‑1 responses lands last wins (that is how a refresh could show adult works with "All ages" selected). `Favourites.vue` still has the old merge and is exposed to the same class.
- **SPA History Fallback:** The backend uses `connect-history-api-fallback` so Vue Router handles all non-`/api` routes. No hash routing needed.
- **Dev Server Proxy:** In development (`quasar dev`), `quasar.config.js` proxies `/api` and `/socket.io` to `localhost:8888` (the backend).
- **Service Worker:** PWA mode uses Workbox in **InjectManifest** mode — the worker is hand-written at `src-pwa/custom-service-worker.js`, not generated. `quasar.config.js` now carries only *build-time* PWA options (`extendInjectManifestOptions` → the precache `exclude` list, and `extendPWACustomSWConf` → the esbuild target); all *runtime* behaviour (`skipWaiting`/`clientsClaim`, navigation fallback, caching routes) lives in the worker file. The switch from GenerateSW was required because a generated worker can only express routes, and the offline-download feature needs SW event handlers (Background Fetch).
  - The worker excludes `/api/*` and `/media/*` from navigation fallback, and registers three routes (all into a single `offline-tracks` Cache Storage bucket): `CacheFirst` + `RangeRequestsPlugin` on `/api/media/offline/*` (tracks/lyrics), `CacheFirst` on `/api/cover/*` (work covers), and `NetworkFirst` on `/api/work/:id`, `/api/tracks/:id`, `/api/review` (work-detail page JSON — live data when online, cached snapshot as offline fallback). The first two are populated only by the explicit download action (`src/utils/downloads.js`), never by ordinary streaming; the third also auto-populates on any successful browse, since JSON metadata is small and bounding it risks evicting a downloaded work's snapshot.
  - **Match routes on the pathname, never on an `^/api/...`-anchored RegExp — and strip the deploy prefix first.** The matchers call `appPath(url)` (`stripBasePath(url.pathname)`), because under a sub-path install every pathname arrives as `/prefix/api/...`; on a root-served install it is the identity. Workbox's `RegExpRoute` execs the pattern against the *absolute* URL (`url.href`, e.g. `https://host/api/...`), so a leading `^\/api\/` can never match. The original `runtimeCaching` config made exactly this mistake and all three routes were silently dead — downloads were written to Cache Storage by the page but never served back from it, so offline playback did not work. (`NavigationRoute`'s denylist is unaffected: it matches on `url.pathname + url.search`, which is why navigation exclusion always worked. **Keep those denylist patterns unanchored** — under a deploy path prefix the pathname is `/kikoeru/api/...`, and an anchored `^\/api\/` would miss it, silently handing API requests the SPA shell while offline.)
- **LocalStorage Keys (reserved):**
  | Key | Type | Purpose |
  |-----|------|---------|
  | `swap_seek_button` | boolean | Swap seek/next buttons |
  | `flip_lr_channel` | boolean | Swap left/right audio channels |
  | `auto_mark_listened` | boolean | Auto-mark a work as listened on last track end (default `true`) |
  | `rewind_seek_time` | number | Rewind step in seconds (default 5) |
  | `forward_seek_time` | number | Forward step in seconds (default 30) |
  | `ai_server_url` | string | AI server URL (unused?) |
  | `old_work_card_ui_style_key` | boolean | Legacy card UI toggle |
  | `theme_mode` | string | Theme preference — `auto` (default, follows the OS), `light` or `dark`. Applied by `src/boot/theme.js` via `src/utils/theme.js` |
  | `app_language` | string | UI locale (`zh-CN`/`en-US`/`ja-JP`/`zh-TW`); set by the Settings language switcher, auto-detected from browser on first load |
  | `tag_language` | string | Tag display locale — one of the four locales, or `follow` (default) to track `app_language`. See §2.10 |
  | `downloaded_files` | array | Offline-download manifest (`module-Downloads/state.js`): `{url, workId, trackId, type, title, workTitle, bytes, downloadedAt}[]`, plus `contentHash`/`duration` on audio rows. Metadata only — actual bytes live in the service worker's Cache Storage, not here. Those two extra fields are what lets `Downloads.playWork` build a queue that can report progress and show a track length with no tree to read from; manifests written before they were recorded simply lack them. |
  | `downloads_list_mode` | boolean | Downloads page grid/list toggle (separate from the Works page's `listMode`) |
  | `downloads_sort_by` | string | Downloads page sort (`downloadedAt`/`title`/`size`) |

---

### 3b Local-first playback position (`src/utils/positions.js`)

Position used to live **only** on the server, which made unload-time delivery load-bearing — and nothing available is reliable everywhere (`keepalive` survives the document dying but not the OS suspending the process; Background Sync is Chromium-only). Writing locally removes the dependency instead of trying to strengthen it.

| | writes | why |
|---|---|---|
| **local** (`positions` store) | every 10s tick **and** every state change | durable the instant it is observed; survives reload, offline, and a hard kill |
| **server** (`PUT /api/track-progress`) | state changes, page hide, and at most once per `SERVER_PUSH_MS` (60s) per track | only needs to be fresh enough for *another device* to read |

The 10s interval in `AudioPlayer.mounted` did not change cadence — it now drives the local write and merely trips the server throttle. Server traffic during continuous listening drops from ~360 writes/hour to ~60.

> **Only the interval may be throttled, and that is why it has its own entry point** (`_tickTrackProgress`) instead of calling `onUpdatePlayingStatus` like it used to. Every *state change* goes through `onUpdatePlayingStatus` and forces a push, because the resume paths — `RecentWorks.resumeThisHistory`, `FavListItem`, `Work.resumeMetadataPlayHistory` — read `state.seconds`, which the **server** resolves from `t_track_progress` (`applyTrackProgressSeconds`). Share the funnel and a throttled pause never reaches `t_track_progress`, so those paths resume at 0 while the file tree (which reads the merged `trackProgress`) shows the right value. That asymmetry is the symptom to recognise.

- **Store `positions` in the shared `kikoenai` DB** (v2; `utils/idb.js` owns `openDb`/`run` for both stores, because a second connection on a different version would block the first). `keyPath: 'trackId'`, plus a `workId` index so one work's rows are a single `getAll` rather than a scan of every track ever played.
- **`savePosition()` skips a write when a stored row is newer.** These fire from async handlers and can land out of order.
- **`positionsForWork()` returns the same shape as the server's `trackProgress` map**, deliberately, so `mergePositions` needs no adapter on either side.
- **`resolvePosition(local, server)` is the single rule**, and `mergePositions` applies it across a work. Every consumer goes through one of the two: the file tree badge (`WorkTree.savedPosition`), the info panel (`WorkDetails.historySeconds`), the Favourites badge, and all three resume entry points (`Work.resumeMetadataPlayHistory`, `RecentWorks.resumeThisHistory`, `FavListItem.playHistory`) via `resumeSecondsFor(workId, state)`. They used to read different things — the tree took the merged map while the panel and the list views read `state.seconds` from the server's history join — so a throttled push made them contradict each other, and **the same resume landed in a different place depending on which page you started from**.
- **`mergePositions(server, local)` takes the newer `observedAt` per track** — the same rule the server applies on write (`backend/AGENTS.md` §2.9c), so the two cannot disagree about precedence. It also reports which trackIds the local copy won, and `Work.vue:pushLocallyNewerPositions` sends those. That closes the gap the throttle opens: a position observed between pushes and then lost to a hard kill would otherwise never leave the device.

> **The two sides store `observedAt` differently, and getting it wrong fails silently.** The server returns `'YYYY-MM-DD HH:MM:SS'` — space-separated, UTC, **no timezone marker** — while local rows hold epoch ms. `Date.parse` treats an unmarked string as *local* time, so parsing the server's value directly would shift it by the machine's offset and make local win every comparison. `toEpoch()` normalises with `replace(' ', 'T') + 'Z'`; route every comparison through it.

- **`navigator.storage.persist()` is requested at boot** (`MainLayout.requestPersistentStorage`). Without it the origin's storage is *best-effort* and the browser may evict it under disk pressure, not only when the user clears data — which would silently lose positions. Advisory only; nothing depends on the grant.
- **Growth is unbounded by design**: one row per track ever played, ~120 B each, so ~4 MB for a 30k-track library. Not worth pruning code.
- **`_markTrackProgressReported` gates both reporters**, and a forced push with an unchanged position is correctly a no-op. It is one of the three race fixes in `7c33e02`, but it was a **single slot** (`trackId/seconds`) and had to become a per-track `Map`: a queue cycles through trackIds, so `A/100 → B/0 → A/100` slipped through and re-wrote A with a fresh `observedAt` over an unchanged position — harmless when the server overwrote unconditionally, a cross-device clobber now that it orders by `observedAt`.
- **The report bookkeeping is non-reactive**, declared in `created()` next to the debounce rather than in `data()` — written on every report, never rendered, same reasoning as `_lrcLoadId` in `AudioElement`.


## 4. Scripts

```bash
npm install        # Install dependencies

npm run dev        # quasar dev -m pwa (proxies /api + /socket.io to localhost:8888)

npm run build      # quasar build -m pwa --debug  (NOTE: debug build)
npm run build:prod # quasar build -m pwa          (use this for releases)

npm test           # check:i18n + check:theme + check:contrast + ESLint, in that order
npm run check:i18n # i18n guard only (see §2.10)
npm run check:theme # colour-name guard only (see below)
npm run check:contrast # WCAG contrast guard only (see below)
npm run theme      # Regenerate quasar.variables.scss / material-theme.scss / theme-utilities.scss from material-theme.json
```

Both build targets are **PWA**, not SPA, and output to `../backend/dist` (`distDir` in
`quasar.config.js`) so the backend serves them as static content.

**`npm run theme` does not run unmodified on current Node; use `npx --yes tsx
scripts/generate-theme.mjs` instead.** `@material/material-color-utilities@0.4.0` (still the
latest) ships ESM with extensionless relative specifiers (`from
'../dynamiccolor/dynamic_scheme'`), which Node's resolver rejects and
`--experimental-specifier-resolution=node` no longer covers. `tsx` resolves them the way a
bundler does. This is why the script is run rarely and by hand; do not patch `node_modules`
expecting it to survive the next install, and do not wire a workaround into the npm script.

**A colour prop takes a colour NAME, because Quasar builds the class itself. Never pass the
class.** `color="primary"` becomes `bg-primary` and `toggle-text-color="on-primary"` becomes
`text-on-primary`, so `toggle-text-color="text-on-primary"` produces `text-text-on-primary`
and `color="on-info-container"` on a `q-btn` produces a `bg-on-info-container` that the theme
does not emit (only `.text-*` exists for `on-*` roles). Either way the element renders
completely unstyled and **nothing is logged** — Vue sees a plain string and the browser sees
an unmatched class. `scripts/check-theme-classes.mjs` (`npm run check:theme`, part of
`npm test`) is the only warning you get: it resolves every colour prop in `src/**/*.vue`
against the CSS that actually ships — Quasar's palette (`colors.sass`/`dist/quasar.css`),
the generated `src/css/theme-utilities.scss`, and hand-written classes in `src/css/*.scss`
(which is why `color="rating-star"` passes) — reads string literals out of bound values
(`:color="x ? 'on-primary' : 'negative'"`), and suggests the nearest name on a typo. Its
prop→`bg-`/`text-` table is per component, because `color` means a text colour on `q-icon`,
`q-spinner*`, `q-rating` and the progress/knob widgets but a background on `q-btn`,
`q-badge`, `q-chip` and `q-avatar`; a prop it does not list is not checked, so adding a new
one means adding it there.

**Material 3 has ONE `on-surface` role, not one per surface.** There is a `bg-` utility per
surface but text on any of them is `on-surface` (`on-surface-variant` when it should read
quieter) — so the pair is `color="surface-container-low" text-color="on-surface"`, which is
what the `q-btn-toggle` segments, chips and gallery tiles all use. `on-surface-container-low`
et al. are **not** Material roles and have no class or variable behind them: that name renders
in the inherited colour and logs nothing. Do not add per-surface on-colours to
`generate-theme.mjs` to make it resolve; the single role is the standard.

**A background colour does not imply a readable foreground, so `npm run check:contrast`
measures every pair.** `use-btn.js` falls back to `text-${textColor || 'white'}`, so a solid
`q-btn color="primary-container"` with no `text-color` renders white on pale lavender —
**1.29:1 in light mode while dark mode measures 9.4:1 and looks fine**. That asymmetry is why
an omitted pair survives review: it only breaks in the tier you are not looking at. The
script resolves the pair each element actually renders (including Quasar's per-component
defaults: white for `q-btn`/`q-badge`, `rgba(0,0,0,.87)` for `q-chip`, inherited
`on-surface` for `q-avatar`), measures it in all six tiers (`light`, `dark`,
`light/dark-medium`, `light/dark-high`), and fails below WCAG AA — 4.5:1 for text, 3:1 for
icons and other non-text UI. Values are read from `material-theme.scss`, so it measures the
real palette; `--q-<brand>` overrides are applied last, which is what makes `primary`
resolve to the *dark* tone in dark mode. A foreground-only element is measured against the
nearest ancestor that paints a background (`class="bg-*"`, `header-class`, or a `color` on a
background component), and a background that only applies while active (`active-class`) is
reported as a warning rather than a failure. Limits: static attribute values only (a bound
`:color` is skipped, since either branch could render), and no alpha compositing beyond the
chip default.

> **The dark scheme's brand tones are light, and Quasar fills with them.** `--q-primary` is
> `#B4C5FF` in dark mode, so a solid `q-btn color="primary"` with Quasar's default white text
> measures **1.70:1** — the M3 pairing is `primary` background with `on-primary` text. This is
> why the guard reports ~19 sites: the fix is `text-color="on-primary"` (or `on-secondary`,
> `on-tertiary` for `accent`, `on-error` for `negative` — `accent`/`negative` are M3
> `tertiary`/`error`, so there is no `on-accent`/`on-negative` token). Do not "fix" it by
> darkening the dark-scheme brand tones: `text-primary` on a dark surface depends on them
> being light.

**Chrome colours are derived, not declared.** `quasar.config.js` reads
`src/material-theme.json` and passes `themeColor` (light primary) / `themeColorDark` (dark
surface) to `index.html` through `htmlVariables`, which renders the two
`<meta name="theme-color">` tags; the same file's `extendManifestJson` sets the manifest's
`theme_color` / `background_color`. Do not hardcode either in `src-pwa/manifest.json` or in
the HTML template.

**The HTML template is `index.html` at the app root, not `src/index.template.html`.**
Quasar 2 reads `sourceFiles.indexHtmlTemplate`, which defaults to `index.html`. The
`src/index.template.html` path is the pre-v2 location: a file left there is silently
ignored, so edits to it never reach a build. The template's variables are
`quasar.config.js > htmlVariables` (`productName`, `productDescription`, `themeColor`, …),
*not* `htmlWebpackPlugin.options`.

**Brand variables must take the tone of the variant they are emitted for.**
`vars(scheme, brandVariant)` writes `--q-positive`/`--q-info`/`--q-warning` from
`extended[<colour>][brandVariant]`, so a block's brand colour and its `--on-*` tokens come
from the same tonal variant. Emitting the dark tone for a light contrast tier paired white
`--on-warning` with a light amber `--q-warning` and measured **1.7:1** in
`body.contrast-medium` / `body.contrast-high` — the two accessibility modes. The semantic
colours are the part of the theme that is *not* Theme Builder output: they come from the
hand-authored `TONES` table, so they are the part that can regress.

---

## 4b. Track Titles

`WorkTree.vue` renders a track as `item.trackTitle || item.title`. `title` is always the real filename; `trackTitle` is an optional scraped/extracted display name present only on audio nodes whose work has `memo.trackTitles` populated. When both exist the filename is shown as a caption underneath.

Never swap the two: `title` is what the backend builds media URLs from (see `backend/AGENTS.md` §2.9b).

**The player shows it too, via one getter.** `toQueueItem` carries `trackTitle` onto the queue item — but **only when the work has one**, matching how `mediaStreamUrl` is handled, since every field on a queue item is re-uploaded on each `PUT /api/history`. `AudioPlayer/currentPlayingTitle` resolves `trackTitle || title` once, and `PlayerBar`, `AudioPlayer` and the `mediaSession` metadata in `AudioElement` all read it rather than `currentPlayingFile.title`. This is the only way the player can know the display name: the resume paths hand a **stored** queue to `SET_QUEUE` and never refetch the tree.

The **history surfaces** resolve it the same way: `FavListItem.parkedTrackTitle`, `RecentWorks.getWorkHistoryInfo`, `WorkDetails.currentHistoryTrack`. They read the *stored* queue, so a row written before titles existed keeps showing the filename until that queue is rebuilt from the tree — i.e. the next time the work is played from its own page.

Downloaded playback needs the same field carried through three more places, since it never re-reads the tree: `collectDownloadableFiles` (which projects a fixed set of node fields and was dropping it), the manifest rows `buildWorkDownloadPlan` writes, and the queue `Downloads.playWork` builds. Manifests written before this simply lack it and fall back to the filename.

**Editing them (admin only):** reached from the "edit track titles" button inside `EditMetadata.vue`, so the work page grows no permanent control. `EditTrackTitles.vue` **fetches its own tree** from `GET /api/tracks/:id` (the metadata dialog has none to hand it) and lists every audio node as one input, grouped by folder **shallowest-first** — the root and top-level folders are what a track list usually describes. Save PUTs **only the changed rows** to `/api/work/:id/file-metadata` as `{files: {<relPath>: {trackTitle}}}`; an emptied field stores `NULL`. Track titles are not part of the metadata payload and save independently, so `saved` re-emits up to `WorkDetails` → `Work.vue` `requestData()`.

**Placement is a user action, not a guess.** "Fill from a track list" applies a pasted list **positionally** — line 1 onto the folder's first track — with blank lines dropped, since a gap would shift everything after it. Folders are multi-select defaulting to all, because the usual multi-folder work is a set of *variants* (`NO_SE/`, a wav copy) holding the same tracks in the same order; a bonus folder just gets unselected. Filling only edits the inputs, so the dialog works with no LLM at all: the list can be pasted off the Description tab.

**"Extract from description"** fills that textarea over **Socket.IO** — it emits `SUGGEST_TRACK_TITLES {workId}` and waits for `SUGGEST_TRACK_TITLES_RESULT`/`_ERROR`. Not a request, because a local model would outrun any proxy timeout. The button only renders when `GET /api/config/shared` reports `llmConfigured` (a boolean; the LLM settings are env-only server-side). An empty result warns; a **short** list and any **unverified** titles each get their own inline caption, since the backend deliberately keeps titles it could not find in the description rather than leaving gaps.

> **The socket connects lazily, on first suggest** — not on mount, and not in `MainLayout`: the handshake rejects any account but `admin` when auth is on, so connecting app-wide would error for every ordinary user. Nothing disconnects afterwards, matching `DashboardLayout`.
>
> **Both replies echo `workId`** and the handlers drop anything that is not this work's, since one socket carries every dialog's traffic. Listeners are added in `mounted`, removed in `beforeUnmount`; a `disconnect` mid-flight clears the spinner.

### Transcribing a work's audio

A button in `EditMetadata.vue`, rendered only when `GET /api/config/shared`
reports `asrConfigured` (a boolean; the ASR settings are env-only server-side,
like `llmConfigured`).

`TranscribeTracks.vue` fetches its own tree from `GET /api/tracks/:id` and
lists every audio node as a selectable row — checkbox plus status icon, with a
tri-state select-all and an optional query-string field above — then drives the
run over **Socket.IO**: `TRANSCRIBE_WORK {workId, relPaths, query}` to start,
`TRANSCRIBE_CANCEL` to stop, with `TRANSCRIBE_PROGRESS` arriving per track and
matched to a row by `relPath`. Not a request — a work runs minutes to hours.
The socket connects lazily on first use, as in `EditTrackTitles.vue`, and every
reply echoes `workId`.

Everything is selected on load; the server skips tracks that already have a
subtitle unless the Options expander's overwrite box is ticked — the only way
to replace an overlay file, which lives under the server's data root out of the
user's reach. Rows are disabled while a run is going, and a `disconnect`
clears the spinner — the server aborts on disconnect too.

The query field is sent raw and escaped server-side (`backend/AGENTS.md`
§2.9d), so hotwords can be typed in Japanese directly. Blank means the server's
configured value, which is never sent to the browser.

> **`TRANSCRIBE_RESULT` carries an `overlay` count**, the number of subtitles
> that went to the server's `lyrics/` folder because the library folder would
> not take them. The dialog surfaces it: the point of writing beside the audio
> is that the file is findable for a typo fix.

## 5. API Contract (Consumed from Backend)

| Endpoint | Method | Used In | Purpose |
|----------|--------|---------|---------|
| `/api/auth/me` | GET | `MainLayout.vue` | Get current user + auth status |
| `/api/auth/me` | POST | `Login.vue` | Log in; server sets the session cookie. **Login POSTs to `/api/auth/me`** — there is no `/api/auth/login` |
| `/api/auth/logout` | POST | `MainLayout.vue` | Destroy the server-side session and clear the cookie |
| `/api/works` | GET | `Works.vue` | List/search works (paginated, sorted, filtered) |
| `/api/work/:id` | GET | `Work.vue`, `Downloads.vue` | Get work metadata + playback state. `state.secondsObservedAt` accompanies `state.seconds` so the client can tell whether its own local row is newer (see §3b). `Downloads.vue` fetches one per downloaded work to render real `WorkCard`s; served from the SW cache when offline |
| `/api/work/:id/extras` | GET | `Work.vue` | `{description, descriptionHtml, descriptionParts, sampleImages}` — feeds the Description tab and the cover gallery. `descriptionHtml` is the seller's own markup, **sanitized by the backend per request**, and is what `WorkDescription.vue` renders with `v-html`; `description`/`descriptionParts[].text` are the plain-text path for rows scraped before the markup was kept (the backend decides which of the two is populated, so the component just checks `html`). A rescan or refresh upgrades a row from one to the other. Failure is non-fatal: the page is still the file tree it always was |
| `/api/image/:id/:name` | GET | `WorkGallery.vue`, `WorkDescription.vue` (via `workImageUrl()` in `src/utils.js`) | One scraped image. **Local copies only:** `workImageUrl` returns `''` for an entry with no `file` (nothing was downloaded — backend `config.skipWorkExtras` defaults to `true`) and callers drop the empty ones, so an undownloaded image is left out rather than hotlinked from img.dlsite.jp. Run `updater.js --images`, or turn `skipWorkExtras` off, to get them |
| `/api/tags` | GET | `List.vue` | List all tags |
| `/api/circles` | GET | `List.vue` | List all circles |
| `/api/vas` | GET | `List.vue` | List all VAs |
| `/api/media/stream/:trackId` | GET | `AudioElement.vue`, `WorkTree.vue` | Stream a track (supports Range). Feeds `<audio src>` directly; the session cookie authenticates it, so the URL carries no credential |
| `/api/media/download/:trackId` | GET | `WorkTree.vue` | Download a file |
| `/api/media/offline/:trackId` | GET | `AudioElement.vue`, `WorkTree.vue`, `WorkDetails.vue`, `src/utils/downloads.js` | Best offline-friendly copy of a track (transcoded Opus for lossless sources, as-is otherwise). Populates the `offline-tracks` Cache Storage bucket via the explicit download action; `AudioElement.vue`'s `source` computed prefers this URL once a track is downloaded, online or offline (see `module-Downloads`). |
| `/api/media/check-lrc/:trackId` | GET | `AudioElement.vue` | Lyric sidecar files for a track; returns `{result, message, lyrics: [{trackId, lyricExtension}]}`, one entry per speaker (see §2.9). The flat pre-multi-speaker `trackId`/`lyricExtension` fields were removed at the 1.0 freeze, along with the fallback that read them. |
| `/api/cover/:id` | GET | `Cover.vue`, `AudioElement.vue`, `WorkListItem.vue`, `Downloads.vue` | Get cover image (`?type=main\|240x240\|sam`). Each variant is its own cache key — see the cover-cache-keys note in §3 |
| `/api/tracks/:id` | GET | `Work.vue` | Track tree for a work |
| `/api/review` | GET | `Favourites.vue` | List works the user has reviewed/rated/progress-marked |
| `/api/review/:id` | PUT/DELETE | `WorkDetails.vue`, `WorkCard.vue`, `FavListItem.vue`, `WriteReview.vue`, `AudioElement.vue` | Create/update or delete one work's review. PUT with `progressOnly=true` and `autoMark=true` only writes `progress='listened'` if existing is not terminal (listened/replay/postponed) |
| `/api/review/:id/progress` | DELETE | `WorkDetails.vue` | Clear only `progress` (NULL), preserving rating/review_text. If the row has no rating/review_text, the whole row is deleted |
| `/api/history` | GET | `Favourites.vue`, `RecentWorks.vue` | List works with playback history. Optional `excludeFinished` (`all`|`listened`, default `listened`). Response items include nullable `progress`. |
| `/api/history/:id` | PUT/DELETE | `AudioPlayer.vue`, `WorkDetails.vue` | Save or delete one work's playback state. Body `{state}` — the queue plus index, no position |
| `/api/search` | GET | `Works.vue` | **The only filter mechanism.** `filter` is an E-Hentai style filter (`va:"name$"`, `circle:under_score`, `-tag:NTR`, ANDed); parsed server-side, see `backend/AGENTS.md` §2.3b. Every label link builds one via `labelRoute()` in `src/utils.js`; the per-entity `/:id/works` endpoints are gone |
| `/api/version` | GET | `MainLayout.vue` | Version + update info |
| `/api/config/admin` | GET/PUT | `Folders.vue`, `Advanced.vue` | Admin config read/write |
| `/api/credentials/users` | GET/POST/PUT/DELETE | `UserManage.vue` | List / create / update / delete users (admin). Was `/user` for the three write verbs |
| `/api/refresh/:id` | POST | `WorkDetails.vue` | Re-fetch metadata for one work |
| `/api/scan/:id` | POST | `WorkDetails.vue` | Re-walk one work and rewrite its file listing. Returns `{files}`, the re-listed track count — `WorkDetails.scanWorkFile` reloads the page when it is a number. Was `{memo}`, which no longer exists |
| `/api/tracks/:id` | GET | `EditTrackTitles.vue`, `TranscribeTracks.vue` | Also read here, to list a work's audio files for the title editor and the transcription dialog (`trackProgress` ignored) |
| `/api/work/:id/file-metadata` | PUT | `EditTrackTitles.vue` | Set editable fields on a work's `t_work_file` rows (admin only). Body `{files: {<relPath>: {trackTitle}}}` — only the rows being changed; an empty title clears back to the filename. Returns `{message, updated}`, the row count actually written |
| `/api/work/:id` | PUT | `EditMetadata.vue` | Manually edit work metadata (admin only). Work id is a string: DLsite doujin RJ-padded (`\d{6,8}`), DLsite books (`BJ\d{6,8}`, prefix kept) or Fanza (`d\d+`, underscore-free). `src/utils.js` mirrors backend `work-id.js`: `isFanzaId`/`isBooksId`/`fanzaCid`, plus `workno` (the code as its store spells it — use it for any `RJ`/`BJ` prefix in a template) and `dlsiteWorkUrl` (books works link to the `/books/` floor, doujin to `/home/`). |
| `/api/illustrators` | GET | `EditMetadata.vue` | List illustrators (autocomplete) |
| `/api/script_writers` | GET | `EditMetadata.vue` | List script writers (autocomplete) |
| `/api/series` | GET | `EditMetadata.vue` | List series (autocomplete). Was the irregular `/api/seriess` |
| `/api/track-progress/:trackId` | PUT | `AudioElement.vue`, `AudioPlayer.vue`, `Work.vue` | Report per-track playback position. Body `{seconds, completed, observedAt}` — `observedAt` is `Date.now()` at measurement time; the server applies the write only if it is at least as new as what it holds (`backend/AGENTS.md` §2.9c), so a deferred write cannot clobber a newer position — the track is addressed by the same handle as a media URL, so callers post to `/api/track-progress/${encodeTrackId(file.trackId)}`. Fire-and-forget write, and **throttled**: at most once per 60s per track during continuous playback, immediate on state change and page hide (see §3b) |

> **Tracks response:** `GET /api/tracks/:id` returns `{ tree, trackProgress }`.
> **`trackId` is the only handle you need.** It is `${workId}/${relPath}`, so it
> identifies the file, builds every media URL, and keys `trackProgress` — which
> arrives as a `{trackId: {seconds, completed}}` map, so a badge is a direct
> lookup with no second field. Every node carries `relPath` too (text, image and
> pdf included), but the queue does not need it: `toQueueItem` stores `trackId`
> alone, and `trackId.split('/')[0]` recovers the work id for cover URLs.
>
> **History note.** `contentHash` is gone — the whole CRC32 scheme was removed
> (see `backend/AGENTS.md` §2.9a). Two superseded designs are worth not
> repeating: a second request for hashes (`GET /api/work/:id/memo`) let a queue
> be persisted before they arrived, permanently silencing progress for that row
> since the resume paths (`RecentWorks.vue`, `FavListItem.vue`) never refetch the
> tree; and hashing inline here instead made the first open of a work read every
> audio byte. Both came from using content as identity.

> **Note:** Library scanning is **not** a REST endpoint. `Scanner.vue` triggers scans over Socket.IO (`PERFORM_SCAN` / `PERFORM_UPDATE` / `PERFORM_WORK_FILE_SCAN` / `KILL_SCAN_PROCESS`) and listens for the `SCAN_*` events.

---

## 6. Monorepo Integration

Build output goes directly into `backend/dist/` (configured via `distDir` in `quasar.config.js`).

- **Workspace scripts:** `npm run dev:frontend` / `npm run build:frontend` from root.
- **Dev proxy:** `quasar dev` proxies `/api` and `/socket.io` to `localhost:8888`.
- **Socket.IO client:** Exposed globally as `$socket` (`src/boot/socket.io.js`), connects after auth. Drives library scanning in `Scanner.vue` — see §2.6 and `backend/AGENTS.md` §7 for the event list.

---

## 7. Common Development Tasks

### Adding a new page
1. Create a Vue component in `src/pages/` (or `src/pages/Dashboard/`).
2. Add a route entry in `router/routes.js`.
3. Add a navigation link in `MainLayout.vue`'s `links` array if needed.
4. **i18n:** create `src/i18n/parts/{zh-CN,en-US,ja-JP}/<scope>.js` (scope = filename lowercased) with the page's keys, add `setup () { const { t } = useI18n(); return { t } }`, and use `t('scope.key')` for all user-visible strings. See `src/i18n/CONVENTIONS.md`.

### Adding a new component
1. Create a Vue component in `src/components/`.
2. Import and register it in the parent component.
3. **i18n:** same as adding a page — create the three per-scope partials and use `t` (from `useI18n()` in `setup()`) / `tTag` (from `useTagTranslate()`, plus `tagLang` on any element rendering a tag name). Do NOT edit `src/i18n/index.js` (partials are auto-discovered).

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

## 8. Testing

- **Linting:** ESLint with Vue plugin
- **Guards:** `npm test` runs `scripts/check-i18n.mjs` (§2.10), `scripts/check-theme-classes.mjs` and `scripts/check-theme-contrast.mjs` (§4) *before* ESLint. All three exist because their failure mode is silent: a legacy `$t` renders nothing, an unknown colour name renders unstyled, and a low-contrast pair renders unreadable — none of them is an error anywhere else. The two theme guards share `scripts/lib/theme-scan.mjs` for tag/attribute scanning.
- **Run:** `npm test` from `frontend/`, or `npm run lint` from the repo root (there is no root `npm test`). The root script lints the backend first and **currently fails** on a pre-existing `backend/app.js` hashbang error, so run the frontend lint directly when checking frontend changes.

---

## 9. Development Tips

- **Auth in dev:** If auth is enabled, log in via `/login` first. The session cookie survives hot reloads. Note `config.auth` defaults to `false` outside `NODE_ENV=production`, so auth is usually off in dev.
- **PWA testing:** `src-pwa/register-service-worker.js` unregisters any worker under `process.env.DEV`, so dev has none. That is not Quasar's doing — `quasar dev -m pwa` emits a real Workbox worker (`skipWaiting` + `clientsClaim`, precaching `index.html`, `app.js`, `vendor.js` and the `*.hot-update.*` files). **The reason is HMR:** Hot Module Replacement has to fetch those hot-update files fresh, and a cache in front of them means the patch does not apply, so webpack either full-reloads or quietly runs stale code.
  - **Not the old infinite-reload loop**, which had a different cause: an `updated()` `Notify` whose `onDismiss` called `location.reload()`, and `onDismiss` fires on the dismiss *timeout* too — so every recompile scheduled a reload ten seconds out. Deleting that `Notify` fixed it (`17e3e6b`); unregistering never addressed it. Do not remove the dev block on the grounds that the loop is gone.
  - **What dev can and cannot test now.** Whole-work downloads *do* work, because `canBackgroundFetch()` is false without a worker and the foreground path needs only Cache Storage. Offline *playback* does not — `AudioElement` requests `/api/media/offline/...` over the network and nothing is there to answer from cache. Background Fetch, Background Sync and offline navigation all need a production build.
  - **Testing footgun:** DevTools → Application → Service Workers → **Bypass for network** makes a correctly registered worker look entirely absent — `navigator.serviceWorker.controller` reads `null` and every offline behaviour fails. Combined with the Offline checkbox it is indistinguishable from broken offline support. Also note Firefox's offline throttle serves from the HTTP cache, so a reload can succeed there with no worker involved at all; Chromium's is the stricter test, and pulling wifi is stricter still.
- **Dark mode:** Quasar's `Dark` plugin starts on `dark: 'auto'` (OS preference). The switcher is the Theme `q-select` in `pages/Settings.vue`, stored under LocalStorage `theme_mode` and re-applied by `src/boot/theme.js` before mount — `Dark.set()` takes `true`/`false`/`'auto'`, so pass the resolved mode, never a raw string it would read as truthy.
- **Component debugging:** Install Vue DevTools for inspecting Vuex state and component hierarchy.
