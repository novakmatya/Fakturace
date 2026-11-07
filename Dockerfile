# Fakturace – produkční image (Railway, ale i jakýkoli jiný Docker hosting).
# Data (SQLite databáze, PDF doklady, účtenky) leží na připojeném svazku v /data.

# 1) Závislosti – včetně nativního modulu better-sqlite3
FROM node:22-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# 2) Build – Prisma Client + Next.js (standalone výstup)
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run db:generate && npm run build

# 3) Běh – jen to, co server potřebuje
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATA_DIR=/data \
    TZ=Europe/Prague

COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/assets ./assets
COPY --from=build /app/prisma/migrations ./prisma/migrations
COPY --from=build /app/scripts/migrate.mjs /app/scripts/backup-core.mjs /app/scripts/restore-backup.mjs ./scripts/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Next.js si do .next zapisuje cache (např. statické trasy), proto ji vlastní
# uživatel node. node_modules, server.js a migrace zůstávají vlastnictvím roota.
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh \
  && chown -R node:node /app/.next \
  && mkdir -p /data \
  && chown node:node /data

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
