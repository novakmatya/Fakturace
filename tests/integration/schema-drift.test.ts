import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { diffMigrationsAgainstSchema, expectedTriggers } from "../../scripts/schema-diff.mjs";

// Migrace píšeme ručně (a generujeme `npm run db:new-migration`), proto se
// v každém běhu testů ověřuje, že databáze z migrací přesně odpovídá
// schema.prisma – oficiálním schema-enginem Prismy.
describe("migrace vs. schema.prisma", () => {
  it("nemají drift (tabulky, sloupce, typy, výchozí hodnoty, indexy, cizí klíče)", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "fakturace-drift-"));
    const { changed, sql } = await diffMigrationsAgainstSchema({ workDir });
    expect(changed, `Chybějící migrace:\n${sql}`).toBe(false);
  });

  it("obsahují všechny integritní triggery", () => {
    const db = new Database(path.join(process.env.DATA_DIR!, "app.db"), { readonly: true });
    try {
      const present = new Set(
        db
          .prepare(`SELECT name FROM sqlite_master WHERE type = 'trigger'`)
          .all()
          .map((row) => (row as { name: string }).name),
      );
      const expected = expectedTriggers();
      expect(expected.length).toBeGreaterThanOrEqual(18);
      expect(expected.filter((name) => !present.has(name))).toEqual([]);
    } finally {
      db.close();
    }
  });
});
