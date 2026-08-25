# Backend Dockerfile
# Build stage: install production dependencies
FROM node:24-alpine AS build

WORKDIR /usr/src/kikoeru

# Install build dependencies required by some native npm modules
RUN apk add --no-cache python3 make gcc g++

# Copy root package files and backend workspace package.json
COPY package*.json ./
COPY backend/package*.json ./backend/

# Install only backend production dependencies using the workspace-aware root lock
# node-gyp/tar and sqlite3's bundled C source are only needed to compile the
# native addon; the compiled .node binary works fine without them afterwards.
RUN npm ci -w backend --omit=dev && npm cache clean --force \
    && rm -rf node_modules/node-gyp node_modules/tar \
    && rm -rf backend/node_modules/sqlite3/deps backend/node_modules/sqlite3/src backend/node_modules/sqlite3/binding.gyp

# Final stage
FROM node:24-alpine

# NODE_ENV=production forces auth on (see backend/config.js) and cannot be
# overridden via the admin config -- required so the shipped image is never
# accidentally exposed with every /api request treated as admin.
# KIKO_DATA_DIR contains all four persistent data folders (config/sqlite/covers/
# images)
ENV IS_DOCKER=true \
    NODE_ENV=production \
    KIKO_DATA_DIR=/appdata
WORKDIR /usr/src/kikoeru

# Install runtime dependencies: tini for signal handling, ffmpeg for audio processing
RUN apk add --no-cache tini ffmpeg

# Copy production dependencies from build stage
# Backend workspace node_modules first (non-hoisted packages: jsonwebtoken, knex, sqlite3, jimp, etc.)
COPY --from=build /usr/src/kikoeru/backend/node_modules ./node_modules
# Then root node_modules on top (hoisted packages: mime@1.6.0 for express/send, etc.)
# Root wins on the 3 overlapping packages (@jimp, mime, ms) — correct since
# express/send needs mime@1.6.0, not mime@3.0.0 from jimp's dependency tree
COPY --from=build /usr/src/kikoeru/node_modules ./node_modules

# Copy backend source (including frontend build artifacts from backend/dist/)
COPY ./backend/ ./

EXPOSE 8888

ENTRYPOINT ["/sbin/tini", "--"]
CMD [ "node", "app.js" ]