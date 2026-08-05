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
├── .github/workflows/build.yml   # CI: container image build
├── Containerfile           # OCI image (ghcr.io/rivers47/kikoenai)
└── compose-example.yaml
```

`worktree-*/` and `.pi-subagents/` are local git worktrees / agent artifacts — **not** source of truth; work under `backend/` and `frontend/` only.

---

## 2. Workspace Commands

Run from repo root. Node **>= 22.0.0**.

| Command | Purpose |
|---------|---------|
| `npm install` | Install all workspace deps |
| `npm run dev` | Backend (nodemon, :8888) + frontend (Quasar, :8080) concurrently |
| `npm run dev:backend` / `dev:frontend` | One side only |
| `npm run build` | Build frontend into `backend/dist/` |
| `npm start` | Production: backend serves `backend/dist/` |
| `npm run lint` | backend lint + frontend ESLint |
| `npm run release:patch` / `:minor` / `:major` | Bump backend version, sync across all three `package.json` via `version:sync` |

Per-package scripts still work inside each workspace (e.g. `npm run scan`, `npm test` in `backend/`).

---

## 3. Cross-Package Integration

- **Build pipeline:** Frontend builds directly into `backend/dist/` (`distDir` in `frontend/quasar.config.js`); Express serves it as static content. No separate frontend deploy.
- **Dev proxy:** `quasar dev` (:8080) proxies `/api` and `/socket.io` to the backend (:8888). In production `connect-history-api-fallback` lets Vue Router own all non-`/api` routes — no hash routing.
- **Shared contracts:** The REST API and Socket.IO event names are documented identically in `backend/AGENTS.md` §6 and `frontend/AGENTS.md` §6. **When changing an endpoint or event, update both sub-guides.** Scanning runs over Socket.IO (not REST); metadata editing is admin-gated via `PUT /api/work/:id`.

---

## 4. Agent Dispatch

| Task | Read first |
|------|-----------|
| Express route, DB migration, scraper, config schema | `backend/AGENTS.md` |
| Vue page/component, Vuex module, boot file, PWA, player UI, i18n/tag translation | `frontend/AGENTS.md` (§2.8 for i18n) |
| Root scripts, release flow, CI, container | This file + `README.md` |
| E2E browser tests | `tests/playwright.config.js` (needs frontend on :8080) |
| Fanza scraping source | `backend/AGENTS.md` §6 + `scraper/fanza.js` — work ids are `d_`-prefixed strings; DLsite ids stored RJ-padded (6/8 digit); all label ids are UUIDs |
| Tag rename canonicalization / tag identity | `backend/AGENTS.md` §2.3 (tag canonicalization) + `scraper/tag-aliases.json` + `scraper/tag-aliases.js` |

Changes touching both packages (e.g. a new API endpoint used by a new Vue page): read **both** sub-guides and keep their API-contract tables in sync.

---

## 5. Repo-Wide Notes

- **Product vs. package name:** Product is **Kikoenai**; the npm workspace name is still **`kikoeru`** (inherited from upstream). Versions stay in sync across all three `package.json` via `npm run release:*`.
- **Tests:** Unit/lint tests live inside each package (`backend/test/`, frontend `npm test` = ESLint). Cross-package e2e (Playwright) at `tests/` expects the dev server on :8080.
- **CI:** `.github/workflows/build.yml` builds the OCI image. Container sets `IS_DOCKER=1` with fixed default paths.
