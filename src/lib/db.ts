import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, type Prisma } from "@/generated/prisma/client";
import { env } from "@/env";

export function databaseFilePath(): string {
  return path.join(env.DATA_DIR, "app.db");
}

function createClient(): PrismaClient {
  // better-sqlite3 má cizí klíče zapnuté ve výchozím stavu; WAL nastavuje migrace.
  const adapter = new PrismaBetterSqlite3({ url: databaseFilePath(), timeout: 5000 });
  return new PrismaClient({ adapter });
}

const globalForPrisma = globalThis as unknown as { __prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.__prisma ?? createClient();

// V dev režimu přežije klient hot reload; v testech má každý soubor vlastní databázi.
if (process.env.NODE_ENV === "development") {
  globalForPrisma.__prisma = prisma;
}

export type Tx = Prisma.TransactionClient;
