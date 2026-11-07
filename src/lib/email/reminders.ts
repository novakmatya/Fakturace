import { prisma } from "@/lib/db";
import { addDays, APP_TIME_ZONE, pragueDateOf, todayPrague } from "@/lib/dates";
import { parseAddressList } from "@/lib/email/address";
import { emailConfig } from "@/lib/email/config";
import { buildDocumentEmailDraft, queueDocumentEmail } from "@/lib/email/invoice-email";
import { getAppSettings } from "@/lib/settings";

export type ReminderSettings = { reminderFirstDays: number; reminderRepeatDays: number; reminderMaxCount: number };

const weekdayHour = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  weekday: "short",
  hour: "2-digit",
  hourCycle: "h23",
});

/** Automatické upomínky odcházejí jen v pracovní dny 8:00–17:59 pražského času. */
export function isBusinessHours(now: Date): boolean {
  const parts = Object.fromEntries(weekdayHour.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = Number(parts.hour);
  return parts.weekday !== "Sat" && parts.weekday !== "Sun" && hour >= 8 && hour < 18;
}

/**
 * Den, kdy je na řadě další upomínka (RRRR-MM-DD), nebo null, pokud už žádná nemá přijít.
 * Počítají se všechny upomínky k faktuře – ruční i automatické (kromě zrušených).
 */
export function nextReminderDate(
  dueDate: string,
  reminders: { queuedAt: Date }[],
  settings: ReminderSettings,
): string | null {
  if (reminders.length >= settings.reminderMaxCount) return null;
  if (reminders.length === 0) return addDays(dueDate, settings.reminderFirstDays);
  if (settings.reminderRepeatDays <= 0) return null;
  const last = reminders.reduce((max, r) => (r.queuedAt > max ? r.queuedAt : max), reminders[0].queuedAt);
  return addDays(pragueDateOf(last), settings.reminderRepeatDays);
}

/** Faktury, kterým má dnes odejít automatická upomínka. */
export async function findDueReminders(today: string, settings: ReminderSettings) {
  const invoices = await prisma.invoice.findMany({
    where: {
      type: "FAKTURA",
      status: "VYSTAVENA",
      dueDate: { lt: today },
      customer: { remindersEnabled: true, email: { not: null } },
    },
    include: {
      payments: { where: { cancelledAt: null }, select: { amountHalere: true } },
      emails: { where: { kind: "REMINDER", status: { not: "CANCELLED" } }, select: { queuedAt: true } },
    },
    orderBy: { dueDate: "asc" },
  });
  return invoices
    .filter((inv) => inv.amountDueHalere - inv.payments.reduce((sum, p) => sum + p.amountHalere, 0) > 0)
    .map((inv) => ({ invoice: inv, sequence: inv.emails.length + 1, dueOn: nextReminderDate(inv.dueDate, inv.emails, settings) }))
    .filter((x): x is typeof x & { dueOn: string } => x.dueOn !== null && x.dueOn <= today);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}

/**
 * Zařadí automatické upomínky, které jsou na řadě. Bezpečné při souběhu:
 * každá upomínka má unikátní klíč „upominka:<faktura>:<pořadí>“, druhý pokus databáze odmítne.
 */
export async function runReminderJob(
  options: { now?: Date; ignoreBusinessHours?: boolean } = {},
): Promise<{ queued: number; skipped: string | null }> {
  const now = options.now ?? new Date();
  const settings = await getAppSettings();
  if (!settings.remindersAuto) return { queued: 0, skipped: "automatické upomínky jsou vypnuté" };
  if (emailConfig().mode === "off") return { queued: 0, skipped: "odesílání e-mailů není nastavené" };
  if (!options.ignoreBusinessHours && !isBusinessHours(now)) return { queued: 0, skipped: "mimo pracovní dobu" };

  const today = todayPrague(now);
  let queued = 0;
  for (const { invoice, sequence } of await findDueReminders(today, settings)) {
    try {
      const draft = await buildDocumentEmailDraft("REMINDER", invoice.id, today);
      const to = parseAddressList(draft.to, { required: true });
      const cc = parseAddressList(draft.cc);
      if (!to.ok || !cc.ok) continue;
      await queueDocumentEmail("REMINDER", invoice.id, {
        to: to.addresses,
        cc: cc.addresses,
        subject: draft.subject,
        body: draft.body,
        auto: true,
        dedupeKey: `upominka:${invoice.id}:${sequence}`,
        now,
      });
      queued++;
    } catch (error) {
      if (isUniqueViolation(error)) continue; // stejnou upomínku mezitím zařadil jiný běh
      console.error(`[upomínky] faktura ${invoice.number}: zařazení selhalo`, error);
    }
  }
  return { queued, skipped: null };
}
