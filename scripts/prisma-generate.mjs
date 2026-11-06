#!/usr/bin/env node
// Vygeneruje Prisma Client (src/generated/prisma) bez stahování binárek.
// `prisma generate` schema-engine nepotřebuje, CLI se ho ale při startu snaží
// stáhnout z binaries.prisma.sh. Náhradní soubor tomu zabrání, takže generování
// funguje stejně lokálně, v CI i při buildu Docker image – i bez přístupu na síť.
// Migrace řeší scripts/migrate.mjs a kontrolu driftu scripts/schema-diff.mjs (WASM engine).

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {
  ...process.env,
  PRISMA_SCHEMA_ENGINE_BINARY:
    process.env.PRISMA_SCHEMA_ENGINE_BINARY ?? path.join(root, "scripts", "offline-schema-engine.sh"),
  PRISMA_HIDE_UPDATE_MESSAGE: "1",
};

const result = spawnSync(process.execPath, [path.join(root, "node_modules", "prisma", "build", "index.js"), "generate"], {
  cwd: root,
  env,
  stdio: "inherit",
});
process.exit(result.status ?? 1);
