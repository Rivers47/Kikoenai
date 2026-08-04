# Kikoenai Frontend — AGENTS Guide

**Kikoenai** is a self-hosted web media player for [DLsite](https://www.dlsite.com) voice works (doujin audio). This is the Quasar-based frontend SPA/PWA; the Express API server lives in sibling package `backend/`.

- **Language:** Vue 3 (Options API style)
- **Framework:** Quasar 2 (Material Design)
- **State:** Vuex 4
- **Router:** Vue Router 4 (history mode)
- **Audio:** Plyr (`vue-plyr` wrapper)
- **Real-time:** Socket.IO Client
- **License:** GPL-3.0-only

---

## 1. Project Structure

```
├── src/
│   ├── App.vue                           # Root component
│   ├── index.template.html               # HTML template
│   ├── utils.js                          # Shared utility functions
│   ├── css/
│   │   ├── app.scss                      # Global styles
│   │   └── quasar.variables.scss         # Quasar SCSS variables
│   ├── boot/                             # App boot files (run before mount)
│   │   ├── axios.js                      # Axios instance + JWT header setup
│   │   ├── plyr.js                       # Plyr audio player boot
│   │   ├── slider.js                     # Vue slider component boot
│   │   ├── socket.io.js                  # Socket.IO client setup
│   │   └── store.js                      # Vuex store initialization
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
│   │   ├── Error404.vue                  # 404 page
│   │   └── Dashboard/
│   │       ├── Folders.vue               # Library folder management
│   │       ├── Scanner.vue               # Scan controls + progress
│   │       ├── Advanced.vue              # Advanced settings
│   │       └── UserManage.vue            # User management (admin)
│   ├── components/
│   │   ├── AudioPlayer.vue               # Main audio player (floating panel)
│   │   ├── AudioEqualizer.vue            # Audio visualizer
│   │   ├── PlayerBar.vue                 # Mini player bar (bottom of screen)
│   │   ├── LyricsBar.vue                 # Lyrics display below player
│   │   ├── PIPLyrics.vue                 # Picture-in-picture lyrics overlay
│   │   ├── WorkCard.vue                  # Work card (grid mode)
│   │   ├── OldWorkCard.vue               # Legacy work card style
│   │   ├── WorkListItem.vue              # Work list item (list mode)
│   │   ├── WorkDetails.vue               # Work detail panel (metadata, review, rating; opens EditMetadata for admins)
│   │   ├── EditMetadata.vue             # Admin-only metadata edit dialog (PUT /api/work/:id)
│   │   ├── WorkTree.vue                  # Track tree view for a work
│   │   ├── CoverSFW.vue                  # Cover image with NSFW blur
│   │   ├── RecentWorks.vue               # Recently played works section
│   │   ├── Scrollable.vue                # Scrollable container helper
│   │   ├── SleepMode.vue                 # Sleep timer dialog
│   │   ├── WriteReview.vue               # Review/rating form dialog
│   │   ├── FavListItem.vue               # Favorites list row item
│   │   └── FavList.vue                   # Favorites list component
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
│   │   └── store-flag.d.ts
│   └── mixins/
│       └── Notification.js               # Notification helper mixin (showErrNotif, etc.)
├── src-pwa/                              # PWA service worker files
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
- **Plyr** — audio player UI (`vue-plyr` wrapper)
- **Socket.IO Client** — real-time scan progress events

### 2.2 Routing (`router/routes.js`)

Three route groups:

| Route | Layout | Description |
|-------|--------|-------------|
| `/admin` | `DashboardLayout` | Admin dashboard (folders, scanner, advanced, user mgmt) |
| `/` | `MainLayout` | Main app with persistent audio player at bottom |
| `/login` | None | Standalone login page |

Main layout routes:

| Route | Name | Page | Description |
|-------|------|------|-------------|
| `/` | — | redirect→works | Root redirect |
| `/works` | `works` | Works | Media library (grid/list, sort, filter, search) |
| `/work/:id` | — | Work | Work detail + track list |
| `/fullScreenPlayer/:id?` | — | FullScreenPlayer | Full-screen player mode |
| `/circles` | — | List | Browse by circle (artist group) |
| `/tags` | — | List | Browse by tag |
| `/vas` | — | List | Browse by voice actor |
| `/favourites` | — | Favourites | History, reviews |
| `/favourites/review` | — | Favourites | Review history |
| `/favourites/progress/*` | — | Favourites | Progress (marked/listening/listened/replay/postponed) |
| `/favourites/folder` | — | Favourites | Folder view |
| `/favourites/history` | — | Favourites | Play history |

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
  swapSeekButton: false,          // Swap seek/next buttons
  enableVisualizer: false,        // Audio visualizer
  enableVideoSource: false,       // Use <video> for playback
  playWorkId: 0,                  // Currently playing work ID
  enablePIPLyrics: false,         // Picture-in-picture lyrics (disabled on Android)
  resumeHistorySeconds: -1,       // Resume position from history
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

### 2.4 Boot Files

| Boot File | File | Purpose |
|-----------|------|---------|
| `axios.js` | `src/boot/axios.js` | Configures Axios defaults (Content-Type, JWT Bearer token from LocalStorage); exposes `$axios` globally |
| `store.js` | `src/boot/store.js` | Initializes Vuex store |
| `slider.js` | `src/boot/slider.js` | Registers Vue Slider Component (`vue-slider-component`) |
| `plyr.js` | `src/boot/plyr.js` | Registers Plyr audio player component (`vue-plyr`) |
| `socket.io.js` | `src/boot/socket.io.js` | Creates Socket.IO client (autoConnect: false); exposes `$socket` globally |

### 2.5 Audio Player Architecture

The audio player is a multi-component system fixed at the bottom of `MainLayout`:

```
MainLayout
├── PlayerBar        # Mini bar (always visible at bottom)
├── AudioPlayer      # Floating panel (toggle-able, shows cover + controls)
├── LyricsBar        # Lyrics display (below player)
└── PIPLyrics        # Picture-in-picture lyrics overlay
```

- **AudioPlayer.vue** — Floating card at bottom-right with cover art, track controls, seek bar, volume, playback mode. Uses Plyr under the hood (supports both `<audio>` and `<video>` elements).
- **PlayerBar.vue** — Compact mini-bar always visible when a track is playing (contains basic controls).
- **LyricsBar.vue** — Parses LRC files and syncs with playback position.
- **PIPLyrics.vue** — Picture-in-picture mode for desktop browsers (disabled on Android).
- Configuration like seek times, visualizer toggle, and PIP lyrics are persisted in `LocalStorage`.

### 2.6 Communication with Backend

- **REST API:** All data operations via Axios (`/api/*` endpoints). JWT token stored in `LocalStorage` as `jwt-token`. Set in `src/boot/axios.js`:
  ```javascript
  axios.defaults.headers['Authorization'] = LocalStorage.getItem('jwt-token')
    ? 'Bearer ' + LocalStorage.getItem('jwt-token')
    : ''
  ```
- **WebSocket (Socket.IO):** Used for real-time scan progress updates. The client connects after auth and **both emits and listens**: it emits `PERFORM_SCAN`, `PERFORM_UPDATE`, `PERFORM_LYRIC_SCAN`, `KILL_SCAN_PROCESS`, `ON_SCANNER_PAGE`, and listens for `SCAN_INIT_STATE`, `SCAN_TASKS`, `SCAN_FAILED_TASKS`, `SCAN_MAIN_LOGS`, `SCAN_RESULTS`, `SCAN_FINISHED`, `SCAN_ERROR` (all handled in `pages/Dashboard/Scanner.vue`).
- **Public config:** `GET /api/config/shared` retrieves `rewindSeekTime` and `forwardSeekTime` on app mount (`MainLayout.vue` → `readSharedConfig()`).

### 2.7 Key Frontend Features

1. **Infinite Scroll:** `Works.vue` uses `q-infinite-scroll` to paginate results (triggers `onLoad()` callback).

2. **Cover Blurring:** `CoverSFW.vue` handles NSFW content blurring with a toggle.
3. **Sleep Timer:** `SleepMode.vue` (opened from the bedtime button in `AudioPlayer.vue`'s settings row) stops playback either after a chosen number of minutes (5-min slider steps) or after a chosen number of tracks past the current one. The armed timer is persisted in `SessionStorage` under the `sleepTimer` key (`SLEEP_TIMER_KEY`) and restored on reload; stop logic lives in `AudioElement.vue` (`onTimeupdate` for minutes, `onEnded` for tracks).
4. **Dark Mode:** Toggled via Quasar's `Dark` plugin, persisted in browser across sessions.
5. **Progress Tracking:** Users can mark works as `listening`, `listened`, `replay`, or `postponed`.
6. **Work Card Variants:** Two card styles — modern `WorkCard.vue` (hover-reveal tags) and legacy `OldWorkCard.vue` (always-show tags), toggleable via LocalStorage key `old_work_card_ui_style_key`.
7. **Metadata Editing (admin only):** `WorkDetails.vue` shows an "编辑元数据" button only when the current user is an admin (computed `isAdmin`: auth disabled, or `group === 'administrator'`, or `name === 'admin'`). It opens `EditMetadata.vue`, which PUTs to `/api/work/:id` with `{title, nsfw, release, circle, tags[], vas[], illustrators[], scriptWriters[], series}`. Tag/VA/illustrator/script-writer/series inputs use Quasar `q-select` with `use-input` autocomplete, fetching options from `/api/tags`, `/api/vas`, `/api/illustrators`, `/api/script_writers`, `/api/seriess` (note the irregular plural `seriess`). On save, the dialog emits `saved` and `WorkDetails.vue` re-reads the work metadata.
8. **Keyboard Shortcuts:** Space for play/pause, arrow keys for seeking, etc. (handled in AudioPlayer).

---

## 3. Critical Conventions & Gotchas

- **JWT Token Management:** Token is read from `LocalStorage` on app boot (`axios.js`). If a 401 response is received from `/api/auth/me`, the app redirects to `/login`.
- **Keep-Alive:** `Works` page is wrapped in `<keep-alive include="Works">` in `MainLayout.vue`. Its `activated` hook should be used for data refreshes when returning from other pages.
- **SPA History Fallback:** The backend uses `connect-history-api-fallback` so Vue Router handles all non-`/api` routes. No hash routing needed.
- **Dev Server Proxy:** In development (`quasar dev`), `quasar.config.js` proxies `/api` and `/socket.io` to `localhost:8888` (the backend).
- **Service Worker:** PWA mode uses Workbox (GenerateSW). The SW config in `quasar.config.js` excludes `/api/*` and `/media/*` from navigation fallback.
- **LocalStorage Keys (reserved):**
  | Key | Type | Purpose |
  |-----|------|---------|
  | `jwt-token` | string | JWT Bearer token |
  | `swap_seek_button` | boolean | Swap seek/next buttons |
  | `enable_visualizer` | boolean | Audio visualizer toggle |
  | `enable_pip_lyrics` | boolean | Picture-in-picture lyrics |
  | `enable_video_source` | boolean | Use `<video>` element for playback |
  | `ai_server_url` | string | AI server URL (unused?) |
  | `old_work_card_ui_style_key` | boolean | Legacy card UI toggle |

---

## 4. Dependencies

| Dependency | Purpose |
|------------|---------|
| `quasar` | UI framework (Material Design components) |
| `@quasar/app-webpack` | Build toolchain (webpack-based) |
| `vue` + `vue-router` + `vuex` | Core SPA framework (Vue 3) |
| `axios` | HTTP client for REST API |
| `socket.io-client` | WebSocket client for scan progress |
| `plyr` + `vue-plyr` | Audio player UI |
| `lrc-file-parser` | LRC lyrics file parser |
| `vue-slider-component` | Slider component (volume, seek bar) |
| `vuedraggable` | Drag-and-drop queue reordering |
| `register-service-worker` | PWA service worker registration |
| `sass` | SCSS preprocessing |

---

## 5. Scripts

```bash
npm install        # Install dependencies

npm run build      # Build for production (default: SPA)

npm test           # Run ESLint
```

---

## 6. API Contract (Consumed from Backend)

| Endpoint | Method | Used In | Purpose |
|----------|--------|---------|---------|
| `/api/auth/me` | GET | `MainLayout.vue` | Get current user + auth status |
| `/api/auth/login` | POST | `Login.vue` | Authenticate, get JWT |
| `/api/works` | GET | `Works.vue` | List/search works (paginated, sorted, filtered) |
| `/api/work/:id` | GET | `Work.vue` | Get work metadata + playback state |
| `/api/work/:id/memo` | GET | `Work.vue` | Get work memo incl. lazily-computed content hashes (`{ contentHash: { relPath: contentHash } }`). Only endpoint reading audio file bytes; fetched after tree renders, merged onto nodes by `relPath` to populate per-track badges. |
| `/api/tags` | GET | `List.vue` | List all tags |
| `/api/circles` | GET | `List.vue` | List all circles |
| `/api/vas` | GET | `List.vue` | List all VAs |
| `/api/media/:id/:file` | GET | `AudioPlayer.vue` | Stream audio file (supports Range) |
| `/api/cover/:id` | GET | `CoverSFW.vue` | Get cover image |
| `/api/files/:id` | GET | `Work.vue` | List files in a work |
| `/api/review/:id` | GET/POST/PUT/DELETE | `WorkDetails.vue` | Work reviews. PUT with `progressOnly=true` and `autoMark=true` only writes `progress='listened'` if existing is not terminal (listened/replay/postponed). |
| `/api/review/progress` | DELETE | `WorkDetails.vue` | Clear only `progress` (NULL), preserving rating/review_text. If the row has no rating/review_text, the whole row is deleted. Query `work_id`. |
| `/api/history` | GET | `Favourites.vue`, `RecentWorks.vue` | List works with playback history. Optional `excludeFinished` (`all`|`listened`, default `listened`). Response items include nullable `progress`. |
| `/api/history/:id` | GET/POST | `Work.vue` | Playback state (history) |
| `/api/config/shared` | GET | `MainLayout.vue` | Public config (seek times) |
| `/api/version` | GET | `MainLayout.vue` | Version + update info |
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

### Adding a new component
1. Create a Vue component in `src/components/`.
2. Import and register it in the parent component.

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
- **Run:** `npm test` (from repo root)

---

## 10. Development Tips

- **JWT in dev:** If auth is enabled, log in via `/login` first. Token persists across hot reloads.
- **PWA testing:** Dev mode disables service workers. Use a production build to test PWA features.
- **Dark mode:** Quasar's `Dark` plugin respects OS preference (`dark: auto`). Toggle via `Dark.toggle()` in `MainLayout.vue`.
- **Component debugging:** Install Vue DevTools for inspecting Vuex state and component hierarchy.
