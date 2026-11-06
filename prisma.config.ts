import path from "node:path";
import { defineConfig } from "prisma/config";

// Prisma CLI se v aplikaci používá jen pro `prisma generate` a pro kontrolu
// migrací v CI (`prisma migrate diff`). Migrace aplikuje scripts/migrate.mjs.
const dataDir = process.env.DATA_DIR ?? "./data";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: `file:${path.join(dataDir, "app.db")}` },
});
