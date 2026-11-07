import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { integrityMessage } from "@/lib/errors";
import { displayStatus } from "@/lib/invoices/display";
import { createDraft, getInvoice, issueInvoice, listInvoices } from "@/lib/invoices/service";
import { cashIncome } from "@/lib/payments/income";
import { cancelPayment, listPayments, PaymentError, paymentSummary, recordPayment } from "@/lib/payments/service";
import { draftData, NOW, seedBasics } from "../helpers/fixtures";

let base: Awaited<ReturnType<typeof seedBasics>>;

beforeAll(async () => {
  base = await seedBasics();
});

async function issued(overrides: Parameters<typeof draftData>[1] = {}, now = NOW, source: "s7" | "s9" = "s7") {
  const incomeSourceId = source === "s7" ? base.s7.id : base.s9.id;
  const draft = await createDraft(draftData({ customerId: base.customer.id, incomeSourceId }, overrides));
  return issueInvoice(draft.id, { now });
}

const pay = (invoiceId: string, paidOn: string, amount: number, now = NOW) =>
  recordPayment(invoiceId, { paidOn, amount, method: "PREVOD", note: null }, { now });

async function status(invoiceId: string, today: string) {
  return displayStatus((await getInvoice(invoiceId))!, today);
}

async function rejected(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "očekávané odmítnutí").not.toBeNull();
  expect(integrityMessage(error), "odmítnutí triggerem v databázi").toBeTruthy();
}

describe("stavy podle úhrad a splatnosti", () => {
  it("vystavena → částečně uhrazena → uhrazena; po splatnosti jen když chybí peníze", async () => {
    const invoice = await issued(); // 3 000 Kč, splatnost 16. 11. 2026
    expect(await status(invoice.id, "2026-11-10")).toBe("VYSTAVENA");
    expect(await status(invoice.id, "2026-11-16")).toBe("VYSTAVENA"); // den splatnosti ještě není po splatnosti
    expect(await status(invoice.id, "2026-11-17")).toBe("PO_SPLATNOSTI");

    await pay(invoice.id, "2026-11-05", 100_000);
    expect(await status(invoice.id, "2026-11-10")).toBe("CASTECNE_UHRAZENA");
    expect(await status(invoice.id, "2026-11-20")).toBe("PO_SPLATNOSTI");

    await pay(invoice.id, "2026-11-06", 200_000);
    expect(await status(invoice.id, "2026-12-31")).toBe("UHRAZENA");
    const summary = paymentSummary(invoice, await listPayments(invoice.id));
    expect(summary).toEqual({ paidHalere: 300_000, remainingHalere: 0, overpaidHalere: 0, fullyPaid: true });
  });

  it("přeplatek eviduje a ukáže", async () => {
    const invoice = await issued();
    await pay(invoice.id, "2026-11-05", 350_000);
    expect(paymentSummary(invoice, await listPayments(invoice.id))).toMatchObject({ fullyPaid: true, overpaidHalere: 50_000 });
  });

  it("filtry seznamu: neuhrazené, po splatnosti, uhrazené", async () => {
    const unpaid = await issued();
    const paid = await issued();
    await pay(paid.id, "2026-11-05", 300_000);
    const ids = async (status: string) =>
      (await listInvoices({ status, today: "2026-11-20" })).map((i) => i.id);
    expect(await ids("PO_SPLATNOSTI")).toContain(unpaid.id);
    expect(await ids("PO_SPLATNOSTI")).not.toContain(paid.id);
    expect(await ids("NEUHRAZENA")).toContain(unpaid.id);
    expect(await ids("UHRAZENA")).toContain(paid.id);
    expect(await ids("UHRAZENA")).not.toContain(unpaid.id);
  });
});

describe("zápis a storno úhrady", () => {
  it("storno úhradu vyřadí ze součtu, jde jen jednou a jen s důvodem", async () => {
    const invoice = await issued();
    const payment = await pay(invoice.id, "2026-11-05", 300_000);
    await expect(cancelPayment(payment.id, "  ")).rejects.toBeInstanceOf(PaymentError);
    await cancelPayment(payment.id, "Zapsáno k jiné faktuře");
    await expect(cancelPayment(payment.id, "znovu")).rejects.toBeInstanceOf(PaymentError);
    expect(paymentSummary(invoice, await listPayments(invoice.id)).paidHalere).toBe(0);
    const row = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(row.cancelReason).toBe("Zapsáno k jiné faktuře");
    expect(await prisma.auditLog.count({ where: { action: "PAYMENT_CANCELLED", entityId: payment.id } })).toBe(1);
  });

  it("odmítne budoucí datum, koncept a nulovou částku", async () => {
    const invoice = await issued();
    await expect(pay(invoice.id, "2026-11-07", 100)).rejects.toThrow(/budoucnosti/); // NOW = 6. 11. 2026
    const draft = await createDraft(draftData({ customerId: base.customer.id, incomeSourceId: base.s7.id }));
    await expect(pay(draft.id, "2026-11-05", 100)).rejects.toBeInstanceOf(PaymentError);
  });
});

