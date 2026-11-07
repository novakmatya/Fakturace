import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/env";
import { updateCustomer } from "@/lib/customers";
import { prisma } from "@/lib/db";
import { buildDocumentEmailDraft, queueDocumentEmail } from "@/lib/email/invoice-email";
import { processOutbox } from "@/lib/email/outbox";
import { isBusinessHours, nextReminderDate, runReminderJob } from "@/lib/email/reminders";
import { createDraft, issueInvoice } from "@/lib/invoices/service";
import { paymentSummary, recordPayment } from "@/lib/payments/service";
import { updateAppSettings } from "@/lib/settings";
import { customerSchema } from "@/lib/validation";
import { draftData, NOW, seedBasics } from "../helpers/fixtures";
import { startMockEmail } from "../helpers/mock-email.mjs";

type Mock = Awaited<ReturnType<typeof startMockEmail>>;
let mock: Mock;
let base: Awaited<ReturnType<typeof seedBasics>>;

// Úterý 24. 11. 2026 10:00 v Praze (splatnost faktur z fixture je 16. 11. 2026).
const at = (iso: string) => new Date(iso);
const TUE_24_NOV = at("2026-11-24T09:00:00Z");
const plain = (text: string) => text.replace(/ /g, " ");

async function issued() {
  const draft = await createDraft(draftData({ customerId: base.customer.id, incomeSourceId: base.s7.id }));
  return issueInvoice(draft.id, { now: NOW });
}

async function reminderCount(invoiceId: string) {
  return prisma.emailMessage.count({ where: { invoiceId, kind: "REMINDER", status: { not: "CANCELLED" } } });
}

beforeAll(async () => {
  mock = await startMockEmail();
  process.env.GMAIL_RELAY_URL = mock.gmailUrl;
  process.env.GMAIL_RELAY_SECRET = mock.gmailSecret;
  process.env.MAIL_FROM = "Jan Novák <jan.novak@gmail.com>";
  resetEnvCache();
  base = await seedBasics();
});

afterAll(async () => {
  await mock.close();
});

beforeEach(async () => {
  mock.reset();
  await updateAppSettings({ remindersAuto: true, reminderFirstDays: 7, reminderRepeatDays: 14, reminderMaxCount: 3 });
  // Každý test začíná bez neuhrazených faktur a s prázdnou frontou.
  const open = await prisma.invoice.findMany({
    where: { type: "FAKTURA", status: "VYSTAVENA" },
    include: { payments: { where: { cancelledAt: null } } },
  });
  for (const inv of open) {
    const { remainingHalere } = paymentSummary(inv, inv.payments);
    if (remainingHalere > 0) {
      await recordPayment(inv.id, { paidOn: "2026-11-06", amount: remainingHalere, method: "PREVOD", note: null });
    }
  }
  await prisma.emailMessage.updateMany({ where: { status: "QUEUED" }, data: { status: "CANCELLED" } });
});

describe("plán upomínek", () => {
  it("pracovní doba: všední dny 8:00–17:59 pražského času", () => {
    expect(isBusinessHours(at("2026-11-24T07:00:00Z"))).toBe(true); // út 8:00
    expect(isBusinessHours(at("2026-11-24T06:59:00Z"))).toBe(false); // út 7:59
    expect(isBusinessHours(at("2026-11-24T16:59:00Z"))).toBe(true); // út 17:59
    expect(isBusinessHours(at("2026-11-24T17:00:00Z"))).toBe(false); // út 18:00
    expect(isBusinessHours(at("2026-11-28T09:00:00Z"))).toBe(false); // sobota
    expect(isBusinessHours(at("2026-07-14T06:30:00Z"))).toBe(true); // letní čas: út 8:30
  });

  it("první po X dnech od splatnosti, další po Y dnech od poslední, nejvýše N", () => {
    const settings = { reminderFirstDays: 7, reminderRepeatDays: 14, reminderMaxCount: 3 };
    expect(nextReminderDate("2026-11-16", [], settings)).toBe("2026-11-23");
    expect(nextReminderDate("2026-11-16", [{ queuedAt: at("2026-11-24T09:00:00Z") }], settings)).toBe("2026-12-08");
    const three = [at("2026-11-24T09:00:00Z"), at("2026-12-08T09:00:00Z"), at("2026-12-22T09:00:00Z")].map((queuedAt) => ({ queuedAt }));
    expect(nextReminderDate("2026-11-16", three, settings)).toBeNull();
    expect(nextReminderDate("2026-11-16", three.slice(0, 1), { ...settings, reminderRepeatDays: 0 })).toBeNull();
  });
});

