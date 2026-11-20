# Kikoenai — Agent Guide (root)

**Kikoenai** is a self-hosted media streaming server for ASMR voice works. This is the top-level agent guide for the monorepo; it covers layout, workspace commands, and cross-package integration. For package-specific architecture, conventions, and gotchas, read the sub-guides:

- **Backend work → [`backend/AGENTS.md`](backend/AGENTS.md)** (Express API, SQLite/Knex, JWT, Socket.IO, scraping)
- **Frontend work → [`frontend/AGENTS.md`](frontend/AGENTS.md)** (Vue 3 / Quasar PWA, Vuex, Plyr, Socket.IO client)

User-facing install/deploy docs live in [`README.md`](README.md). License: GPL-3.0-or-later.

---

## 1. Layout

```
kikoenai/
├── package.json            # npm workspaces root (name: "kikoeru")
├── backend/                # Express API server  → see backend/AGENTS.md
├── frontend/               # Vue 3 / Quasar PWA  → see frontend/AGENTS.md
├── scripts/{dev,build}.sh
├── tests/                  # Root-level Playwright e2e (baseURL :8080, chromium)
├── .github/workflows/build.yml         # CI: production container image
├── .github/workflows/build-debug.yml   # Manual-only: `-debug` container image
├── Containerfile           # OCI image (ghcr.io/rivers47/kikoenai)
├── .containerignore        # Build-context excludes (buildah reads this, not .dockerignore)
└── compose-example.yaml
```

`worktree-*/` and `.pi-subagents/` are local git worktrees / agent artifacts — **not** source of truth; work under `backend/` and `frontend/` only.

---

## 2. Workspace Commands

Run from repo root. Node **>= 24.0.0**.

| Command | Purpose |
|---------|---------|
| `npm install` | Install all workspace deps |
| `npm run dev` | Backend (nodemon, :8888) + frontend (Quasar, :8080) concurrently |
| `npm run dev:backend` / `dev:frontend` | One side only |
| `npm run build` | Build frontend into `backend/dist/` |
| `npm start` | Production: backend serves `backend/dist/` |
| `npm run lint` | backend lint + frontend `test` (i18n guard, theme-colour guard, ESLint) |
| `npm run release:patch` / `:minor` / `:major` | Full release — see §5 |

Per-package scripts still work inside each workspace (e.g. `npm run scan`, `npm test` in `backend/`).

---

## 3. Cross-Package Integration

- **Build pipeline:** Frontend builds directly into `backend/dist/` (`distDir` in `frontend/quasar.config.js`); Express serves it as static content. No separate frontend deploy.
- **Dev proxy:** `quasar dev` (:8080) proxies `/api` and `/socket.io` to the backend (:8888). In production `connect-history-api-fallback` lets Vue Router own all non-`/api` routes — no hash routing.
- **Shared contracts:** The REST API and Socket.IO event names are documented identically in `backend/AGENTS.md` §6 and `frontend/AGENTS.md` §6. **When changing an endpoint or event, update both sub-guides.** Scanning runs over Socket.IO (not REST); metadata editing is admin-gated via `PUT /api/work/:id`.
- **Deploy path prefix (`config.basePath`):** the app can be served under a sub-path (`https://example.com/kikoeru/`) from a single build, so URLs are owned jointly by both packages. `backend/base-path.js` holds the contract — `frontend/quasar.config.js` requires `PUBLIC_PATH_TOKEN` straight from it, so there is one definition, not two. Read `backend/AGENTS.md` §2.4b **and** `frontend/AGENTS.md` §2.6b before touching asset paths, the service worker, Socket.IO mounting, or anything that builds a URL.

---

## 4. Agent Dispatch