describe("úhrady jsou v databázi neměnné a nemazatelné", () => {
  it("nejde smazat ani změnit částku či datum; storno jen s důvodem", async () => {
    const invoice = await issued();
    const payment = await pay(invoice.id, "2026-11-05", 300_000);
    await rejected(prisma.payment.delete({ where: { id: payment.id } }));
    await rejected(prisma.payment.update({ where: { id: payment.id }, data: { amountHalere: 1 } }));
    await rejected(prisma.payment.update({ where: { id: payment.id }, data: { paidOn: "2027-01-01" } }));
    await rejected(prisma.payment.update({ where: { id: payment.id }, data: { cancelledAt: new Date() } }));
  });

  it("přímý zápis do databáze hlídá doklad, znaménko a formát data", async () => {
    const invoice = await issued();
    const draft = await createDraft(draftData({ customerId: base.customer.id, incomeSourceId: base.s7.id }));
    await rejected(prisma.payment.create({ data: { invoiceId: draft.id, paidOn: "2026-11-05", amountHalere: 100 } }));
    await rejected(prisma.payment.create({ data: { invoiceId: invoice.id, paidOn: "2026-11-05", amountHalere: -100 } }));
    await rejected(prisma.payment.create({ data: { invoiceId: invoice.id, paidOn: "2026-11-05", amountHalere: 0 } }));
    await rejected(prisma.payment.create({ data: { invoiceId: invoice.id, paidOn: "5.11.2026", amountHalere: 100 } }));
    await rejected(
      prisma.payment.create({
        data: { invoiceId: invoice.id, paidOn: "2026-11-05", amountHalere: 100, cancelledAt: new Date(), cancelReason: "x" },
      }),
    );
  });
});

// Tento blok vystavuje faktury s prosincovým datem – musí být poslední
// (číselná řada roku jde chronologicky).
describe("příjmy podle peněžního principu", () => {
  it("faktura z 15. 12. uhrazená 10. 1. je příjmem následujícího roku – přesně na haléř", async () => {
    const before2026 = await cashIncome(2026);
    const before2027 = await cashIncome(2027);

    const december = new Date("2026-12-20T10:00:00Z");
    const invoice = await issued(
      {
        issueDate: "2026-12-15",
        dueDate: "2026-12-29",
        lines: [{ description: "Konzultace", quantity: "3,5", unit: "hod", unitPrice: "1 234,57" }],
      },
      december,
    );
    expect(invoice.amountDueHalere).toBe(432_100); // 3,5 × 1 234,57 = 4 320,995 → 4 321,00
    await pay(invoice.id, "2027-01-10", invoice.amountDueHalere, new Date("2027-01-15T10:00:00Z"));

    const after2026 = await cashIncome(2026);
    const after2027 = await cashIncome(2027);
    expect(after2026.totalHalere).toBe(before2026.totalHalere);
    expect(after2027.totalHalere - before2027.totalHalere).toBe(432_100);
    expect(after2027.bySection.S7 - before2027.bySection.S7).toBe(432_100);
  });

  it("roční součet sedí se součtem nestornovaných úhrad, rozdělený na § 7 a § 9", async () => {
    const december = new Date("2026-12-31T10:00:00Z");
    const rent = await issued(
      { issueDate: "2026-12-20", dueDate: "2027-01-05", lines: [{ description: "Nájem leden", quantity: "1", unit: "", unitPrice: "18 500" }] },
      december,
      "s9",
    );
    const advice = await issued(
      { issueDate: "2026-12-21", dueDate: "2027-01-04", lines: [{ description: "Rozbor smlouvy", quantity: "1", unit: "", unitPrice: "999,99" }] },
      december,
    );
    await pay(rent.id, "2026-12-30", 1_850_000, december);
    await pay(advice.id, "2026-12-31", 50_000, december);
    const wrong = await pay(advice.id, "2026-12-31", 49_999, december);
    await cancelPayment(wrong.id, "Překlep v částce");
    await pay(advice.id, "2026-12-31", 49_999, december);

    const income = await cashIncome(2026);
    const expected = await prisma.payment.aggregate({
      where: { cancelledAt: null, paidOn: { gte: "2026-01-01", lte: "2026-12-31" } },
      _sum: { amountHalere: true },
    });
    expect(income.totalHalere).toBe(expected._sum.amountHalere);
    expect(income.bySection.S7 + income.bySection.S9).toBe(income.totalHalere);
    expect(income.bySection.S9).toBe(1_850_000);
    expect(income.bySource.find((s) => s.section === "S9")?.name).toBe("Pronájem bytu");
    expect(await status(advice.id, "2027-01-10")).toBe("UHRAZENA");
  });
});
