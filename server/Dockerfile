# Chromium is only needed for KFin's issue dropdown (refreshed twice an hour) and the
# selector-driven registrar profiles. Everything else — including every per-PAN KFin and
# Bigshare lookup — is plain HTTP.
FROM node:22-bookworm-slim AS base

ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    # Installed explicitly in the build step below, so skip the postinstall download.
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

WORKDIR /app

# --- dependencies -----------------------------------------------------------------------
# better-sqlite3 and sharp ship prebuilt binaries for linux/arm64 and linux/amd64, but the
# toolchain has to be present in case a build falls through to compiling from source.
FROM base AS deps

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts \
    && npm rebuild better-sqlite3 sharp

# --- chromium ---------------------------------------------------------------------------
FROM deps AS browser
RUN npx --yes playwright@1.49.1 install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/*

# --- build ------------------------------------------------------------------------------
FROM base AS build

RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY server/package.json server/package-lock.json* ./
RUN npm install --ignore-scripts
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npx tsc -p tsconfig.json

# --- runtime ----------------------------------------------------------------------------
FROM browser AS runtime

COPY --from=build /app/dist ./dist
COPY server/package.json ./

# The volume is mounted here; everything that must survive a redeploy lives under it.
ENV DATA_DIR=/data \
    PORT=4000

EXPOSE 4000

# Fly sends SIGINT on shutdown, which the server already handles to close the browser and
# the database cleanly. `node` as PID 1 receives it directly.
CMD ["node", "dist/index.js"]
