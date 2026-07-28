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
RUN npm ci -w backend --omit=dev && npm cache clean --force

# Final stage
FROM node:24-alpine

ENV IS_DOCKER=true
WORKDIR /usr/src/kikoeru

# Install runtime dependencies: tini for signal handling, ffmpeg for audio processing
RUN apk add --no-cache tini ffmpeg

# Copy production dependencies from build stage
COPY --from=build /usr/src/kikoeru/node_modules ./node_modules

# Copy backend source (including frontend build artifacts from backend/dist/)
COPY ./backend/ ./

EXPOSE 8888

VOLUME [ "/usr/src/kikoeru/sqlite", "/usr/src/kikoeru/config", "/usr/src/kikoeru/covers" ]

ENTRYPOINT ["/sbin/tini", "--"]
CMD [ "node", "app.js" ]