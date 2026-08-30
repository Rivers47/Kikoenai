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

### Windows
Download the zip from the release page.  Double click `Kikoenai.bat`. Put your works in `VoiceWork\`.
When upgrading, copy the exe to the old folder.

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

The server will be up on port `4545` on the host.


### Library Organization

The server scans for folder names containing `RJxxxxxxx` for DLsite works; 
or `d_xxxxxx` or `dxxxxxx` for Fanza(DMM) works.
You can configure the search depth in settings.

#### Firefox LNA issue
Due to a bug in Firefox. If you use a local DNS with a public looking hostname
that points at a LAN IP, axio could occur. The frontend will silently retry to
fix it. Or you can add the domain to `network.lna.skip-domains` in `about:config`

### Serving under a sub-path

By default Kikoenai expects to own the root of whatever hostname it is reached
on — `https://example.com/` or `https://kikoenai.example.com/`. Set `basePath`
in `config/config.json` to put it under a path instead, so it can share a
hostname with the other services on the same box:

```json
{
  "basePath": "/kikoeru"
}
```

The app is then at `https://example.com/kikoeru/`, and so are its API, its
Socket.IO endpoint and its session cookie. Leave `basePath` empty (the default)
to keep serving from the root; nothing about an existing install changes.

Multi-segment prefixes (`/apps/kikoeru`) work too. Leading and trailing slashes
are optional — `kikoeru`, `/kikoeru` and `/kikoeru/` all mean the same thing.

**Your reverse proxy must pass the prefix through, not strip it.** Kikoenai
generates absolute URLs for its own assets, so it has to see the same paths the
browser does. Both of these are correct:

```nginx
# nginx — note the upstream has no trailing slash, which is what stops
# nginx from rewriting /kikoeru/api/... down to /api/...
location /kikoeru/ {
    proxy_pass http://127.0.0.1:8888;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    # WebSocket upgrade for Socket.IO (the scanner's progress log)
    proxy_set_header Upgrade    $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

```caddyfile
# Caddy — handle_path would strip the prefix, so use handle
example.com {
    handle /kikoeru/* {
        reverse_proxy 127.0.0.1:8888
    }
}
```

Two things are deliberately *not* prefixed for you:

- `offloadStreamPath` / `offloadDownloadPath`, when `offloadMedia` is on. Those
  name virtual directories inside your reverse proxy rather than routes in this
  app, so write the prefix into them yourself if that is where you mounted the
  library.
- `allowedHosts` is a list of hostnames and has nothing to do with paths.

If you move an existing install from the root to a sub-path, browsers that
already installed the PWA will keep a service worker registered at the old
scope. Unregister it from the browser's devtools, or just reinstall the app
from the new URL.

### First Login

On first run, a default administrator account is created: username `admin`,
password `admin`. 

## Development

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
- [ ] Add user defined work
- [x] DB migration from number178's closed source version
- [ ] DB migration from Kikoeru-project's version
- [x] Container build
- [x] iOS support for opus
- [ ] Migrate frontend to shadcn
- [ ] metadata cache server to replace hvdb/asmrone
- [x] Smarter Play status, hide finished work in history
- [x] Advanced search

## License

GNU General Public License v3.0
