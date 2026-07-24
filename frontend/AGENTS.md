# Kikoeru Quasar — Frontend

A self-hosted web media player for listening to DLsite voice works. Built with Vue 2 + Quasar Framework v1.

## Tech Stack

- **Framework**: Vue 2 + Quasar v1 (UI framework)
- **State Management**: Vuex (with `AudioPlayer` and `User` modules)
- **Router**: Vue Router (history mode)
- **HTTP Client**: Axios
- **Audio Player**: Plyr (via `vue-plyr`)
- **Lyrics**: `lrc-file-parser`, custom SRT/VTT parser
- **Realtime**: Socket.IO (via `vue-socket.io`)
- **Slider**: `vue-slider-component`

## Project Structure

```
src/
├── App.vx                          # Root component
├── layouts/
│   ├── MainLayout.vue              # Main app layout (header, drawer, player bar, lyrics)
│   └── DashboardLayout.vue         # Admin dashboard layout
├── pages/
│   ├── Works.vue                   # Work listing / search results (main browse page)
│   ├── Work.vue                    # Single work detail page
│   ├── List.vue                    # Circles / Tags / VAs listing
│   ├── Login.vue                   # Login page
│   ├── Favourites.vue              # History, reviews, progress, folders
│   ├── FullScreenPlayer.vue        # Full-screen audio player with visualizer
│   ├── Error404.vue                # 404 page
│   └── Dashboard/
│       ├── Folders.vue             # Media folder management
│       ├── Scanner.vue             # File scanning
│       ├── Advanced.vue            # Advanced settings
│       └── UserManage.vue          # User management
├── components/
│   ├── AudioPlayer.vue             # Main audio player (Plyr wrapper with controls)
│   ├── AudioElement.vue            # Low-level audio element with LRC/SRT/VTT support
│   ├── AudioEqualizer.vue          # Audio visualizer component
│   ├── PlayerBar.vue               # Bottom player bar (playback controls, progress, volume)
│   ├── LyricsBar.vue               # Inline lyrics display
│   ├── PIPLyrics.vue               # Picture-in-picture (desktop) lyrics overlay
│   ├── CoverSFW.vue                # Work cover image with lyric status badges
│   ├── WorkCard.vue                # Work card (grid view)
│   ├── OldWorkCard.vue             # Legacy work card (with tags)
│   ├── WorkListItem.vue            # Work list item (list view)
│   ├── WorkDetails.vue             # Work metadata details (title, circle, rating, etc.)
│   ├── WorkTree.vue                # Track tree view
│   ├── RecentWorks.vue             # Recently played works (horizontal scroll)
│   ├── FavListItem.vue             # Favourite/folder list item
│   ├── Scrollable.vue              # Reusable scrollable container
│   ├── SleepMode.vue               # Sleep timer dialog
│   └── WriteReview.vue             # Review writing dialog
├── store/
│   ├── index.js                    # Vuex store setup
│   ├── module-AudioPlayer/         # Audio player state (playback, queue, lyrics, settings)
│   │   ├── index.js, state.js, getters.js, mutations.js, actions.js
│   └── module-User/                # User state (auth, name, group)
│       ├── index.js, state.js, getters.js, mutations.js, actions.js
├── router/
│   ├── index.js                    # Router setup
│   └── routes.js                   # Route definitions
├── boot/                           # Quasar boot files
│   ├── axios.js, plyr.js, slider.js, socket.io.js
├── mixins/
│   └── Notification.js            # Notify mixin (showSuccNotif, showWarnNotif, showErrNotif)
├── css/
│   ├── app.scss                   # Global styles
│   └── quasar.variables.scss      # Quasar SCSS variables
└── utils.js                        # Utility functions (formatID, formatSeconds, etc.)
```

## Key Architecture

### Layout
- `MainLayout.vue` is the primary layout — it wraps all content pages with a header, a collapsible drawer (navigation), and a fixed-bottom player bar with lyrics.
- `DashboardLayout.vue` is used for admin pages.
- The `Works` page is kept alive via `<keep-alive>`.

