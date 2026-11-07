import { processOutbox } from "@/lib/email/outbox";
import { runDailyBackupIfDue } from "@/lib/backup";
import { runReminderJob } from "@/lib/email/reminders";

/** Jak často worker kontroluje frontu (opakované pokusy, zprávy zařazené jinde). */
const INTERVAL_MS = 15_000;
/** Upomínky a denní zálohu stačí kontrolovat jednou za hodinu. */
const REMINDER_INTERVAL_MS = 60 * 60_000;

let running: Promise<void> | null = null;
let lastReminderRun = 0;

async function cycle(): Promise<void> {
  if (Date.now() - lastReminderRun >= REMINDER_INTERVAL_MS) {
    lastReminderRun = Date.now();
    try {
      const reminders = await runReminderJob();
      if (reminders.queued) console.info(`[upomínky] zařazeno ${reminders.queued}`);
    } catch (error) {
      console.error("[upomínky] kontrola selhala", error);
    }
    try {
      if (await runDailyBackupIfDue()) console.info("[zálohy] denní záloha hotová");
    } catch (error) {
      console.error("[zálohy] záloha selhala", error);
    }
  }
  const r = await processOutbox();
  if (r.sent || r.failed || r.retried) {
    console.info(`[e-maily] odesláno ${r.sent}, opakování ${r.retried}, chyby ${r.failed}`);
  }
}

/** Zpracuje frontu; souběžná volání ve stejném procesu se spojí do jednoho běhu. */
export function kickOutbox(): Promise<void> {
  if (!running) {
    running = cycle()
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
