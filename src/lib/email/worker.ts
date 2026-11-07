import { processOutbox } from "@/lib/email/outbox";

/** Jak často worker kontroluje frontu (opakované pokusy, zprávy zařazené jinde). */
const INTERVAL_MS = 15_000;

let running: Promise<void> | null = null;

/** Zpracuje frontu; souběžná volání ve stejném procesu se spojí do jednoho běhu. */
export function kickOutbox(): Promise<void> {
  if (!running) {
    running = processOutbox()
      .then((r) => {
        if (r.sent || r.failed || r.retried) {
          console.info(`[e-maily] odesláno ${r.sent}, opakování ${r.retried}, chyby ${r.failed}`);
        }
      })
      .catch((error: unknown) => {
        console.error("[e-maily] zpracování fronty selhalo", error);
      })
      .finally(() => {
        running = null;
      });
  }
  return running;
}

const globalForWorker = globalThis as unknown as { fakturaceEmailWorker?: ReturnType<typeof setInterval> };

/** Spustí periodické zpracování fronty (jednou za proces; volá instrumentation.ts). */
export function startEmailWorker(): void {
  if (globalForWorker.fakturaceEmailWorker) return;
  globalForWorker.fakturaceEmailWorker = setInterval(() => void kickOutbox(), INTERVAL_MS);
  globalForWorker.fakturaceEmailWorker.unref?.();
  void kickOutbox();
}
