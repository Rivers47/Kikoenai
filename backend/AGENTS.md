# Kikoenai Backend — AGENTS Guide

**Kikoenai** is a self-hosted media streaming server for [DLsite](https://www.dlsite.com) voice works (doujin audio). This is the Express API server; the Quasar-based frontend SPA/PWA lives in sibling package `frontend/`.

- **Language:** Node.js (JavaScript, **Express 5**)
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
│   ├── play_history.js      # Playback state persistence
│   ├── review.js            # Reviews, ratings, progress
│   ├── version.js           # Version info, release notes
│   └── utils/               # Shared route utilities (normalize, strftime, url, validate)
├── auth/
│   └── utils.js             # JWT issuer/audience helpers
├── config/
│   └── config.json          # Runtime config (auto-generated on first run)
├── covers/                  # Cached cover images
├── database/
│   ├── db.js                # Thin re-export: singleton knex + databaseExist + queries (via makeQueries)
│   ├── queries.js           # makeQueries(knex) factory: all query functions bound to a knex instance
│   ├── init.js              # App initialization (db creation, migration, config upgrade)
│   ├── knexfile.js          # Knex config for migrations
│   ├── knex-migrate.js      # Migration runner
│   ├── migrations/          # DB migration files (timestamped, 20 migrations)
│   ├── schema.js            # Full database schema (createSchema with all tables)
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
   - `express.json` + `express.urlencoded` (built-in body parsing, Express 5)
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
| `t_work` | Voice works (audio albums) | `id` (TEXT — see id note below), `title`, `dir`, `circle_id`, `nsfw`, `release`, `dl_count`, `price`, `rate_average_2dp`, `memo` (JSON) |
| `t_circle` | Circles (artist groups) | `id` (UUID), `name` |
| `t_tag` | Tags | `id` (UUID), `name` |
| `t_va` | Voice actors | `id` (UUID v5), `name` |
| `t_illustrator` | Illustrators | `id` (UUID), `name` |
| `t_script_writer` | Script writers | `id` (UUID), `name` |
| `t_series` | Series (manual collections) | `id` (UUID), `name` |
| `r_tag_work` | Tag-work many-to-many | `tag_id`, `work_id` |
| `r_va_work` | VA-work many-to-many | `va_id`, `work_id` |
| `r_illustrator_work` | Illustrator-work many-to-many | `illustrator_id`, `work_id` |
| `r_script_writer_work` | Script-writer-work many-to-many | `script_writer_id`, `work_id` |
| `r_series_work` | Series-work many-to-many | `series_id`, `work_id` |
| `t_user` | Users | `name` (PK), `password`, `group` |
| `t_review` | Reviews & progress | `user_name`, `work_id`, `rating`, `review_text`, `progress` |
| `t_play_history` | Playback state | `user_name`, `work_id`, `state` (JSON) |

**Work id / label id note (since migration `20260802000000`):** `t_work.id` and all `work_id` foreign keys are **TEXT**. A DLsite work id is stored already RJ-padded (`'123456'` 6-digit, or `'01134567'` 8-digit — matching `formatID`), so the work URL `/work/123456` shows the original RJ id directly; a Fanza (DMM doujin) work id is the content-id `'d_215444'`. The `d_` prefix distinguishes the source — there is no separate source column. **All** label ids (circle/tag/va/illustrator/script_writer/series) are name-based UUIDs (TEXT PK) resolved by `resolveLabel` in `queries.js`; DLsite RG/genre/SRI ids scraped from the storefront are no longer used as DB ids, and a label shared across DLsite + Fanza merges into one row.

**Tag canonicalization (rename protection):** tag names are canonicalized via `scraper/tag-aliases.json` before UUID resolution. `resolveTagLabel` in `queries.js` (the single choke point covering scan-insert, scan-update, and admin-edit) maps a scraped new Japanese tag name back to its canonical old name so a DLsite rename folds onto the existing `t_tag` row instead of splitting into two. The map is hand-maintained (`scraper/tag-aliases.json`, loaded once at require time — restart to apply); tags not in the map pass through unchanged. Other label tables (circle/va/illustrator/script_writer/series) are not canonicalized. The backend always serves canonical Japanese tag names; UI/tag translation is client-side (see `frontend/AGENTS.md` i18n).

### 2.4 Configuration (`config.js`)

- Config file: `config/config.json` (auto-created with defaults on first run)
- Runtime config is exported as a shared mutable object (`config`).
- `setConfig()` merges new values but **protects** these fields: `production`, `md5secret`, `jwtsecret` (cannot be changed at runtime).
- `updateConfig()` adds missing keys with defaults on version upgrades.
- `publicConfig` class exposes a subset to the frontend (e.g., `rewindSeekTime`, `forwardSeekTime`).
- **Removed:** the legacy `tagLanguage` config key (was non-functional — scrapers always fetch Japanese). It is no longer in `defaultConfig`; a stale `tagLanguage` left in a pre-existing `config.json` is harmless and ignored. UI language is now per-user in the browser (see `frontend/AGENTS.md` i18n).

### 2.5 Scanning System (`filesystem/`)

Scanning runs in a **child process** (`child_process.fork`) for isolation:

1. **Socket.IO** in `socket.js` listens for client events: `PERFORM_SCAN`, `PERFORM_UPDATE`, `PERFORM_LYRIC_SCAN`, `KILL_SCAN_PROCESS`, `ON_SCANNER_PAGE`.
2. It forks the appropriate scanner script (`scanner.js`, `updater.js`, or `workFileScanner.js`); each child is bound to `scannerModules.js`.
3. The child process communicates via `process.send()` with events: `SCAN_INIT_STATE`, `SCAN_TASKS`, `SCAN_FAILED_TASKS`, `SCAN_MAIN_LOGS`, `SCAN_RESULTS`, `SCAN_FINISHED`, `SCAN_ERROR`. The parent relays any `m.event` it receives from the child to all connected clients via `io.emit(m.event, m.payload)`.
4. `scannerModules.js` contains the heavy lifting: reading directories, parsing file structures, scraping DLsite, and upserting into the DB.

Only one scanner process can run at a time (guarded by `scanner` variable in `socket.js`).

### 2.6 Scraping (`scraper/`)

- **DLsite** (`dlsite.js`): Primary scraper. Fetches work pages, parses HTML with Cheerio.
- **ASMR.one** (`asmrOne.js`): Secondary source.
- **HVDB** (`hvdb.js`): Another metadata source.
- **Fanza** (`fanza.js`): Scrapes Fanza (DMM) doujin detail pages. Uses age-check cookies to bypass the adult interstitial. Identifies works by `d_`-prefixed content ids.
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
| `metadata.js` | `/api/*` | List works, search, sort, filter; list tags/VAs/illustrators/script writers/series; `PUT /api/work/:id` admin metadata edit |

> **Route note:** the plural field-list routes (`/api/circles`, `/api/tags`, `/api/vas`, `/api/illustrators`, `/api/script_writers`, `/api/seriess` — note the irregular double-`s` plural) are registered as **literal-path loops** over a `FIELDS` array in `metadata.js` (a `for...of` loop registering one `router.get` per field). Express 5 (path-to-regexp v8) no longer supports regex char-classes in route strings, so the old `/:field(circle|tag|va|...|series)s/...` single-regex-route form was replaced. Each handler receives its `field` via closure.
| `review.js` | `/api/review/*` | Create/update/delete reviews, ratings, progress |
| `play_history.js` | `/api/history/*` | Save/load playback state |
| `track_progress.js` | `/api/track-progress/*` | Per-track playback progress (SHA-256 content-hashed) |
| `backfill.js` | `/api/backfill/*` | Admin: replay play history to backfill listened markers + track progress (`POST /api/backfill/progress`, `{ dryRun?: bool }` → `{ logs[], summary }`) |

### 2.8 Media Streaming (`routes/media.js`)

- Audio files are streamed using `fs.createReadStream` with range request support (206 Partial Content for seeking).
- Cover images served from `covers/` directory.
- File listing traverses the work directory and returns track info (name, duration, format).

---

## 3. Critical Conventions & Gotchas

- **SQLite:** No concurrent writes. Busy timeout configured. Foreign keys enabled via `PRAGMA foreign_keys = ON` in `db.js`.
- **Migrations:** Sequential, timestamp-prefixed files in `database/migrations/`. Run automatically on **every** startup via `knex-migrate.js` (`init.js`); umzug tracks executed migrations in the `knex_migrations` table, so only pending ones run (idempotent — no version bump required for a migration to be picked up). The app-version comparison in `init.js` gates only the version-keyed upgrade tasks (`applyFix`/`fixMigrations` in `upgrade.js`, `updateConfig`) — those must run **before** `up` because they can mark migrations as executed (`skipAll`). `dbVersion` in `schema.js` must always equal the latest migration's timestamp prefix (asserted by `test/migration..js`).
- **Config write protection:** `setConfig()` always overwrites `production`, `md5secret`, `jwtsecret` with current values — these cannot be changed through the admin panel.
- **Error handling:** JWT errors → 401 with `WWW-Authenticate` header. Missing DB tables → 500 with "数据库结构尚未建立". Production mode sanitizes error messages (no stack traces).
- **Child process IPC:** Uses `process.on('message')` / `process.send()`. Parent (Socket.IO) relays events to all connected clients.
- **Scanner concurrency:** Only one scanner child process runs at a time, guarded by the in-memory `scanner` variable in `socket.js` (not a lock file). Subsequent `PERFORM_*` events are ignored while a scan is in progress.
- **Update lock file:** `upgrade.js` maintains `update.lock` in the config folder for the one-time upgrade/migration process (e.g. `fixVA`). Its state is surfaced as `lockFileExists` in the `/api/version` response — this is unrelated to scan concurrency.
- **Express 5 migration notes:** `res.sendFile`/`express.static` now reject paths containing dot-segments unless `dotfiles: 'allow'` — `routes/media.js` passes `{ dotfiles: 'allow' }` to its `res.sendFile` calls to preserve v4 behavior for user audio paths. `express-validator` is on **v7**, where `.optional({ nullable: true })` became `.optional()`. `req.body` is `undefined` (not `{}`) before body parsing. Async route handlers have rejected promises forwarded to the error handler automatically.
- **Metadata editing (admin only):** `PUT /api/work/:id` (`routes/metadata.js`) is gated by `config.auth && req.user.name !== 'admin'` → 403. When `config.auth` is false, all requests act as admin and editing is unrestricted. The handler validates the body with `express-validator` and delegates to `db.editWorkMetadata(workId, data)`, which runs in a single Knex transaction and **replaces** (not merges) the tag/VA/illustrator/script-writer/series relationships for the work, then re-fetches via `db.getWorkMetadata`.
- **Label id conventions:** **All** label tables (`t_circle`, `t_tag`, `t_va`, `t_illustrator`, `t_script_writer`, `t_series`) use **name-based UUID** ids, resolved/created by the unified `resolveLabel(trx, table, name)` helper in `queries.js` (deterministic `nameToUUID(name)` + `INSERT OR IGNORE`). Explicit numeric ids emitted by scrapers (DLsite RG/genre/SRI ids) are ignored. When editing metadata, list elements are normalized to `{id?, name}`, trimmed, and de-duplicated by name; `id` is optional (the server resolves or creates the row by name).

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

---

## 5. Scripts

```bash
npm start       # Start server (production)
npm run dev     # Start with nodemon (development)
npm run scan    # Run scanner manually
npm test        # ESLint + Mocha tests
```

> **Packaging:** the deprecated `pkg` single-executable path has been removed. A
> Windows portable build (bundled Node + Windows-native sqlite3 + ffmpeg) is now
> produced from the repo root via `npm run package:windows` (see root `README.md`
> and `.github/workflows/package-windows.yml`). Data folders resolve to
> `KIKO_DATA_DIR || __dirname` (see `config.js`).

---

## 6. API Contract (Exposed to Frontend)

The following endpoints are consumed by the `frontend/` package:

**Id formats:** work-id route params (`:id` on `/api/work`, `/api/cover`, `/api/tracks`, `/api/media/*`, `/api/refresh`, `/api/work/scan`) are **strings** matching `^(\d{6,8}|d_\d+)$` — DLsite ids are already RJ-padded digit strings, Fanza ids are `d_`-prefixed (validated by `workIdParam`/`workIdBody` in `routes/utils/validate.js`). Label-id params (`/api/:fields/:id/works`) are UUID strings.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/auth/me` | GET | Get current user + auth status |
| `/api/auth/login` | POST | Authenticate, get JWT |
| `/api/works` | GET | List/search works (supports pagination, sort, filter) |
| `/api/search` | GET | Keyword search
| `/api/:fields/:id/works` | GET | Works filtered
| `/api/work/:id` | GET | Get work metadata + playback state |
| `/api/work/:id/memo` | GET | Get work memo incl. lazily-computed content hashes (`{ contentHash: { relPath: contentHash } }`). Only endpoint that reads audio file bytes (CRC32 via zlib, mtime-invalidated, cached in `t_work.memo.contentHash`). Frontend fetches after tree renders and merges hashes onto nodes by relPath. |
| `/api/tags` | GET | List all tags |
| `/api/circles` | GET | List all circles |
| `/api/vas` | GET | List all VAs |
| `/api/media/:id/:file` | GET | Stream audio file (supports Range) |
| `/api/cover/:id` | GET | Get cover image |
| `/api/files/:id` | GET | List files in a work |
| `/api/review` | GET | List works the user has reviewed/rated/progress-marked
| `/api/review/:id` | GET/POST/PUT/DELETE | Work reviews
| `/api/review` | PUT | Create/update review, rating, or progress. Optional query `autoMark` (boolean): when `progressOnly=true` and `autoMark=true`, only writes `progress='listened'` if existing progress is null/empty/marked/listening; no-op on listened/replay/postponed.
| `/api/review` | DELETE | Delete the whole review row (rating + review_text + progress). Query `work_id`.
| `/api/review/progress` | DELETE | Clear only `progress` (set NULL), preserving rating/review_text. If the row has no rating AND no review_text (e.g. an auto-marked rating-null row), the whole row is deleted to avoid an all-NULL empty row. Query `work_id`.
| `/api/history` | GET | List works the user has playback history for. Optional query `excludeFinished` (`all`|`listened`, default `listened`): when `listened`, excludes rows where `t_review.progress='listened'`. Response items include nullable `progress` field.
| `/api/history/:id` | GET/POST | Playback state (history) |
| `/api/config/shared` | GET | Public config (seek times) |
| `/api/version` | GET | Version + update info |
| `/api/work/:id` | PUT | Manually edit work metadata — title, nsfw, release, circle, tags[], vas[], illustrators[], scriptWriters[], series (admin only) |
| `/api/illustrators` | GET | List all illustrators (autocomplete for metadata editor) |
| `/api/script_writers` | GET | List all script writers (autocomplete for metadata editor) |
| `/api/seriess` | GET | List all series (autocomplete for metadata editor) |
| `/api/track-progress` | PUT | Report per-track playback progress. Accepts `{work_id, contentHash, seconds, completed}`. Upserts `t_track_progress` keyed by contentHash directly — no file read. |
| `/api/backfill/progress` | POST | Admin: replay play history to mark finished works `listened` and seed `t_track_progress` (computes SHA-256 from disk). Body `{ dryRun?: bool }` → `{ logs[], summary }`. |

> **Tracks response (Phase 2):** `GET /api/tracks/:id` returns `{ tree, trackProgress }` instead of a bare array. The tree is built from the directory listing + `t_work.memo` (durations) **without reading any audio file bytes** — `contentHash` on audio nodes is populated only from already-cached `memo.contentHash` (null/undefined where not yet hashed). Audio nodes carry `trackId` (session-stable file handle, was `hash`), `relPath` (relative path from work root), the stable key the frontend uses to merge late-arriving hashes. `trackProgress` is a `{contentHash: {seconds, completed}}` map. Content hashes are computed lazily by `GET /api/work/:id/memo` (the only endpoint that reads file bytes) and merged onto tree nodes reactively by `relPath`. This is a breaking response-shape change; `Work.vue` handles both via `response.data.tree || response.data`.

> **Note:** Library scanning is **not** a REST endpoint. The frontend triggers it over Socket.IO (`PERFORM_SCAN` / `PERFORM_UPDATE` / `PERFORM_LYRIC_SCAN`) and listens for the `SCAN_*` events above. The plural-list route `/:field(circle\|tag\|va\|illustrator\|script_writer\|series)s/` powers the `/api/illustrators`, `/api/script_writers`, and `/api/seriess` endpoints above (note the irregular plural `seriess`).

---

## 7. Monorepo Integration

The frontend builds directly into `backend/dist/` (configured via `distDir` in `frontend/quasar.config.js`) and is served as static content by Express.

- **Workspace scripts:** `npm run dev:backend` / `npm start` from root.
- **Socket.IO events (scanning):**
  - Client → server: `PERFORM_SCAN`, `PERFORM_UPDATE`, `PERFORM_LYRIC_SCAN`, `KILL_SCAN_PROCESS`, `ON_SCANNER_PAGE`
  - Server → client (relayed from the scanner child process): `SCAN_INIT_STATE`, `SCAN_TASKS`, `SCAN_FAILED_TASKS`, `SCAN_MAIN_LOGS`, `SCAN_RESULTS`, `SCAN_FINISHED`, `SCAN_ERROR`
  - Scanning is **not** exposed over REST; there is no `/api/scanner` endpoint.

---

## 8. Common Development Tasks

### Adding a new route
1. Create route file in `routes/` exporting an Express Router.
2. Add it to `routes/index.js` with `router.use('/path', require('./newRoute'))`.
3. Routes under `/api` are automatically protected by JWT middleware in `api.js`.

### Adding a database migration
1. Create file in `database/migrations/` with timestamp prefix (e.g., `20260802000000_my_migration.js`).
2. Export `up` and `down` functions following existing patterns.
3. Bump `dbVersion` in `database/schema.js` to the new timestamp prefix and update `createSchema` so a fresh DB matches the migrated one.
4. Migration runs automatically on next server startup, logging `Doing migrate on <file>` (and `数据库迁移完成` when the startup is also a version upgrade). Pending migrations run on every boot regardless of version bumps — the `knex_migrations` table is the source of truth, not the app version.

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
- **Tests:** Located in `test/` directory:
  - `edit-metadata.js` — covers the `PUT /api/work/:id` flow and `db.editWorkMetadata` (uses shared `db-test.sqlite3` singleton)
  - `benchmark.js` — DB query benchmark; Skips if `backend/sqlite/db.sqlite3` is missing/empty;
- **Run:** `npm test` (sets `NODE_ENV=test`)

---

## 10. Development Tips

- **Config freezing:** Set `FREEZE_CONFIG_FILE=1` to prevent config file writes during testing.
- **Docker:** Use `docker-compose.yml` with `IS_DOCKER=1` env var (sets default paths).
- **Database path:** Controlled by `databaseFolderDir` in config, or `dbUseDefaultPath: true` (default).
