import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { runMigrations } from "../../scripts/migrate.mjs";

function workspace(migrations: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fakturace-migr-"));
  const migrationsDir = path.join(dir, "migrations");
  for (const [name, sql] of Object.entries(migrations)) {
    fs.mkdirSync(path.join(migrationsDir, name), { recursive: true });
    fs.writeFileSync(path.join(migrationsDir, name, "migration.sql"), sql);
  }
  return { dbPath: path.join(dir, "app.db"), migrationsDir };
}

function tables(dbPath: string): string[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .all()
      .map((r) => (r as { name: string }).name);
  } finally {
    db.close();
  }
}

describe("runner migrací", () => {
  it("je idempotentní a eviduje migrace ve formátu Prismy", () => {
    const ws = workspace({ "001_a": `CREATE TABLE "A" ("id" INTEGER PRIMARY KEY);` });
    expect(runMigrations(ws).applied).toEqual(["001_a"]);
    expect(runMigrations(ws).applied).toEqual([]);
    expect(tables(ws.dbPath)).toEqual(["A", "_prisma_migrations"]);
  });

  it("odmítne změněnou už aplikovanou migraci", () => {
    const ws = workspace({ "001_a": `CREATE TABLE "A" ("id" INTEGER PRIMARY KEY);` });
    runMigrations(ws);
    fs.appendFileSync(path.join(ws.migrationsDir, "001_a", "migration.sql"), "\n-- změna");
    expect(() => runMigrations(ws)).toThrow(/nesouhlasí kontrolní součet/);
  });

  it("přestavbu tabulky s vypnutými cizími klíči provede celou, nebo vůbec", () => {
    const ws = workspace({
      "001_base": `CREATE TABLE "A" ("id" INTEGER PRIMARY KEY, "x" TEXT);
INSERT INTO "A" ("id", "x") VALUES (1, 'puvodni');`,
      "002_rebuild": `PRAGMA foreign_keys=OFF;
CREATE TABLE "new_A" ("id" INTEGER PRIMARY KEY, "x" TEXT, "y" TEXT NOT NULL DEFAULT 'n');
INSERT INTO "new_A" ("id", "x") SELECT "id", "x" FROM "A";
DROP TABLE "A";
ALTER TABLE "new_A" RENAME TO "A";
THIS IS NOT SQL;
PRAGMA foreign_keys=ON;`,
    });
    expect(() => runMigrations(ws)).toThrow();
    // první migrace zůstala, druhá se vrátila celá
    expect(tables(ws.dbPath)).toEqual(["A", "_prisma_migrations"]);
    const db = new Database(ws.dbPath, { readonly: true });
    try {
      const columns = db.prepare(`PRAGMA table_info("A")`).all().map((c) => (c as { name: string }).name);
      expect(columns).toEqual(["id", "x"]);
      const applied = db.prepare(`SELECT migration_name FROM _prisma_migrations`).all();
      expect(applied).toEqual([{ migration_name: "001_base" }]);
    } finally {
      db.close();
    }
  });

  it("přestavbu, která by porušila cizí klíče, nepotvrdí", () => {
    const ws = workspace({
      "001_base": `CREATE TABLE "P" ("id" INTEGER PRIMARY KEY);
CREATE TABLE "C" ("id" INTEGER PRIMARY KEY, "pId" INTEGER NOT NULL REFERENCES "P" ("id"));
INSERT INTO "P" ("id") VALUES (1);
INSERT INTO "C" ("id", "pId") VALUES (1, 1);`,
      "002_bad": `PRAGMA foreign_keys=OFF;
DELETE FROM "P";
PRAGMA foreign_keys=ON;`,
    });
    expect(() => runMigrations(ws)).toThrow(/porušuje cizí klíče/);
    const db = new Database(ws.dbPath, { readonly: true });
    try {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM "P"`).get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });
});
