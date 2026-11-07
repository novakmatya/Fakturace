#!/usr/bin/env node
// Aplikuje SQL migrace z prisma/migrations na databázi v DATA_DIR/app.db.
// Záznamy ukládá do tabulky _prisma_migrations ve formátu Prismy, takže
// `prisma migrate status/deploy` je s tímto během kompatibilní.
// Spouští se při každém startu kontejneru (idempotentní) a v testech.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";

const MIGRATIONS_TABLE = `
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER UNSIGNED NOT NULL DEFAULT 0
);`;

/**
 * @param {{ dbPath: string, migrationsDir: string, log?: (msg: string) => void }} options
 * @returns {{ applied: string[] }}
 */
export function runMigrations({ dbPath, migrationsDir, log = () => {} }) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    db.exec(MIGRATIONS_TABLE);

    const names = fs
      .readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

    const appliedRows = new Map(
      db
        .prepare(
          `SELECT "migration_name", "checksum" FROM "_prisma_migrations"
            WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`,
        )
        .all()
        .map((r) => [r.migration_name, r.checksum]),
    );

    const applied = [];
    for (const name of names) {
      const file = path.join(migrationsDir, name, "migration.sql");
      if (!fs.existsSync(file)) continue;
      const content = fs.readFileSync(file);
      const checksum = crypto.createHash("sha256").update(content).digest("hex");

      if (appliedRows.has(name)) {
        if (appliedRows.get(name) !== checksum) {
          throw new Error(
            `Migrace ${name} byla po aplikaci změněna (nesouhlasí kontrolní součet). ` +
              `Aplikované migrace se nesmí upravovat – vytvořte novou.`,
          );
        }
        continue;
      }

      const sql = content.toString("utf8");
      const startedAt = Date.now();
      const apply = () => {
        db.exec(sql);
        db.prepare(
          `INSERT INTO "_prisma_migrations"
             ("id", "checksum", "finished_at", "migration_name", "logs", "rolled_back_at", "started_at", "applied_steps_count")
           VALUES (?, ?, ?, ?, NULL, NULL, ?, 1)`,
        ).run(crypto.randomUUID(), checksum, Date.now(), name, startedAt);
      };

      // Migrace, které přestavují tabulky, vypínají cizí klíče. PRAGMA uvnitř
      // transakce nefunguje, proto se vypnou před ní, migrace proběhne celá
      // v transakci (buď celá, nebo vůbec) a před potvrzením se ověří integrita.
      if (/PRAGMA\s+foreign_keys\s*=\s*OFF/i.test(sql)) {
        db.pragma("foreign_keys = OFF");
        try {
          db.transaction(() => {
            apply();
            const violations = db.pragma("foreign_key_check");
            if (violations.length > 0) {
              throw new Error(`Migrace ${name} porušuje cizí klíče: ${JSON.stringify(violations.slice(0, 5))}`);
            }
          })();
        } finally {
          db.pragma("foreign_keys = ON");
        }
      } else {
        db.transaction(apply)();
      }
      applied.push(name);
      log(`✔ migrace ${name}`);
    }
    return { applied };
  } finally {
    db.close();
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, "data"));
  fs.mkdirSync(path.join(dataDir, "files"), { recursive: true });
  const { applied } = runMigrations({
    dbPath: path.join(dataDir, "app.db"),
    migrationsDir: path.join(root, "prisma", "migrations"),
    log: (m) => console.log(m),
  });
  console.log(applied.length ? `Hotovo, aplikováno ${applied.length} migrací.` : "Databáze je aktuální.");
}
