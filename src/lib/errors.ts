/**
 * Databázové triggery odmítají nedovolené změny zprávou "INTEGRITY: …".
 * Prisma takovou chybu hlásí obecně (P2003), původní text je v meta.driverAdapterError.
 */
export function integrityMessage(error: unknown): string | null {
  const e = error as {
    message?: string;
    meta?: { driverAdapterError?: { cause?: { originalMessage?: string } }; message?: string };
  };
  const candidates = [
    e?.meta?.driverAdapterError?.cause?.originalMessage,
    e?.meta?.message,
    e?.message,
  ];
  for (const text of candidates) {
    const match = typeof text === "string" ? text.match(/INTEGRITY: ([^\n"]+)/) : null;
    if (match) return match[1].trim();
  }
  return null;
}

/** Srozumitelná zpráva pro uživatele z libovolné chyby služby. */
export function userMessage(error: unknown, fallback = "Akci se nepodařilo dokončit."): string {
  const integrity = integrityMessage(error);
  if (integrity) return `Databáze akci odmítla: ${integrity}.`;
  if (error instanceof Error && error.name !== "PrismaClientKnownRequestError" && error.message) {
    return error.message;
  }
  return fallback;
}
