import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runMigrations } from "../../scripts/migrate.mjs";

// Každý testovací soubor dostane vlastní čistou databázi v dočasném adresáři.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "fakturace-test-"));
fs.mkdirSync(path.join(dataDir, "files"), { recursive: true });

process.env.DATA_DIR = dataDir;
process.env.APP_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-0123456789-test-secret-0123456789";
process.env.SETUP_TOKEN = "test-setup-token-0123456789";

runMigrations({
  dbPath: path.join(dataDir, "app.db"),
  migrationsDir: path.resolve(__dirname, "../../prisma/migrations"),
});