describe("automatické upomínky", () => {
  it("pošle 1., 2. a 3. upomínku podle plánu a pak už ne", async () => {
    const invoice = await issued();
    expect(await runReminderJob({ now: at("2026-11-23T08:00:00Z") })).toMatchObject({ queued: 1 }); // po 23. 11. 9:00
    expect(await runReminderJob({ now: TUE_24_NOV })).toMatchObject({ queued: 0 });
    expect(await runReminderJob({ now: at("2026-12-04T09:00:00Z") })).toMatchObject({ queued: 0 }); // pá 4. 12. – ještě ne
    expect(await runReminderJob({ now: at("2026-12-07T09:00:00Z") })).toMatchObject({ queued: 1 }); // po 7. 12. = 23. 11. + 14
    expect(await runReminderJob({ now: at("2026-12-21T09:00:00Z") })).toMatchObject({ queued: 1 }); // po 21. 12.
    expect(await runReminderJob({ now: at("2027-01-05T09:00:00Z") })).toMatchObject({ queued: 0 }); // nejvýše 3
    expect(await reminderCount(invoice.id)).toBe(3);
  });

  it("neposílá před uplynutím lhůty, o víkendu ani mimo pracovní dobu", async () => {
    const invoice = await issued();
    expect(await runReminderJob({ now: at("2026-11-20T09:00:00Z") })).toMatchObject({ queued: 0 }); // jen 4 dny po splatnosti
    expect(await runReminderJob({ now: at("2026-11-28T09:00:00Z") })).toMatchObject({ skipped: "mimo pracovní dobu" });
    expect(await runReminderJob({ now: at("2026-11-24T19:00:00Z") })).toMatchObject({ skipped: "mimo pracovní dobu" });
    expect(await reminderCount(invoice.id)).toBe(0);
  });

  it("neposílá uhrazeným, odběratelům bez upomínek ani při vypnutém nastavení", async () => {
    const paid = await issued();
    await recordPayment(paid.id, { paidOn: "2026-11-06", amount: paid.amountDueHalere, method: "PREVOD", note: null });
    expect(await runReminderJob({ now: TUE_24_NOV })).toMatchObject({ queued: 0 });

    const unpaid = await issued();
    await updateAppSettings({ remindersAuto: false });
    expect(await runReminderJob({ now: TUE_24_NOV })).toMatchObject({ queued: 0, skipped: expect.stringMatching(/vypnuté/) });
    await updateAppSettings({ remindersAuto: true });

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: base.customer.id } });
    const asInput = (remindersEnabled: boolean) =>
      customerSchema.parse({
        ...customer,
        ico: customer.ico ?? "",
        dic: customer.dic ?? "",
        email: customer.email ?? "",
        emailCc: customer.emailCc ?? "",
        defaultIncomeSourceId: customer.defaultIncomeSourceId ?? "",
        defaultDueDays: customer.defaultDueDays === null ? "" : String(customer.defaultDueDays),
        note: customer.note ?? "",
        remindersEnabled,
      });
    await updateCustomer(customer.id, asInput(false));
    try {
      expect(await runReminderJob({ now: TUE_24_NOV })).toMatchObject({ queued: 0 });
    } finally {
      await updateCustomer(customer.id, asInput(true));
    }
    expect(await reminderCount(unpaid.id)).toBe(0);
    expect(await runReminderJob({ now: TUE_24_NOV })).toMatchObject({ queued: 1 });
  });

  it("souběžné běhy zařadí upomínku jen jednou", async () => {
    const invoice = await issued();
    const results = await Promise.all([
      runReminderJob({ now: TUE_24_NOV }),
      runReminderJob({ now: TUE_24_NOV }),
      runReminderJob({ now: TUE_24_NOV }),
    ]);
    expect(results.reduce((sum, r) => sum + r.queued, 0)).toBe(1);
    expect(await reminderCount(invoice.id)).toBe(1);
  });

  it("ručně odeslaná upomínka se do plánu započítá", async () => {
    const invoice = await issued();
    const draft = await buildDocumentEmailDraft("REMINDER", invoice.id, "2026-11-20");
    await queueDocumentEmail("REMINDER", invoice.id, {
      to: [draft.to],
      cc: [],
      subject: draft.subject,
      body: draft.body,
      now: at("2026-11-20T09:00:00Z"),
    });
    expect(await runReminderJob({ now: TUE_24_NOV })).toMatchObject({ queued: 0 }); // další až 4. 12.
    expect(await runReminderJob({ now: at("2026-12-04T09:00:00Z") })).toMatchObject({ queued: 1 });
  });
});

describe("text upomínky", () => {
  it("uvede zbývající částku a dny po splatnosti; při částečné úhradě bez odkazu na QR", async () => {
    const invoice = await issued();
    const full = await buildDocumentEmailDraft("REMINDER", invoice.id, "2026-11-24");
    expect(full.subject).toBe(`Upomínka – faktura č. ${invoice.number}`);
    expect(plain(full.body)).toContain("se splatností 16. 11. 2026 dosud není uhrazena. Zbývá uhradit 3 000,00 Kč.");
    expect(full.body).toContain("QR kódu");

    await recordPayment(invoice.id, { paidOn: "2026-11-06", amount: 100_000, method: "PREVOD", note: null });
    const partial = await buildDocumentEmailDraft("REMINDER", invoice.id, "2026-11-24");
    expect(plain(partial.body)).toContain("Zbývá uhradit 2 000,00 Kč.");
    expect(partial.body).not.toContain("QR kódu");
  });

  it("automatická upomínka odejde s PDF faktury", async () => {
    const invoice = await issued();
    await runReminderJob({ now: TUE_24_NOV });
    await processOutbox({ now: new Date(TUE_24_NOV.getTime() + 1000) });
    const reminder = mock.messages.find((m) => m.body.subject.includes(invoice.number!));
    expect(reminder?.body.subject).toMatch(/^Upomínka/);
    expect(reminder?.body.attachment.filename).toBe(`Faktura-${invoice.number}.pdf`);
    const row = await prisma.emailMessage.findFirstOrThrow({ where: { invoiceId: invoice.id, kind: "REMINDER" } });
    expect(row.auto).toBe(true);
    expect(row.dedupeKey).toBe(`upominka:${invoice.id}:1`);
  });
});
