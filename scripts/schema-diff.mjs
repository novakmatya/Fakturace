#!/usr/bin/env node
// Porovná databázi vzniklou ze všech migrací se schématem prisma/schema.prisma
// oficiálním schema-enginem Prismy (WASM verze – funguje i bez přístupu na
// binaries.prisma.sh). Použití:
//
//   node scripts/schema-diff.mjs --check          kontrola driftu (CI, testy)
//   node scripts/schema-diff.mjs --create nazev   vygeneruje novou migraci
//
// Migrace se aplikují do dočasné databáze („shadow“), takže pracovní data
// v DATA_DIR zůstanou nedotčená.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { bindMigrationAwareSqlAdapterFactory } from "@prisma/driver-adapter-utils";
import { runMigrations } from "./migrate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Vytvoří čistou databázi ze všech migrací a vrátí SQL, které by ji převedlo
 * do stavu podle schema.prisma. Prázdný výsledek = bez driftu.
 * @param {{ root?: string, workDir?: string }} [options]
 * @returns {Promise<{ changed: boolean, sql: string, shadowDbPath: string }>}
 */
export async function diffMigrationsAgainstSchema({ root = ROOT, workDir } = {}) {
  const dir = workDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "fakturace-shadow-"));
  const shadowDbPath = path.join(dir, "shadow.db");
  for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(shadowDbPath + suffix, { force: true });
  runMigrations({ dbPath: shadowDbPath, migrationsDir: path.join(root, "prisma", "migrations") });

  const schemaPath = path.join(root, "prisma", "schema.prisma");
  const content = fs.readFileSync(schemaPath, "utf8");
  const files = [{ path: schemaPath, content }];

  const { SchemaEngine } = await import("@prisma/schema-engine-wasm");
  const adapter = bindMigrationAwareSqlAdapterFactory(new PrismaBetterSqlite3({ url: `file:${shadowDbPath}` }));
  const engine = await SchemaEngine.new({ datamodels: [[schemaPath, content]] }, () => {}, adapter);
  try {
    const result = await engine.diff({
      from: { tag: "schemaDatasource", files, configDir: root },
      to: { tag: "schemaDatamodel", files },
      script: true,
      exitCode: true,
      filters: { externalTables: [], externalEnums: [] },
    });
    return { changed: result.exitCode === 2, sql: result.stdout ?? "", shadowDbPath };
  } finally {
    engine.free();
  }
}

/** Názvy triggerů, které mají po všech migracích existovat (CREATE bez pozdějšího DROP). */
export function expectedTriggers(root = ROOT) {
  const dir = path.join(root, "prisma", "migrations");
  const names = new Set();
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, "migration.sql");
    if (!fs.existsSync(file)) continue;
    const sql = fs.readFileSync(file, "utf8");
    for (const m of sql.matchAll(/CREATE\s+TRIGGER\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?/gi)) names.add(m[1]);
    for (const m of sql.matchAll(/DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?/gi)) names.delete(m[1]);
  }
  return [...names].sort();
}

/**
 * SQLite při přestavbě tabulky (DROP TABLE + RENAME) zahodí i její triggery.
 * Vrátí příkazy, které je na konci migrace znovu vytvoří.
 */
function triggerRestoreSql(shadowDbPath, sql) {
  const rebuilt = [...sql.matchAll(/DROP TABLE\s+"(\w+)"/g)].map((m) => m[1]);
  if (rebuilt.length === 0) return "";
  const db = new Database(shadowDbPath, { readonly: true });
  try {
    const parts = [];
    for (const table of rebuilt) {
      const triggers = db
        .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ? ORDER BY name`)
        .all(table);
      if (triggers.length === 0) continue;
      parts.push(`-- Obnovení integritních triggerů po přestavbě tabulky "${table}"`);
      for (const t of triggers) parts.push(`${t.sql};`);
    }
    return parts.length ? `\n${parts.join("\n\n")}\n` : "";
  } finally {
    db.close();
  }
}

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const [mode, name] = process.argv.slice(2);
  const { changed, sql, shadowDbPath } = await diffMigrationsAgainstSchema();

  if (mode === "--check") {
    if (changed) {
      console.error("Schéma a migrace se rozcházejí. Chybějící migrace by vypadala takto:\n");
      console.error(sql);
      process.exit(1);
    }
    console.log("Migrace odpovídají schématu (bez driftu).");
  } else if (mode === "--create") {
    if (!name || !/^[a-z0-9_]+$/.test(name)) {
      console.error("Zadejte název migrace malými písmeny, např.: --create pridat_platby");
      process.exit(1);
    }
    if (!changed) {
      console.log("Schéma odpovídá migracím – není co generovat.");
    } else {
      const dir = path.join(ROOT, "prisma", "migrations", `${timestamp()}_${name}`);
      fs.mkdirSync(dir, { recursive: true });
      const restore = triggerRestoreSql(shadowDbPath, sql);
      fs.writeFileSync(path.join(dir, "migration.sql"), sql.trimEnd() + "\n" + restore);
      console.log(`Vytvořeno: ${path.relative(ROOT, dir)}/migration.sql – zkontrolujte ho před commitem.`);
      if (restore) console.log("Pozor: migrace přestavuje tabulky s triggery – jejich obnovení je připojené na konec.");
    }
  } else {
    console.error("Použití: node scripts/schema-diff.mjs --check | --create <nazev>");
    process.exit(1);
  }
}
