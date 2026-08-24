# Kikoenai Backend — AGENTS Guide

**Kikoenai** is a self-hosted media streaming server for [DLsite](https://www.dlsite.com) voice works (doujin audio). This is the Express API server; the Quasar-based frontend SPA/PWA lives in sibling package `frontend/`.

- **Language:** Node.js (JavaScript, **Express 5**)
- **Database:** SQLite3 via Knex.js
- **Auth:** Server-side sessions in an HttpOnly cookie
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
│   ├── session.js           # Session create/lookup/destroy, cookie options
│   └── utils.js             # Salted md5 password hashing
├── config/
│   └── config.json          # Runtime config (auto-generated on first run)
├── covers/                  # Cached cover images
├── images/                  # Scraped sample + description images (config.imageFolderDir)
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
│   ├── workExtras.js        # Sample/description image download + DLsite review scraping (shared: scanner + refresh route)
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
├── api.js                   # API setup: session middleware + route mounting
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
   - Error handler (401 for `UnauthorizedError`, 500 for others)
4. **Dual HTTP/HTTPS** server creation.
5. **Socket.IO** attached to both servers.

### 2.2 Authentication (`auth/session.js`)

Two modes:
- **Auth enabled** (`config.auth: true`): a session is required. The `authenticate` middleware in `api.js` validates it on all `/api/*` routes except `POST /auth/me` (login) and `GET /health`. Socket.IO reads the same cookie off the handshake headers.
- **Auth disabled** (`config.auth: false`): No authentication. All requests proceed as admin.

Session details:

- The client holds a 32-byte random secret; `t_session.id` stores only its SHA-256, so a leaked database file does not yield live sessions.
- Read from the `kikoeru_sid` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` only when `config.httpsEnabled`), falling back to `Authorization: Bearer <secret>` for non-browser clients. `POST /api/auth/me` returns the secret as `session` in the body for exactly that case; the web app ignores it and relies on the cookie.
- **There is no `?token=` query parameter.** It was removed with the JWT migration — a credential in a URL leaks into access logs, browser history, and Cache Storage keys.
- `group` is read live from `t_user` on every request, so demoting an administrator takes effect immediately.
- Revocation: `DELETE /api/credentials/user` relies on the `ON DELETE CASCADE` FK; `PUT /api/credentials/user` (password change) calls `destroyUserSessions`. Expired rows are swept hourly from `app.js`.

**CSRF:** `SameSite=Lax` is the only defense, and it is sufficient *only* because every state-changing route is POST/PUT/DELETE. Adding a GET with side effects would reintroduce CSRF.

### 2.3 Database Schema

SQLite3 via Knex.js with the following tables:

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `t_work` | Voice works (audio albums) | `id` (TEXT — see id note below), `title`, `dir`, `circle_id`, `nsfw`, `release`, `dl_count`, `price`, `rate_average_2dp`, `memo` (JSON), `description`, `description_parts` (JSON), `sample_images` (JSON) |
| `t_circle` | Circles (artist groups) | `id` (UUID), `name` |
| `t_tag` | Tags | `id` (UUID), `name` |
| `t_va` | Voice actors | `id` (UUID v5), `name` |
| `t_illustrator` | Illustrators | `id` (UUID), `name` |
| `t_script_writer` | Script writers | `id` (UUID), `name` |
| `t_author` | Authors (作者) | `id` (UUID), `name` |
| `t_series` | Series (manual collections) | `id` (UUID), `name` |
| `r_tag_work` | Tag-work many-to-many | `tag_id`, `work_id` |
| `r_va_work` | VA-work many-to-many | `va_id`, `work_id` |
| `r_illustrator_work` | Illustrator-work many-to-many | `illustrator_id`, `work_id` |
| `r_script_writer_work` | Script-writer-work many-to-many | `script_writer_id`, `work_id` |
| `r_author_work` | Author-work many-to-many | `author_id`, `work_id` |
| `r_series_work` | Series-work many-to-many | `series_id`, `work_id` |
| `t_user` | Users | `name` (PK), `password`, `group` |
| `t_review` | Reviews & progress | `user_name`, `work_id`, `rating`, `review_text`, `progress` |
| `t_play_history` | Playback state | `user_name`, `work_id`, `state` (JSON) |
| `t_dlsite_review` | Scraped DLsite user reviews | `id` (DLsite `member_review_id`), `work_id`, `rate`, `review_title`, `review_text`, `genres` (JSON) |

**Work id / label id note (since migration `20260802000000`):** `t_work.id` and all `work_id` foreign keys are **TEXT**. A DLsite work id is stored already RJ-padded (`'123456'` 6-digit, or `'01134567'` 8-digit — matching `formatID`), so the work URL `/work/123456` shows the original RJ id directly; a Fanza (DMM doujin) work id is the content-id `'d_215444'`. The `d_` prefix distinguishes the source — there is no separate source column. **All** label ids (circle/tag/va/illustrator/script_writer/series/author) are name-based UUIDs (TEXT PK) resolved by `resolveLabel` in `queries.js`; DLsite RG/genre/SRI ids scraped from the storefront are no longer used as DB ids, and a label shared across DLsite + Fanza merges into one row.

**Tag canonicalization (rename protection):** tag names are canonicalized via `scraper/tag-aliases.json` before UUID resolution. `resolveTagLabel` in `queries.js` (the single choke point covering scan-insert, scan-update, and admin-edit) maps a scraped new Japanese tag name back to its canonical old name so a DLsite rename folds onto the existing `t_tag` row instead of splitting into two. The map is hand-maintained (`scraper/tag-aliases.json`, loaded once at require time — restart to apply); tags not in the map pass through unchanged. Other label tables (circle/illustrator/script_writer/series) are not canonicalized. The backend always serves canonical Japanese tag names; UI/tag translation is client-side (see `frontend/AGENTS.md` i18n).

**VA canonicalization (duplicate registration):** same mechanism for voice actors, via `scraper/va-aliases.json` and `resolveVaLabel` in `queries.js`. A VA who registered under several spellings (e.g. 乙倉ゅい / 乙倉ゅい（乙倉由依）/ 乙倉ゅい(乙倉由依) / 乙倉ゆい) otherwise gets one `t_va` row per spelling with their works split between them; the map redirects every variant to the canonical name on write. Rows that already exist in a deployed DB are folded by migration `20260814000000_merge_va_aliases.js`, which reads the same JSON — **adding a new alias entry after that migration has run needs a fresh migration** (or a re-scan of the affected works) to merge the existing rows.

### 2.4 Configuration (`config.js`)

- Config file: `config/config.json` (auto-created with defaults on first run)
- Runtime config is exported as a shared mutable object (`config`).
- `setConfig()` merges new values but **protects** these fields: `production`, `md5secret`, `jwtsecret` (cannot be changed at runtime).
- `updateConfig()` adds missing keys with defaults on version upgrades.
- `publicConfig` class exposes a subset to the frontend (e.g., `rewindSeekTime`, `forwardSeekTime`).
- `imageFolderDir` (default `images/`) holds scraped sample/description images, separate from `coverFolderDir`. It gets the same treatment as the cover path: relative values resolve against `dataRoot`, and `imageUseDefaultPath: true` forces `dataRoot/images`. Deployments that mount `covers/` as a volume should mount `images/` too.

**Data root and the four data folders.** All persistent state lives in `config/`, `sqlite/`, `covers/`, `images/`, each hanging off `dataRoot`. `dataRoot` is `KIKO_DATA_DIR || __dirname`. The **container image sets `KIKO_DATA_DIR=/data`** so one volume covers everything; the fallback (`__dirname`, the application directory) cannot take a single volume without shadowing `app.js`, `node_modules/` and `dist/`. `scripts/launchers/Kikoenai.bat` sets it to the archive root for the Windows portable build. `-e KIKO_DATA_DIR=/usr/src/kikoeru` restores the pre-`/data` container layout exactly. See `Containerfile` and `README.md`.

- The three configurable folders resolve through **`resolveDataFolder(dir, defaultName, useDefault)`** in `config.js`: `useDefault` wins, then a relative path (joined to `dataRoot`), then an absolute path.
- **`rerootFromAppDir` is the non-obvious part.** The admin panel saves folder paths as *absolute*, so a `config.json` written before `KIKO_DATA_DIR` was set holds e.g. `/usr/src/kikoeru/covers`. Without re-rooting, setting `KIKO_DATA_DIR` moves only the folders `config.json` does not mention (in practice just the newest key) and silently leaves the covers and database behind — a half-migrated state with no error. So an absolute path *inside the app directory* is re-rooted onto `dataRoot` and logged; a path outside it is a deliberate user choice (big disk, network share) and is left alone.
- **Never applied to `rootFolders` or `voiceWorkDefaultPath`.** Those are the user's media mounts, not app state; rewriting them would break a working library. The container keeps `VoiceWork` at `/usr/src/kikoeru/VoiceWork` regardless of `KIKO_DATA_DIR`.
- **The `Containerfile` declares no `VOLUME`, deliberately.** `VOLUME` only does anything when the operator mounts nothing at that path, and then it creates *anonymous* volumes — unnamed, easy to orphan, silently removed by `podman rm -v`, and impossible to undo in a derived image. Explicit mounts are unaffected either way.
- **Legacy-layout startup warning.** When `IS_DOCKER` is set, `dataRoot !== appDir`, the app directory holds a `sqlite/db.sqlite3` and the current data root does not, `config.js` prints a four-line `!!!` warning naming both paths and both remedies. It is **advisory only** — it changes no behaviour. It exists because the alternative failure mode is silent: an empty data root looks like a fresh install, and a rescan then rebuilds the library without ratings, reviews, progress or play history, none of which scanning can recover.
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

### 2.9 Work-Page Extras (description, images, author, reviews)

The DLsite scraper reads more than the `#work_outline` spec table. **None of this is exposed over `/api` or rendered by the frontend yet** — it is scaffolding for later features (LLM track-title/VA extraction, tag classification). Everything below is DLsite-only; `fanza.js` is unchanged and Fanza works get none of it.

**Scraped fields** (`scraper/dlsite.js`, returned on the metadata object):

| Field | Source | Notes |
|-------|--------|-------|
| `authors[]` | `作者` row of `#work_outline` | The creator credit on works with no VA/illustrator/scenario breakdown. Rarely set. `{id: nameToUUID(name), name}`, same shape as `vas`/`scriptWriters`. |
| `description` | `div[itemprop="description"]` | Plain text. `<br>` handling is a sentinel, not a bare `\n` — see `elementText`, DLsite writes `"<br />\n"` so a naive replace doubles every line break. |
| `descriptionParts[]` | same block, per `.work_parts` | `{type, heading, text, images[], tracks[]}`. `type` comes from the `type_*` class: `text`, `image`, `tracklist`. |
| `descriptionParts[].tracks[]` | `.work_parts.type_tracklist` | `{title, time}`. **Only ~16% of works use this structured part** (measured over 40 random library works: 16% structured, 43% track list written as prose inside a `type_text` part, 40% no track list). The prose case is still captured — as `text` under a heading like `☆トラックリスト&プレイ内容` — but `tracks[]` is empty for it, and the numbering varies wildly (`Track1`, `①`, bare `1`, `◆01`). Parsing that is the LLM's job, not the scraper's. |
| `descriptionParts[].type` | the `type_*` class | Seen in the wild: `text`, `image`, `multiimages`, `tracklist`, `list`. Unknown types still parse — the type is recorded and text/images extracted generically. |
| `sampleImages[]` | `.product-slider-data div[data-src]` | `{url, thumb, width, height}`. The slides are rendered client-side by Vue, so the visible `<img>` tags are **not** in the HTML — only these empty data divs are. The first slide (`_img_main`) is dropped; it is the cover. |

The JSON fallback (`scrapeStaticWorkMetadataFromDLsiteJson`) fills the same fields from `product.json`: `creaters.created_by`, `intro_s` (a plain-text summary DLsite has already truncated — no parts, no track list) and `image_samples`.

> The JSON scraper read `creaters.illust` / `creaters.scenario`; the API keys are `illust_by` / `scenario_by`, so that path silently dropped illustrators and script writers. Fixed alongside `created_by`.

**Reviews** — `scrapeWorkReviewsFromDLsite(id, {order, limit, maxPages})`. Reviews are rendered client-side and are absent from the work page HTML; the endpoint the Vue component calls is `GET /{site}/api/review?product_id=RJ…&order=regist_d&limit=…&page=…&locale=ja_JP`. It paginates until a short page, de-duplicating by `member_review_id` (a "pickup" review repeats across pages). Each review carries `genres` — genres **the reviewer** picked, independent of the seller-chosen work genres.

> A region-restricted work returns `{is_success: true, error_msg: ""}` with no `review_list` and serves a stripped work page (no description, no slider, no review section). That is indistinguishable from "no reviews" at the API level, so a scrape from a blocked IP silently yields empty extras rather than an error.

**Storage** — `db.getWorkExtras(id)`, `db.setWorkSampleImages(id, list)`, `db.replaceWorkDlsiteReviews(id, reviews)`, `db.getWorkDlsiteReviews(id)`. Reviews are **replaced**, not merged: DLsite lets reviewers edit and delete, and the rows carry no local state.

**Images on disk** — `config.imageFolderDir` (default `images/`, sibling of `covers/`, with the same relative-path and `imageUseDefaultPath` handling). Named by position, not by remote basename: `RJ<id>_img_smp<N>.<ext>` for slider images and `RJ<id>_img_part<N>.<ext>` for images embedded in description blocks — description images are served under opaque hash names that collide across works. `deleteWorkImagesFromDisk` matches that exact pattern rather than a bare prefix, so pointing `imageFolderDir` at the cover folder cannot delete covers.

**When it runs** (`filesystem/scannerModules.js`):

| Trigger | Description + author | Sample-image URLs | Image download | Reviews |
|---------|---------------------|-------------------|----------------|---------|
| New work during `PERFORM_SCAN` | ✅ | ✅ | ✅ | ✅ |
| `PERFORM_UPDATE` (= `updater.js --refreshAll`) — **whole library** | ✅ | ✅ | ❌ | ❌ |
| `POST /api/refresh/:id` — **one work** | ✅ | ✅ | ✅ | ✅ |
| `updater.js --images` | ✅ | ✅ | ✅ | ❌ |
| `updater.js --reviews` | ❌ | ❌ | ❌ | ✅ |

Downloads and review pagination cost extra requests per work, so they deliberately do **not** ride along with `refreshAll` — the UI's update button would otherwise turn into thousands of image fetches. `--refreshAll` still writes the image *list* (URLs, `file: null`); a later `--images` fills in the files.

> **Two different refresh paths, don't confuse them.** `PERFORM_UPDATE` (Scanner page button → `socket.js` → forks `updater.js --refreshAll`) iterates **every** row of `t_work` and skips the network-heavy extras. `POST /api/refresh/:id` (`WorkDetails.vue`) refreshes **one** user-initiated work and does everything, including image download and review scraping. It calls `db.updateWorkMetadata` directly and never touches `scannerModules`, so the `includeImages`/`includeReviews` option handling in `updateMetadata` does not apply to it — it calls `filesystem/workExtras.js` itself.

**`filesystem/workExtras.js`** holds `saveWorkImages(id, metadata, log)` and `saveWorkReviews(id, log)`, shared by the scanner child and the refresh route. It is deliberately **not** in `scannerModules.js`: requiring that from a route would pull in the child-process IPC plumbing (it reassigns `process.send`) and the scan concurrency limiter. The logger is injected — the scanner passes an adapter onto `LOG.task` so progress shows on the Scanner page, the route passes the console default. `downloadWorkImages` mkdirs `config.imageFolderDir` itself, since a library upgraded but never rescanned has no `images/` directory and the route can be the first writer.

Both are non-fatal in the route: `db.updateWorkMetadata` has already committed by the time they run, so a failed image fetch returns a partial success rather than a 500 implying nothing was saved. The response carries `{images, reviews}` counts.

---

## 3. Critical Conventions & Gotchas

- **SQLite:** No concurrent writes. Busy timeout configured. Foreign keys enabled via `PRAGMA foreign_keys = ON` in `db.js`.
- **Migrations:** Sequential, timestamp-prefixed files in `database/migrations/`. Run automatically on **every** startup via `knex-migrate.js` (`init.js`); umzug tracks executed migrations in the `knex_migrations` table, so only pending ones run (idempotent — no version bump required for a migration to be picked up). The app-version comparison in `init.js` gates only the version-keyed upgrade tasks (`applyFix`/`fixMigrations` in `upgrade.js`, `updateConfig`) — those must run **before** `up` because they can mark migrations as executed (`skipAll`). `dbVersion` in `schema.js` must always equal the latest migration's timestamp prefix (asserted by `test/migration..js`).
- **Config write protection:** `setConfig()` always overwrites `production`, `md5secret`, `jwtsecret` with current values — these cannot be changed through the admin panel. (`jwtsecret` is now unused: sessions are opaque random strings, not signed tokens. It is retained only so the config file shape does not change.)
- **Error handling:** auth failures are raised as an `Error` with `name = 'UnauthorizedError'` → 401 with `WWW-Authenticate` header. Missing DB tables → 500 with "数据库结构尚未建立". Production mode sanitizes error messages (no stack traces).
- **API cache policy:** `api.js` sets `Cache-Control: private, no-cache` on **every** `/api` response, before the auth middleware so 401s get it too. `private` is the load-bearing part: RFC 9111's protection for authenticated requests only covers the `Authorization` header, **not cookies**, and this app is now cookie-authenticated — so without it a shared cache (an nginx `proxy_cache` in front of the app) could store per-user responses like `/api/auth/me`, `/api/history`, and `/api/review` and serve one user's data to another, since nginx does not key on `Cookie` by default. `no-cache` rather than `no-store` so the browser may still store and revalidate, preserving Express's ETag 304s. Routes wanting real caching override it with `res.setHeader` inside the handler.
- **Cover cache headers (`routes/metadata.js`):** `/api/cover/:id` overrides the API default via `res.sendFile`'s `maxAge`, which emits `Cache-Control: public, max-age=2592000` (30 days). `public` is deliberate and fine here — covers are site-wide content with nothing user-specific in them, so a shared cache storing one leaks nothing. Per-user JSON is covered by the `private, no-cache` default above.
  - **The missing-cover fallback gets `COVER_FALLBACK_MAX_AGE` (5 min), not the long one.** A work scraped after its placeholder was cached would otherwise show `no-image.jpg` for 30 days. This is the rule that actually matters — don't collapse the two branches into one `maxAge`.
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
| `cookie-parser` + `cookie` | Session cookie parsing (Express and Socket.IO) |
| `socket.io` | Real-time events (scan progress) |
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

# Metadata refresh (filesystem/updater.js). Flags are mutually exclusive —
# the first one set wins.
node filesystem/updater.js --refreshAll     # dynamic + all static metadata (what PERFORM_UPDATE runs)
node filesystem/updater.js --author         # 作者 only
node filesystem/updater.js --description    # description + image list, no downloads
node filesystem/updater.js --images         # implies --description, then downloads the images
node filesystem/updater.js --reviews        # re-scrape every DLsite user review
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
| `/api/auth/me` | POST | Log in; sets the session cookie, returns `{ user, session }` |
| `/api/auth/logout` | POST | Destroy the server-side session and clear the cookie |
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
| `/api/refresh/:id` | POST | Re-scrape one work from DLsite/Fanza: metadata (`refreshAll`), then sample/description images and DLsite reviews. Returns `{message, metadata, images, reviews}` where `images`/`reviews` are counts. Image and review failures are non-fatal (metadata is already committed). |
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
3. Routes under `/api` are automatically protected by the session middleware in `api.js`. Note its skip list is matched against `req.path`, which is **relative to the `/api` mount** (`/auth/me`, not `/api/auth/me`).

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
