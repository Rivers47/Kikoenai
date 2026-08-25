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

An OCI container image is built at [here](https://github.com/Rivers47/Kikoenai/pkgs/container/kikoenai)

All persistent data — `config/`, `sqlite/`, `covers/`, `images/` — lives under
`/appdata`, so one volume holds everything:

```
podman run \
  -v kikoenai-appdata:/appdata \
  -v /path/to/your/voiceworks:/usr/src/kikoeru/VoiceWork \
  -p 4545:8888 \
  ghcr.io/rivers47/kikoenai:latest
```

Sample rootless quadlet config

```
[Unit]
Description=ASMR server

[Container]
Image=ghcr.io/rivers47/kikoenai:latest
ContainerName=kikoenai

Volume=/path/to/appdata:/appdata

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

The voice-work library stays a separate bind mount: it is your own media, not
application state, so it does not belong in the data volume.

#### Upgrading from the four-volume layout

> **This is a breaking change for existing container deployments.** Read this before
> pulling a newer image.

Earlier images kept the four data folders inside the application directory, so each
needed its own mount:

```
Volume=/path/to/config:/usr/src/kikoeru/config
Volume=/path/to/sqlite:/usr/src/kikoeru/sqlite
Volume=/path/to/covers:/usr/src/kikoeru/covers
Volume=/path/to/images:/usr/src/kikoeru/images
```

The data root is now `/appdata` by default, so those mounts are no longer where the server
looks. Pick one of two options.

**Keep the old layout.** Set the data root back to the application directory. This
reproduces the previous behaviour exactly — nothing moves, and your existing mounts keep
working:

```
Environment=KIKO_DATA_DIR=/usr/src/kikoeru
```

**Or consolidate into one volume.** Copy the contents of your four volumes into
`config/`, `sqlite/`, `covers/` and `images/` inside the new one, then start with only
`-v kikoenai-appdata:/appdata`. Folder paths that `config.json` recorded inside the
application directory are re-rooted automatically on startup (you will see
`数据目录已迁移: …` in the log); a path you chose yourself outside it — a big disk, a
network share — is left untouched.

If you do neither, the server starts against an empty `/appdata` and logs a `!!!` warning
naming both paths. Nothing is deleted, but **do not let a scan run in that state**: a
rescan rebuilds the library without your ratings, reviews, progress or play history,
and those cannot be recovered by scanning again.

Windows portable builds are unaffected — `Kikoenai.bat` already points the data root at
the folder holding the launcher, and always has.

The server will be up on port `4545` on the host.

#### Firefox LNA issue
If you use a local DNS with a public looking hostname that points at a LAN IP,
firefox has a bug that causes some LNA issue. The frontend will silently retry
to fix it. Or you can add the domain to `network.lna.skip-domains` in `about:config`

### First Login

On first run, a default administrator account is created: username `admin`,
password `admin`. 

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

**Where your data lives:** `config/`, `sqlite/`, `covers/`, `images/`, and the `VoiceWork/`
fallback are created next to `Kikoenai.bat` (the archive root), matching the
legacy `pkg` build so migration is a folder copy.

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
- [ ] Add user defined work
- [x] DB migration from number178's closed source version
- [ ] DB migration from Kikoeru-project's version
- [x] Container build
- [x] iOS support for opus
- [ ] Migrate frontend to shadcn
- [ ] metadata cache server to replace hvdb/asmrone
- [x] Smarter Play status, hide finished work in history
- [ ] Advanced search

## License

GNU General Public License v3.0