| Task | Read first |
|------|-----------|
| Express route, DB migration, scraper, config schema | `backend/AGENTS.md` |
| Vue page/component, Vuex module, boot file, PWA, player UI, i18n/tag translation | `frontend/AGENTS.md` (§2.8 for i18n) |
| Root scripts, release flow, CI, container | This file + `README.md` |
| E2E browser tests | `tests/playwright.config.js` (needs frontend on :8080) |
| Fanza scraping source | `backend/AGENTS.md` §6 + `scraper/fanza.js` + `backend/work-id.js` — Fanza work ids are stored underscore-free (`d215444`) since migration `20260828000000`; `d_215444` is DMM's own form and survives only in DMM URLs, cover/image file names and folder names. DLsite ids stored RJ-padded (6/8 digit); all label ids are UUIDs |
| Serving under a sub-path, asset URLs, service-worker scope | `backend/AGENTS.md` §2.4b + `frontend/AGENTS.md` §2.6b + `backend/base-path.js` |
| Tag rename canonicalization / tag identity | `backend/AGENTS.md` §2.3 (tag canonicalization) + `scraper/tag-aliases.json` + `scraper/tag-aliases.js` |

Changes touching both packages (e.g. a new API endpoint used by a new Vue page): read **both** sub-guides and keep their API-contract tables in sync.

---

## 5. Repo-Wide Notes

