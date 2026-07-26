# Kikoenai Backend — AGENTS Guide

**Kikoenai** is a self-hosted media streaming server for [DLsite](https://www.dlsite.com) voice works (doujin audio). This is the Express API server; the Quasar-based frontend SPA/PWA lives in sibling package `frontend/`.

- **Language:** Node.js (JavaScript, Express)
- **Database:** SQLite3 via Knex.js
- **Auth:** JWT (JSON Web Tokens)
- **Real-time:** Socket.IO
- **Scraping:** Axios + Cheerio
- **License:** GPL-3.0-or-later

---

## 1. Project Structure

```
├── routes/                  # Express route handlers (mounted under /api)
│   ├── index.js             # Route aggregator
│   ├── auth.js              # Login, user info, password change
│   ├── config.js            # Read/write server config
│   ├── credentials.js       # User CRUD (admin only)
│   ├── media.js             # Audio streaming, file listing, covers, download
│   ├── metadata.js          # Works listing, search, sort, filter, tag/VA queries
│   ├── play_histroy.js      # Playback state persistence
│   ├── review.js            # Reviews, ratings, progress
│   ├── version.js           # Version info, release notes
│   └── utils/               # Shared route utilities (normalize, strftime, url, validate)
├── auth/
│   └── utils.js             # JWT issuer/audience helpers
├── config/
│   └── config.json          # Runtime config (auto-generated on first run)
├── covers/                  # Cached cover images
├── database/
│   ├── db.js                # Knex instance, connection config
│   ├── init.js              # App initialization (db creation, migration, config upgrade)
│   ├── knexfile.js          # Knex config for migrations
│   ├── knex-migrate.js      # Migration runner
│   ├── migrations/          # DB migration files (timestamped, 17 migrations)
│   ├── schema.js            # Full database schema (createSchema with all tables + views)
│   └── storage.js           # DB path resolution
├── dist/                    # Frontend build output (kikoeru-quasar)
├── filesystem/
│   ├── scanner.js           # Entry point: child process for scanning
│   ├── scannerModules.js    # Core scanning logic (~25KB)
│   ├── updater.js           # Metadata update entry point
│   ├── workFileScanner.js   # Lyric file scanner entry point
│   └── utils.js             # File system utilities
├── scraper/
│   ├── dlsite.js            # DLsite metadata scraper (primary)
│   ├── asmrOne.js           # ASMR.one scraper
│   ├── hvdb.js              # HVDB scraper
│   ├── axios.js             # Axios instance with proxy support
│   └── utils.js             # Scraper utilities
├── sqlite/
│   └── db.sqlite3           # SQLite database file
├── static/                  # Static assets
├── api.js                   # API setup: JWT middleware + route mounting
├── app.js                   # Entry point: Express app, HTTP/HTTPS, Socket.IO
├── config.js                # Config file read/write, defaults, migration
├── socket.js                # Socket.IO initialization + scanner IPC
├── common.js                # Shared utilities
├── upgrade.js               # Upgrade-specific logic
└── VoiceWork/               # Default audio library directory (symlink or mount)
```

---

## 2. Architecture & Key Design Decisions

### 2.1 App Lifecycle (`app.js`)

1. **Environment:** `dotenv` loaded first. `unhandledRejection` crashes in test/production mode.
2. **Database init:** `initApp()` runs asynchronously (non-blocking) — creates/migrates the DB and upgrades config.
3. **Middleware stack (in order):**
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

### 2.2 Authentication (`auth/utils.js`)

Two modes:
- **Auth enabled** (`config.auth: true`): JWT required. `express-jwt` middleware validates tokens on `/api/*` routes (except `/api/auth/me` and `/api/health`). Socket.IO uses `socketio-jwt-auth`.
- **Auth disabled** (`config.auth: false`): No authentication. All requests proceed as admin.

JWT details: Algorithm is `HS256`, token extracted from `Authorization: Bearer <token>` header or `?token=` query param. `audience` and `issuer` derived from `auth/utils.js`.

### 2.3 Database Schema

SQLite3 via Knex.js with the following tables:

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

### 2.4 Configuration (`config.js`)

- Config file: `config/config.json` (auto-created with defaults on first run)
- Runtime config is exported as a shared mutable object (`config`).
- `setConfig()` merges new values but **protects** these fields: `production`, `md5secret`, `jwtsecret` (cannot be changed at runtime).
- `updateConfig()` adds missing keys with defaults on version upgrades.
- `publicConfig` class exposes a subset to the frontend (e.g., `rewindSeekTime`, `forwardSeekTime`).

### 2.5 Scanning System (`filesystem/`)

Scanning runs in a **child process** (`child_process.fork`) for isolation:

1. **Socket.IO** in `socket.js` listens for `PERFORM_SCAN`, `PERFORM_UPDATE`, `PERFORM_LYRIC_SCAN` events.
2. It forks the appropriate scanner script (`scanner.js`, `updater.js`, or `workFileScanner.js`).
3. The child process communicates via `process.send()` with events: `SCAN_INIT_STATE`, `SCAN_DONE`, `SCAN_ERROR`.
4. `scannerModules.js` contains the heavy lifting: reading directories, parsing file structures, scraping DLsite, and upserting into the DB.

Only one scanner process can run at a time (guarded by `scanner` variable in `socket.js`).

### 2.6 Scraping (`scraper/`)

- **DLsite** (`dlsite.js`): Primary scraper. Fetches work pages, parses HTML with Cheerio.
- **ASMR.one** (`asmrOne.js`): Secondary source.
- **HVDB** (`hvdb.js`): Another metadata source.
- All scrapers use a shared Axios instance (`axios.js`) with proxy support, retry logic, and configurable timeouts.

### 2.7 Routes (`routes/`)

All routes mounted under `/api`:

| File | Path | Description |
|------|------|-------------|
| `auth.js` | `/api/auth/*` | Login, current user, password change |
| `credentials.js` | `/api/credentials/*` | User CRUD (admin only) |
| `version.js` | `/api/version/*` | App version, changelog |
| `config.js` | `/api/config/*` | Get/set server config |
| `media.js` | `/api/media/*` | Stream audio (range requests), list files, serve covers, download |
| `metadata.js` | `/api/*` | List works, search, sort, filter, get tags/VAs |
| `review.js` | `/api/review/*` | Create/update/delete reviews, ratings, progress |
| `play_histroy.js` | `/api/histroy/*` | Save/load playback state |

### 2.8 Media Streaming (`routes/media.js`)

- Audio files are streamed using `fs.createReadStream` with range request support (206 Partial Content for seeking).
- Cover images served from `covers/` directory.
- File listing traverses the work directory and returns track info (name, duration, format).

---

## 3. Critical Conventions & Gotchas

- **SQLite:** No concurrent writes. Busy timeout configured. Foreign keys enabled via `PRAGMA foreign_keys = ON` in `db.js`.
- **Migrations:** Sequential, timestamp-prefixed files in `database/migrations/`. Run automatically on startup via `knex-migrate.js`.
- **Config write protection:** `setConfig()` always overwrites `production`, `md5secret`, `jwtsecret` with current values — these cannot be changed through the admin panel.
- **Error handling:** JWT errors → 401 with `WWW-Authenticate` header. Missing DB tables → 500 with "数据库结构尚未建立". Production mode sanitizes error messages (no stack traces).
- **Child process IPC:** Uses `process.on('message')` / `process.send()`. Parent (Socket.IO) relays events to all connected clients.
- **Scanner lock file:** A lock file prevents concurrent scans. Check `lockFileExists` in version endpoint response.

---

## 4. Dependencies

| Dependency | Purpose |
|------------|---------|
| `knex` + `knex-migrate` | Query building and programmatic migrations |
| `sqlite3` | Database driver |
| `axios` + `cheerio` | HTTP scraping + HTML parsing |
| `jsonwebtoken` + `express-jwt` | JWT auth |
| `socket.io` | Real-time events (scan progress) |
| `jimp` | Image processing for cover thumbnails |
| `jschardet` | Text encoding detection for LRC files |
| `natural-orderby` | Natural sorting of filenames |
| `compare-versions` | Version comparison for config migration |
| `pkg` | Packaging into standalone executable |

---

## 5. Scripts

```bash
npm start       # Start server (production)
npm run dev     # Start with nodemon (development)
npm run scan    # Run scanner manually
npm test        # ESLint + Mocha tests
npm run build   # Package into standalone executable (pkg)
```

---

## 6. API Contract (Exposed to Frontend)

The following endpoints are consumed by the `frontend/` package:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/me` | GET | Get current user + auth status |
| `/api/auth/login` | POST | Authenticate, get JWT |
| `/api/works` | GET | List/search works (supports pagination, sort, filter) |
| `/api/work/:id` | GET | Get work metadata + playback state |
| `/api/tags` | GET | List all tags |
| `/api/circles` | GET | List all circles |
| `/api/vas` | GET | List all VAs |
| `/api/media/:id/:file` | GET | Stream audio file (supports Range) |
| `/api/cover/:id` | GET | Get cover image |
| `/api/files/:id` | GET | List files in a work |
| `/api/review/:id` | GET/POST/PUT/DELETE | Work reviews |
| `/api/histroy/:id` | GET/POST | Playback state (history) |
| `/api/config/shared` | GET | Public config (seek times) |
| `/api/version` | GET | Version + update info |
| `/api/scanner` | POST | Trigger library scan |

---

## 7. Monorepo Integration

The frontend builds directly into `backend/dist/` (configured via `distDir` in `frontend/quasar.config.js`) and is served as static content by Express.

- **Workspace scripts:** `npm run dev:backend` / `npm start` from root.
- **Socket.IO events:** Server emits scan progress events (`SCAN_INIT_STATE`, `SCAN_DONE`, `SCAN_ERROR`, `SCAN_PROGRESS`). Client emits none.

---

## 8. Common Development Tasks

### Adding a new route
1. Create route file in `routes/` exporting an Express Router.
2. Add it to `routes/index.js` with `router.use('/path', require('./newRoute'))`.
3. Routes under `/api` are automatically protected by JWT middleware in `api.js`.

### Adding a database migration
1. Create file in `database/migrations/` with timestamp prefix (e.g., `20240101000000_my_migration.js`).
2. Export `up` and `down` functions following existing patterns.
3. Migration runs automatically on next server startup.

### Adding a new scraper source
1. Create scraper module in `scraper/` following `dlsite.js` pattern.
2. Integrate into `scannerModules.js` where metadata is fetched.

### Modifying server config schema
1. Add new key with default in `defaultConfig` in `config.js`.
2. `updateConfig()` auto-adds missing keys on startup.
3. Add protected fields to `setConfig()` if they should not be runtime-changed.

---

## 9. Testing

- **Framework:** Mocha + Chai
- **Linting:** ESLint (node plugin)
- **Tests:** Located in `test/` directory
- **Run:** `npm test` (sets `NODE_ENV=test`)

---

## 10. Development Tips

- **Config freezing:** Set `FREEZE_CONFIG_FILE=1` to prevent config file writes during testing.
- **Docker:** Use `docker-compose.yml` with `IS_DOCKER=1` env var (sets default paths).
- **Database path:** Controlled by `databaseFolderDir` in config, or `dbUseDefaultPath: true` (default).
