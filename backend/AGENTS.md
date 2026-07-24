# Kikoeru Express — AGENTS Guide

This document serves as a comprehensive reference for AI agents working on the **kikoeru-express** codebase. It describes the project's architecture, conventions, and important implementation details.

## Project Overview

**Kikoeru** is a self-hosted media streaming server for [DLsite](https://www.dlsite.com) voice works (doujin audio). It scrapes metadata from DLsite, organizes audio files, and serves them via a web UI with features like progress tracking, ratings, reviews, tag-based search, and real-time library scanning.

- **Language:** Node.js (JavaScript, Express)
- **Database:** SQLite3 via Knex.js
- **Auth:** JWT (JSON Web Tokens)
- **Real-time:** Socket.IO
- **Scraping:** Axios + Cheerio
- **License:** GPL-3.0-or-later

## Project Structure

```
├── routes/               # Express route handlers
│   ├── index.js          # Route aggregator (mounts all sub-routes under /api)
│   ├── auth.js           # Login, user info, password change
│   ├── config.js         # Read/write server config
│   ├── credentials.js    # User CRUD (admin only)
│   ├── media.js          # Streaming, file listing, cover images
│   ├── metadata.js       # Works listing, search, sort, filter, tag/VA queries
│   ├── play_histroy.js   # Playback state persistence
│   ├── review.js         # User reviews, ratings, progress
│   └── version.js        # Version info, release notes
├── auth/
│   └── utils.js          # JWT issuer/audience helpers
├── config/
│   └── config.json       # Runtime config (auto-generated on first run)
├── covers/               # Cached cover images
├── database/
│   ├── db.js             # Knex instance, connection config
│   ├── init.js           # App initialization (db creation, migration, config upgrade)
│   ├── knexfile.js       # Knex config for migrations
│   ├── knex-migrate.js   # Migration runner
│   ├── migrations/       # Database migration files (timestamped)
│   ├── schema.js         # Full database schema definition (createSchema)
│   └── storage.js        # DB path resolution
├── dist/                 # Frontend SPA/PWA (kikoeru-quasar build output)
├── filesystem/
│   ├── scanner.js        # Entry point: child process for scanning
│   ├── scannerModules.js # Core scanning logic (~25KB)
│   ├── updater.js        # Metadata update entry point
│   ├── workFileScanner.js# Lyric file scanner entry point
│   └── utils.js          # File system utilities
├── scraper/
│   ├── dlsite.js         # DLsite metadata scraper (primary)
│   ├── asmrOne.js        # ASMR.one scraper
│   ├── hvdb.js           # HVDB scraper
│   ├── axios.js          # Axios instance with proxy support
│   └── utils.js          # Scraper utilities
├── sqlite/
│   └── db.sqlite3        # SQLite database file
├── static/               # Static assets
├── api.js                # API setup: JWT middleware + route mounting
├── app.js                # Entry point: Express app, HTTP/HTTPS, Socket.IO
├── config.js             # Config file read/write, defaults, migration
├── socket.js             # Socket.IO initialization + scanner IPC
├── common.js             # Shared utilities
├── upgrade.js            # Upgrade-specific logic
└── VoiceWork/            # Default audio library directory (symlink or mount)
```

## Architecture & Key Design Decisions

### 1. Express App Lifecycle (`app.js`)

1. **Environment:** `dotenv` loaded first. `unhandledRejection` crashes in test/production mode.
2. **Database init:** `initApp()` runs asynchronously (non-blocking) — creates/migrates the DB and upgrades config.
3. **Middleware stack:**
   - `trust proxy` (if behind reverse proxy)
   - `compression` (gzip, if enabled)
   - `body-parser` (urlencoded + json)
   - Dev-only: static file serving for `VoiceWork/`
   - `connect-history-api-fallback` (SPA routing, except `/api/*`)
   - API routes (via `api.js`)
   - Static files from `dist/`
   - Error handler (401 for JWT errors, 500 for others)
4. **Dual HTTP/HTTPS** server creation.
5. **Socket.IO** attached to both servers.

### 2. Authentication (`auth/`)

Two modes:
- **Auth enabled** (`config.auth: true`): JWT required. `express-jwt` middleware validates tokens on `/api/*` routes (except `/api/auth/me` and `/api/health`). Socket.IO uses `socketio-jwt-auth`.
- **Auth disabled** (`config.auth: false`): No authentication. All requests proceed as admin.

### 3. Database Schema

The database uses SQLite3 via Knex.js with the following main tables:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `t_work` | Voice works (audio albums) | `id`, `title`, `dir`, `circle_id`, `release`, `dl_count`, `price`, `rate_average_2dp`, `memo` (JSON) |
| `t_circle` | Circles (artist groups) | `id`, `name` |
| `t_tag` | Tags | `id`, `name` |
| `t_va` | Voice actors | `id` (UUID v5), `name` |
| `r_tag_work` | Tag-work many-to-many | `tag_id`, `work_id` |
| `r_va_work` | VA-work many-to-many | `va_id`, `work_id` |
| `t_user` | Users | `name` (PK), `password`, `group` |
| `t_review` | Reviews & progress | `user_name`, `work_id`, `rating`, `review_text`, `progress` |
| `t_play_histroy` | Playback state | `user_name`, `work_id`, `state` (JSON) |

**Important:** There is a view `staticMetadata` (defined in `schema.js`) that joins all work metadata (circle, VAs, tags) into a single queryable view. Many route queries use `raw` SQL against this view.

### 4. Configuration (`config.js`)

- Config file: `config/config.json` (auto-created with defaults on first run)
- Runtime config is exported as a shared mutable object (`config`).
- `setConfig()` merges new values but **protects** certain fields: `production`, `md5secret`, `jwtsecret` (cannot be changed at runtime).
- `updateConfig()` adds missing keys with defaults on version upgrades.
- A `publicConfig` class exposes a subset (`rewindSeekTime`, `forwardSeekTime`) to the frontend.

### 5. Scanning System (`filesystem/`)

Scanning runs in a **child process** (`child_process.fork`) for isolation:

1. **Socket.IO** in `socket.js` listens for `PERFORM_SCAN`, `PERFORM_UPDATE`, `PERFORM_LYRIC_SCAN` events.
2. It forks the appropriate scanner script (`scanner.js`, `updater.js`, or `workFileScanner.js`).
3. The child process communicates back via `process.send()` with events like `SCAN_INIT_STATE`, `SCAN_DONE`, `SCAN_ERROR`.
4. `scannerModules.js` contains the heavy lifting: reading directories, parsing file structures, scraping DLsite, and upserting into the DB.

### 6. Scraping (`scraper/`)

- **DLsite** (`dlsite.js`): Primary scraper. Fetches work pages, parses HTML with Cheerio, extracts title, circle, tags, VAs, ratings, price, etc.
- **ASMR.one** (`asmrOne.js`): Secondary source.
- **HVDB** (`hvdb.js`): Another metadata source.
- All scrapers use a shared Axios instance (`axios.js`) with proxy support, retry logic, and configurable timeouts.

### 7. Routes (`routes/`)

All routes are mounted under `/api`:

| Route File | Path | Description |
|------------|------|-------------|
| `auth.js` | `/api/auth/*` | Login, current user, password change |
| `credentials.js` | `/api/credentials/*` | User CRUD (admin only) |
| `version.js` | `/api/version/*` | App version, changelog |
| `config.js` | `/api/config/*` | Get/set server config |
| `media.js` | `/api/media/*` | Stream audio, list files, serve covers, download |
| `metadata.js` | `/api/*` | List works, search, sort, filter, get tags/VAs |
| `review.js` | `/api/review/*` | Create/update/delete reviews, ratings, progress |
| `play_histroy.js` | `/api/histroy/*` | Save/load playback state |

### 8. Media Streaming (`routes/media.js`)

- Audio files are streamed using `fs.createReadStream` with range request support (seeking).
- Supports `Range` headers for partial content (206 responses).
- Cover images are served from the `covers/` directory.
- File listing traverses the work directory and returns track info (name, duration, format).

## Critical Conventions & Gotchas

### SQLite
- **No concurrent writes.** The database is SQLite with a busy timeout config.
- **Foreign keys are enabled** via `PRAGMA foreign_keys = ON` in `db.js`.
- Migrations are sequential and stored in `database/migrations/` with timestamp prefixes.

### JWT
- Algorithm: `HS256`
- Token extracted from `Authorization: Bearer <token>` header or `?token=` query param.
- `audience` and `issuer` are derived from `auth/utils.js`.

### Config write protection
- `setConfig()` in `config.js` **always overwrites** `production`, `md5secret`, and `jwtsecret` with their current values, preventing changes through the admin panel.

### Child process communication
- Scanner child processes use `process.on('message')` / `process.send()` for IPC.
- The parent (Socket.IO) relays events to all connected clients.
- Only one scanner process can run at a time (guarded by `scanner` variable in `socket.js`).

### Error handling
- JWT errors → 401 with `WWW-Authenticate` header.
- Missing DB tables → 500 with "数据库结构尚未建立" message.
- In production mode, error messages are sanitized (no stack traces sent to client).

## Dependency Notes

- **`knex`**: Used for both query building and migrations. The `db.js` file creates the Knex instance.
- **`knex-migrate`**: Used programmatically via `knex-migrate.js` (not the CLI).
- **`natural-orderby`**: Natural sorting for filenames (e.g., "track 2" before "track 10").
- **`jschardet`**: Detects text encoding for LRC files and other text files.
- **`jimp`**: Image processing for cover thumbnails.
- **`compare-versions`**: Version comparison for config migration.

## Build & Run

```bash
npm install          # Install dependencies
npm start            # Start server (production)
npm run dev          # Start with nodemon (development)
npm run scan         # Run scanner manually
npm test             # Run ESLint + Mocha tests
npm run build        # Package into standalone executable (pkg)
```

## Development Tips

- **Frontend:** The SPA/PWA is a separate project ([kikoeru-quasar](https://github.com/kikoeru-project/kikoeru-quasar)). Build output goes into `dist/`.
- **Config freezing:** Set `FREEZE_CONFIG_FILE=1` to prevent config file writes during testing.
- **Docker:** Use `docker-compose.yml` with the `IS_DOCKER=1` environment variable (sets default paths).
- **Database path:** Controlled by `databaseFolderDir` in config, or overridden by `dbUseDefaultPath: true` (default).

## Testing

- **Framework:** Mocha + Chai
- **Linting:** ESLint (node plugin)
- **Test files:** Located in `test/` directory
- Run with: `npm test` (sets `NODE_ENV=test`)

## Common Tasks

### Adding a new route
1. Create a route file in `routes/` exporting an Express Router.
2. Add it to `routes/index.js` with `router.use('/path', require('./newRoute'))`.
3. If the route needs auth, it's automatically protected by the JWT middleware in `api.js`.

### Adding a database migration
1. Create a new file in `database/migrations/` with a timestamp prefix (e.g., `20240101000000_my_migration.js`).
2. Export `up` and `down` functions following the existing migration pattern.
3. The migration is run automatically on next startup via `knex-migrate.js`.

### Adding a new scraper source
1. Create a scraper module in `scraper/` following the pattern in `dlsite.js`.
2. Integrate it into `scannerModules.js` where metadata is fetched.

### Modifying the config schema
1. Add the new key with a default value in `defaultConfig` in `config.js`.
2. The `updateConfig()` function will automatically add missing keys on startup.
3. If the key should be protected from runtime changes, add it to the protected fields in `setConfig()`.