- **Product vs. package name:** Product is **Kikoenai**; the npm workspace name is still **`kikoeru`** (inherited from upstream).
- **Releasing:** one command from a clean tree on `main` — `npm run release:patch` (or `:minor` / `:major`). It bumps the root `package.json`, then npm's `version` lifecycle runs `scripts/sync-version.js` (propagating the version to `backend/`, `frontend/` and `package-lock.json`) and stages those files; npm commits and tags `vX.Y.Z`, and `postversion` pushes with `--follow-tags`. The tag push triggers `build.yml` (semver-tagged container images) and `package-windows.yml` (Windows exe + **published** GitHub release with generated notes). Nothing manual after the one command. The `preversion` hook (`scripts/check-release-branch.js`) aborts the whole flow unless HEAD is on `main` and not detached — a tag cut on a feature branch would otherwise publish images and a release pinned to that commit.
- **Tests:** Unit/lint tests live inside each package (`backend/test/`, frontend `npm test` = ESLint). Cross-package e2e (Playwright) at `tests/` expects the dev server on :8080.
- **Container data layout:** persistent state is four folders — `config/`, `sqlite/`, `covers/`, `images/` — plus `logs/` (one file per scan run, disposable), `transcodes/` (the Opus cache) and `lyrics/` (generated subtitles the library folder would not take) — hanging off `dataRoot` (`KIKO_DATA_DIR || __dirname`). The **container image sets `KIKO_DATA_DIR=/data`**, so one volume holds everything. Without it `dataRoot` is the application directory, which cannot take a single volume without shadowing `app.js`, `node_modules/` and `dist/` — that was the old four-mount layout. The library stays a separate bind mount at `/usr/src/kikoeru/VoiceWork`; it is user media, not app state, and does not follow `KIKO_DATA_DIR`.
- **This was a breaking change for existing container deployments** (data root moved from `/usr/src/kikoeru` to `/appdata`). The exact escape hatch is `-e KIKO_DATA_DIR=/usr/src/kikoeru`, which reproduces the previous behaviour byte-for-byte with no data movement — verified. `config.js` prints a three-line `!!!` warning at startup when `IS_DOCKER` is set, the app directory holds a `sqlite/db.sqlite3`, and the current data root does not; it is advisory only and changes no behaviour. Mention this in release notes and bump the minor version. See `README.md` → *Upgrading from the four-volume layout*, and `backend/AGENTS.md` §2.4 for the `rerootFromAppDir` rule that keeps a pre-existing `config.json` from silently leaving the covers and database behind.
- **`backend/dist/` now depends on the server that serves it.** The frontend build bakes a placeholder (`/__KIKO_BASE__/`) into `index.html`, `sw.js` and `manifest.json` instead of a real URL prefix, and `app.js` swaps it for `config.basePath` on the way out. Express has always been the only thing serving `dist/`, so nothing in the documented setup changes — but a plain static file server pointed at `dist/` would now serve broken markup. `config.basePath` defaults to `''`, which reproduces the previous root-served URLs exactly.
- **The runtime stage is Google's distroless Node.js image** (`gcr.io/distroless/nodejs24-debian13`), not Alpine: no shell, no package manager, and it runs as root. What that costs a change: (1) the image is **glibc**, so the `node:24-trixie-slim` build stage must stay Debian-based — a musl build stage produces a `sqlite3` addon that will not load; (2) anything the app `execFile`s by name has to be staged into the image first — there is no `apk`/`apt` at runtime. `ffmpeg`/`ffprobe` are **built from source** in the `ffmpeg` stage (pinned `ARG` version + sha256 for ffmpeg/opus/zlib) with their codecs linked in, so the runtime carries two self-contained binaries that need nothing from the base but its glibc; `tini` is copied from that stage too. Adding a binary means extending that stage, not the final one; (3) `tini` must stay PID 1 in the entrypoint — a bare `node` as PID 1 ignores `SIGTERM` and only dies on the runtime's `SIGKILL`. There is no shell in the image, so debugging needs the `:debug` tag of the same distroless image swapped in for the final stage.
- **The ffmpeg codec set lives in the `ffmpeg` stage's configure flags and nothing verifies it at build time.** `--disable-everything` plus all native decoders/demuxers/parsers, the `libopus` and `mjpeg` encoders, `scale`/`crop`/`aresample` filters, `--disable-network`. A codec dropped from that list therefore breaks one user's file, not the build, so after editing it probe a real work (duration, transcode, covers). The parsers matter as much as the decoders: without them `ffprobe` reports `N/A` for raw ADTS `.aac`, which the app turns into `NaN`. Bumping ffmpeg/opus/zlib means changing the version and its sha256 `ARG` together.
- **Windows portable builds are unaffected** by any of this: `scripts/launchers/Kikoenai.bat` sets `KIKO_DATA_DIR=%ROOT%` itself, so its data has always lived in one folder next to the launcher.
- **The `Containerfile` declares no `VOLUME`, deliberately.** It only takes effect when the operator mounts nothing at that path, and then produces *anonymous* volumes — with `KIKO_DATA_DIR` set those would be four guaranteed-unused ones. Explicit mounts are unaffected, so its removal changed nothing for any documented setup.
- **`.containerignore`, not `.dockerignore`:** the image is built by `redhat-actions/buildah-build`, which prefers that filename; there is no Docker/BuildKit in the pipeline. It keeps a developer's `backend/config/` (holds `md5secret`/`jwtsecret`), `backend/sqlite/`, `backend/covers/`, `backend/images/` and `backend/VoiceWork/` out of locally built images, and keeps host-compiled `node_modules` from overlaying the Debian/glibc-built native modules (`COPY --from=build /app/ ./` is the last copy in the final stage, so it wins). **`backend/dist/` is gitignored but must not be excluded** — CI builds the frontend into it immediately before the image build. The list is a **blacklist, so any new local data root under `backend/` must be added to it**: the sub-folder names of a data root (`VoiceWork/`, `config/`, `sqlite/`, `covers/`, `images/`, `logs/`, `transcodes/`, `lyrics/`) are matched at any depth for that reason, and `backend/test_data_root` is listed explicitly. A data folder that slips through is only visible as a multi-gigabyte `podman images` size — CI never sees it, because those folders are gitignored — which is why the build stage stages `backend/` in `/app` and fails above 200 MB.
- **CI:** `.github/workflows/build.yml` builds the production OCI image on every push. `build-debug.yml` builds the `-debug` variant (unminified bundle + source maps) and is **`workflow_dispatch` only** — run it from the Actions tab on the branch/tag you want to debug. Both set `flavor: latest=false` on `docker/metadata-action`; without it the default `latest=auto` emits an extra unsuffixed `latest` on semver tag pushes, which is how the debug image once ended up published as `latest`. Container sets `IS_DOCKER=1` with fixed default paths.


## 6. Code Style

Always write comments in English.