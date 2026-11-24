# Backend container image.
# The runtime is Google's distroless Node.js image -- no shell, no package
# manager -- so ffmpeg, ffprobe and tini are built or collected in earlier stages.

# Build stage: install production dependencies.
# Debian/glibc: the native sqlite3 addon must be compiled against the same libc
# the distroless runtime loads it with.
FROM node:24-trixie-slim AS build

WORKDIR /usr/src/kikoeru

# Toolchain node-gyp needs when sqlite3 has no prebuilt binary for this platform
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy root package files and backend workspace package.json
COPY package*.json ./
COPY backend/package*.json ./backend/

# Install only backend production dependencies using the workspace-aware root lock
# node-gyp/tar and sqlite3's bundled C source are only needed to compile the
# native addon; the compiled .node binary works fine without them afterwards.
RUN npm ci -w backend --omit=dev && npm cache clean --force \
    && rm -rf node_modules/node-gyp node_modules/tar \
    && rm -rf backend/node_modules/sqlite3/deps backend/node_modules/sqlite3/src backend/node_modules/sqlite3/binding.gyp

# The backend tree is staged here rather than copied straight into the final
# stage so its size can be measured: a data root that .containerignore missed
# (a 5.4 GB test library did) otherwise only shows up as a huge image.
COPY ./backend/ /app/
RUN set -eux; \
    size=$(du -sm /app | cut -f1); \
    test "$size" -lt 200 || { \
        echo "backend/ is ${size} MB -- a data folder leaked past .containerignore" >&2; \
        exit 1; \
    }

# ffmpeg
# Bumping a component means updating its version and hash together;
FROM debian:trixie-slim AS ffmpeg

ARG OPUS_VERSION=1.6.1
ARG OPUS_SHA256=6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1
ARG ZLIB_VERSION=1.4
ARG ZLIB_SHA256=02dd159783677a749c04adbdd02b55b8a2bcc7e054f51b76b549199a916ad584

# tini is installed here only to be copied into the runtime image
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential bzip2 ca-certificates curl nasm pkg-config tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

ENV PKG_CONFIG_PATH=/opt/lib/pkgconfig

RUN set -eux; \
    curl -fsSLo ffmpeg.tar.bz2 https://ffmpeg.org/releases/ffmpeg-snapshot.tar.bz2; \
    curl -fsSLo opus.tar.gz "https://downloads.xiph.org/releases/opus/opus-${OPUS_VERSION}.tar.gz"; \
    curl -fsSLo zlib.tar.gz "https://github.com/madler/zlib/releases/download/v${ZLIB_VERSION}/zlib-${ZLIB_VERSION}.tar.gz"; \
    echo "${OPUS_SHA256}  opus.tar.gz" > sums.txt; \
    echo "${ZLIB_SHA256}  zlib.tar.gz" >> sums.txt; \
    sha256sum -c sums.txt; \
    mkdir ffmpeg opus zlib; \
    tar -xjf ffmpeg.tar.bz2 -C ffmpeg --strip-components=1; \
    tar -xzf opus.tar.gz -C opus --strip-components=1; \
    tar -xzf zlib.tar.gz -C zlib --strip-components=1

# zlib and opus first: `--enable-static` on ffmpeg's own libs pulls both in
RUN set -eux; \
    cd /src/zlib; \
    ./configure --prefix=/opt --static; \
    make -j"$(nproc)"; \
    make install; \
    cd /src/opus; \
    ./configure --prefix=/opt --disable-shared --enable-static --disable-doc --disable-extra-programs; \
    make -j"$(nproc)"; \
    make install

RUN set -eux; \
    cd /src/ffmpeg; \
    decoders=$(./configure --list-decoders | tr -s ' \n' '\n' \
        | grep -vE '^(lib|vulkan)' \
        | grep -vE '_(at|mediacodec|v4l2m2m|cuvid|qsv|rkmpp|omx|videotoolbox)$' \
        | paste -sd,); \
    demuxers=$(./configure --list-demuxers | tr -s ' \n' '\n' | grep -vE '^lib' | paste -sd,); \
    parsers=$(./configure --list-parsers | tr -s ' \n' '\n' | grep -vE '^lib' | paste -sd,); \
    ./configure \
        --prefix=/opt \
        --pkg-config-flags=--static \
        --extra-cflags=-I/opt/include \
        --extra-ldflags=-L/opt/lib \
        --disable-shared --enable-static \
        --disable-doc --disable-debug --disable-autodetect \
        --disable-everything --disable-network \
        --disable-hwaccels --disable-cuda --disable-nvdec \
        --disable-vaapi --disable-vdpau --disable-vulkan \
        --enable-zlib --enable-libopus --enable-protocol=file \
        --enable-encoder=libopus,mjpeg \
        --enable-muxer=null,opus,ogg,image2,mjpeg \
        --enable-filter=aresample,aformat,format,anull,null,scale,crop,atrim,asetpts,volume,concat,abuffer,abuffersink,buffer,buffersink,trim \
        --enable-decoder="$decoders" \
        --enable-demuxer="$demuxers" \
        --enable-parser="$parsers"; \
    make -j"$(nproc)"; \
    make install

FROM gcr.io/distroless/nodejs24-debian13:latest

# NODE_ENV=production forces auth on (see backend/config.js) and cannot be
# overridden via the admin config -- required so the shipped image is never
# accidentally exposed with every /api request treated as admin.
# KIKO_DATA_DIR contains all four persistent data folders (config/sqlite/covers/
# images)
ENV IS_DOCKER=true \
    NODE_ENV=production \
    KIKO_DATA_DIR=/appdata
WORKDIR /usr/src/kikoeru

COPY --from=ffmpeg /opt/bin/ffmpeg /opt/bin/ffprobe /usr/bin/
COPY --from=ffmpeg /usr/bin/tini-static /usr/bin/tini

# Copy production dependencies from build stage
COPY --from=build /usr/src/kikoeru/backend/node_modules ./node_modules
COPY --from=build /usr/src/kikoeru/node_modules ./node_modules

COPY --from=build /app/ ./

EXPOSE 8888

ENTRYPOINT ["/usr/bin/tini", "--", "/nodejs/bin/node"]
CMD ["app.js"]