### Audio Player
- `PlayerBar.vue` shows the currently playing item, playback controls, progress, and volume.
- `AudioPlayer.vue` contains the actual `<audio>` element (via Plyr), handles track changes, and manages the playback queue.
- `AudioElement.vue` handles low-level audio element operations: loading tracks, lyrics parsing (LRC, SRT, VTT), and offset synchronization.
- The player state is managed in Vuex `module-AudioPlayer`:
  - `queue` — array of track objects `{hash, title, workTitle}`
  - `queueIndex` — current track index
  - `playMode` — order / all repeat / repeat once / shuffle
  - `lyricOffsetSeconds` — manual lyric sync offset
  - `playing`, `currentTime`, `duration`, `volume`, `muted` — playback state
  - `sleepTime`, `sleepMode` — sleep timer
  - `resumeHistroySeconds` — for resuming playback from history

### Lyrics
- Three lyric display modes:
  1. **LyricsBar** — inline lyrics shown below the player bar (default)
  2. **PIPLyrics** — picture-in-picture overlay (desktop, disabled on Android)
  3. **FullScreenPlayer** — embedded lyrics bar in full-screen mode
- Supports LRC, SRT, and VTT subtitle formats.
- Lyric sync offset can be adjusted manually.

### Pages & Routes
| Route | Page | Description |
|---|---|---|
| `/works` | Works | Browse all works with sorting/filtering |
| `/search` | Works (advance search) | Multi-keyword search |
| `/work/:id` | Work | Single work detail with track tree |
| `/circles`, `/tags`, `/vas` | List | Category listings |
| `/fullScreenPlayer/:id?` | FullScreenPlayer | Full-screen player with visualizer |
| `/favourites/...` | Favourites | History, reviews, progress tracking, folders |
| `/login` | Login | Authentication |
| `/admin/...` | Dashboard | Folders, scanner, settings, user management |

### API Conventions
- All API calls go through Axios, base URL is `/api` (proxied in dev mode to `localhost:8888`).
- Authentication uses a JWT token stored in `LocalStorage` under key `jwt-token`.
- Many components use the `Notification.js` mixin for toast notifications.

### Utility Functions (src/utils.js)
- `formatID(id)` — formats numeric work IDs to RJ-style strings (6 or 8 digits).
- `formatSeconds(seconds)` — formats seconds to `HH:MM:SS` or `MM:SS`.
- `basenameWithoutExt(string)`, `extname(string)` — file path utilities.
- `AdvanceSearchCondType` — enum for advanced search condition types (FUZZY, VA, TAG, CIRCLE).

## Build & Dev Commands

```bash
# Install dependencies
npm ci

# Development server (port 8080, proxies /api to localhost:8888)
npx quasar dev

# Production build (SPA)
npx quasar build -m spa

# Production build (PWA)
npx quasar build -m pwa
```

> **Note**: This project uses Webpack 4 (via Quasar v1), which hardcodes `crypto.createHash('md4')`. Since OpenSSL 3 (Node.js 17+) dropped `md4`, `quasar.conf.js` patches `crypto.createHash` to fall back to `sha256` when `md4` is unavailable. No `NODE_OPTIONS=--openssl-legacy-provider` is needed.

## Coding Conventions

- **Vue 2** with Quasar v1 components (not Vue 3 / Quasar v2).
- Single-file components with `<template>`, `<script>`, `<style scoped lang="scss">`.
- Mixins are used for shared logic (e.g., `Notification.js`).
- Vuex mutations follow `UPPER_CASE` naming convention.
- State keys and localStorage keys are defined as constants in `state.js`.
- Chinese comments are present throughout the codebase (original project language).
- The `humanReadableLabel()` pattern in `Works.vue` maps internal enum values to Chinese display labels.
- LocalStorage is used for persisting user preferences (sort order, view mode, etc.).

## Key Implementation Details

### Works.vue — Browsing & Search
- Supports sorting by release date, rating, sales, price, etc.
- Supports filtering by NSFW level.
- Grid view (`WorkCard`) and list view (`WorkListItem`) toggle.
- Detail mode (thumbnail/card size) toggle.
- Old-style card UI option (stored in Vuex, persisted in LocalStorage).
- Infinite scroll via `q-infinite-scroll`.
- Advanced search: multi-keyword with fuzzy/VA/tag/circle scoping.

### User Module
- `auth` boolean — whether user authentication is enabled on the backend.
- `name`, `group` — current user info, initialized on app mount via `GET /api/auth/me`.

### LocalStorage Keys (AudioPlayer)
- `swap_seek_button` — swap rewind/forward buttons
- `enable_visualizer` — audio visualizer toggle
- `enable_pip_lyrics` — PIP lyrics toggle
- `enable_video_source` — video-as-media-source toggle
- `old_work_card_ui_style` — legacy card UI toggle
- `ai_server_url` — (deprecated/removed) AI translation server URL