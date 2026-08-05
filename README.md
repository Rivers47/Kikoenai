# Kikoenai

> A self-hosted media server for ASMR works.

This is a fork of the original monorepo [Kikoeru](https://github.com/nortonandrews/kikoeru) project, which was forked to make a [Chinese frontend](https://github.com/yodhcn/kikoeru-quasar), which was then forked by [Kikoeru-project](https://github.com/kikoeru-project), which was yet again forked by [Number178](https://github.com/Number178).

Another heavily modified [closed source version](https://asmr.one) seems to exist.

So this repo is created to make the project monorepo again and to continue the development of the project.

## Project screenshot
![](./demo.png)

## Structure

```
kikoenai/
├── package.json            # Root workspace config
├── backend/                # Express API server (kikoeru-express)
│   ├── app.js              # Server entry point
│   ├── routes/             # API routes
│   ├── database/           # SQLite + Knex
│   ├── filesystem/         # Scanner & file utilities
│   ├── scraper/            # Metadata scrapers (DLSite, etc.)
│   └── dist/               # Frontend build output (auto-generated)
├── frontend/               # Vue 3 / Quasar PWA (kikoeru-quasar)
│   ├── quasar.config.js
│   ├── src/
│   │   ├── components/     # Vue components
│   │   ├── pages/          # Route pages
│   │   ├── store/          # Vuex state
│   │   ├── router/         # Vue Router
│   │   └── boot/           # App boot files
│   └── src-pwa/            # PWA service worker
└── scripts/
    ├── dev.sh              # Start both in dev mode
    └── build.sh            # Build frontend for production
```

## Quick Start


### Container

An OCI container image is built at ()[https://github.com/Rivers47/Kikoenai/pkgs/container/kikoenai]

Sample rootless quadlet config

```
[Unit]
Description=ASMR server

[Container]
Image=ghcr.io/rivers47/kikoenai:latest
ContainerName=kikoenai

Volume=/path/to/sqlite:/usr/src/kikoeru/sqlite
Volume=/path/to/covers:/usr/src/kikoeru/covers
Volume=/path/to/config:/usr/src/kikoeru/config

Mount=type=bind,src=/path/to/works,dst=/usr/src/kikoeru/VoiceWork,ro=true
AutoUpdate=registry
User=%U:%G
UserNS=keep-id

[Service]
Restart=always

[Install]
WantedBy=multi-user.target default.target
```

Alternatively, use the provided `compose-example.yaml` with with your container compose tool of choice.
Edit `/path/to/your/voiceworks` to your folder that contains the voice work files.

The server will be up on port `4545` on the host.

### Development

```bash
# Install all dependencies
npm install

# Start both backend and frontend in dev mode
npm run dev
# Or use: ./scripts/dev.sh
```

This starts:
- **Backend** at http://localhost:8888 (Express API with hot-reload via nodemon)
- **Frontend** at http://localhost:8080 (Quasar dev server with HMR, proxies `/api` to backend)

### Production Build

```bash
# Install dependencies
npm install

# Build frontend and prepare for production
npm run build

# Start the production server
npm start
```
### Individual Package Scripts

Each package retains its own scripts, accessible via npm workspaces:

```bash
npm run dev:backend    # Backend only (nodemon)
npm run dev:frontend   # Frontend only (quasar dev)
npm run build:frontend # Build frontend only
```

### Windows Portable Build

A self-contained Windows distribution that runs without installing Node or ffmpeg:
the `Kikoenai/` folder bundles Node 24 LTS, Windows-native `sqlite3`, and
`ffmpeg`/`ffprobe`. Unzip and double-click `Kikoenai.bat`.

**Building (on a Windows host):**

```bash
npm install
npm run package:windows   # -> package/dist/Kikoenai-windows-x64-<version>.zip
```

Or via CI: pushing a `v*` tag runs `.github/workflows/package-windows.yml` on
`windows-latest` and attaches the zip to a draft GitHub release. `workflow_dispatch`
builds it manually without tagging.

**First run:** Windows SmartScreen may warn because the build is unsigned — choose
*More info* → *Run anyway*. Point your voice-work library at a folder via the admin
panel (config → root folders); `VoiceWork/` next to the launcher is only a default
fallback.

**Where your data lives:** `config/`, `sqlite/`, `covers/`, and the `VoiceWork/`
fallback are created next to `Kikoenai.bat` (the archive root), matching the
legacy `pkg` build so migration is a folder copy.

#### Migrating from the KirieHaruna / legacy pkg build

The old fork shipped a single `kikoeru-express.exe` with `config/`, `sqlite/`,
and `covers/` as its siblings. This build replaces the exe with a launcher +
`node/` + `app/` + `ffmpeg/`, but keeps the four data folders at the same level.

1. Unzip the new `Kikoenai/` folder.
2. Copy your existing `config/`, `sqlite/`, and `covers/` (plus `VoiceWork/` if you
   used it) from the old `kikoeru-win-x64-<ver>/` next to `Kikoenai.bat`.
3. Start it. The app reads the same `config.json` (new keys are auto-filled on
   startup), the same SQLite DB (Knex migrations apply on boot), and the same
   `rootFolders` (absolute disk paths to your library — unaffected by the move).

**Cover-path gotcha (pre-existing, not a regression):** `coverUseDefaultPath`
defaults to `false`, so `coverFolderDir` follows the absolute path stored in
`config.json`, which after a move still points at the old install's `covers/`. If
covers don't appear, set `coverUseDefaultPath: true` (or re-point `coverFolderDir`
in the admin panel) and copy `covers/` into the new root. The DB needs no such fix
— `dbUseDefaultPath: true` always re-resolves `sqlite/` to the launcher root, so
it's portable.

> The legacy `pkg` single-executable packaging (`backend/package.json` `pkg`
> block and `build` script) has been removed; it was deprecated (Node 18 cap) and
> unused.

#### macOS

Deferred. The portable-folder approach ports cheaply (same `KIKO_DATA_DIR`
design + a `.command` launcher + darwin Node + macOS ffmpeg), but distributing an
unsigned Mac build forces recipients through a Terminal `xattr` workaround
(Gatekeeper). A decent distributed-Mac experience effectively requires the
$99/year Apple Developer ID + notarization — decide that before building Mac.

## Integration

The frontend builds directly into `backend/dist/`, which is served as static content by the Express server. This is configured via `distDir` in `frontend/quasar.config.js`.


## TODO
- [x] Migrate packages to their modern versions
- [x] Support multiple languages
- [x] Support other metadata websites
- [ ] Unify code language to English
- [x] Fix PWA issues
- [x] Refresh metadata for a single work
- [x] Optimize DB query speed
- [ ] Tests
- [x] Edit metadata
- [x] DB migration from number178's closed source version
- [ ] DB migration from Kikoeru-project's version
- [x] Container build
- [x] iOS support for opus
- [ ] Migrate frontend to shadcn
- [ ] metadata cache server to replace hvdb/asmrone
- [x] Smarter Play status, hide finished work in history

## License

GNU General Public License v3.0
