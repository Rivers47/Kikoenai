# Kikoenai

> A self-hosted media server for ASMR works.

This is a fork of the original monorepo [Kikoeru](https://github.com/nortonandrews/kikoeru) project, which was forked to make a [Chinese frontend](https://github.com/yodhcn/kikoeru-quasar), which was then forked by [Kikoeru-project](https://github.com/kikoeru-project), which was yet again forked by [Number178](https://github.com/Number178).

Another heavily modified [closed source version](https://asmr.one) seems to exist.

So this repo is created to make the project monorepo again and to continue the development of the project.

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
