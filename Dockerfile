# Signal, headless. The Electron window is the daily driver; this image runs
# the same engine without one — ingestion, scoring, the job queue — for Cloud
# Run or any box you would rather leave switched on.
#
#   docker build -t signal .
#   docker run -v signal-data:/data --env-file .env signal
#
# The SQLite file lives on a mounted volume. Losing it loses your queue and
# your attribution history, so mount something real.

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# better-sqlite3 falls back to compiling from source when no prebuilt binary
# matches, so the toolchain has to be here.
FROM base AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
COPY scripts ./scripts
# Only the Node ABI matters in a container. There is no Electron here.
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild better-sqlite3 \
  && node scripts/rebuild-native.mjs node

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV SIGNAL_DATABASE_URL=file:/data/signal.db

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/native ./native
COPY package.json signal.config.ts tsconfig.json ./
COPY src ./src

# Run as a non-root user, and make sure it owns the volume mount point.
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]

# The worker applies migrations at boot, then holds the cron loop open.
CMD ["pnpm", "signal", "worker"]
