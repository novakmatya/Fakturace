import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { integrityMessage } from "@/lib/errors";
import { ensureInvoicePdf } from "@/lib/invoices/documents";
import { importInvoice, importRowSchema, setSeriesStart } from "@/lib/invoices/import";
import { issueQuickInvoice, nextMonthDescription, quickInvoiceDefaults } from "@/lib/invoices/quick";
import { InvoiceError } from "@/lib/invoices/service";
import { cashIncome } from "@/lib/payments/income";
import { seedBasics } from "../helpers/fixtures";

let base: Awaited<ReturnType<typeof seedBasics>>;
const NOV = new Date("2026-11-07T10:00:00Z");
const row = (n: number, month: number, paid = true) =>
  importRowSchema.parse({
    number: `2026${String(n).padStart(3, "0")}`,
    issueDate: `2026-${String(month).padStart(2, "0")}-01`,
    dueDate: `2026-${String(month).padStart(2, "0")}-15`,
    amount: "12 345,67",
    description: `Právní služby za ${["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen"][month - 1]} 2026`,
    paidOn: paid ? `2026-${String(month).padStart(2, "0")}-10` : "",
  });

beforeAll(async () => {
  base = await seedBasics();
});

describe("převzetí starších faktur", () => {
  it("10 faktur leden–říjen: původní čísla, úhrady v daňovém přehledu na haléř", async () => {
    for (let m = 1; m <= 10; m++) {
      await importInvoice({ customerId: base.customer.id, incomeSourceId: base.s7.id, row: row(m, m, m !== 10) }, { now: NOV });
    }
    const income = await cashIncome(2026);
    expect(income.totalHalere).toBe(9 * 1_234_567);
    expect(income.bySection.S7).toBe(9 * 1_234_567);
    const oct = await prisma.invoice.findFirstOrThrow({ where: { number: "2026010" } });
    expect(oct.origin).toBe("IMPORT");
    expect(oct.seriesYear).toBeNull();
    expect(oct.status).toBe("VYSTAVENA");
  });

  it("duplicitní číslo, budoucí datum a nesmysl místo PDF odmítne", async () => {
    await expect(importInvoice({ customerId: base.customer.id, incomeSourceId: base.s7.id, row: row(1, 1) }, { now: NOV })).rejects.toThrow(/už v aplikaci je/);
    const future = { ...row(99, 1), issueDate: "2026-12-01", dueDate: "2026-12-15" };
    await expect(importInvoice({ customerId: base.customer.id, incomeSourceId: base.s7.id, row: future }, { now: NOV })).rejects.toBeInstanceOf(InvoiceError);
    await expect(
      importInvoice({ customerId: base.customer.id, incomeSourceId: base.s7.id, row: row(98, 2), pdf: Buffer.from("ahoj") }, { now: NOV }),
    ).rejects.toThrow(/není PDF/);
  });

  it("převzatá faktura je neměnná, s nahraným PDF; bez PDF se žádné nevyrábí", async () => {
    const pdf = Buffer.from("%PDF-1.4 originál");
    const inv = await importInvoice({ customerId: base.customer.id, incomeSourceId: base.s7.id, row: row(50, 3), pdf }, { now: NOV });
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { pdfFile: true } });
    expect(stored.pdfFile?.mimeType).toBe("application/pdf");
    const err = await prisma.invoice.update({ where: { id: inv.id }, data: { amountDueHalere: 1 } }).catch((e: unknown) => e);
    expect(integrityMessage(err)).toBeTruthy();
    const origin = await prisma.invoice.update({ where: { id: inv.id }, data: { origin: "APP" } }).catch((e: unknown) => e);
    expect(integrityMessage(origin)).toBeTruthy();
    const noPdf = await prisma.invoice.findFirstOrThrow({ where: { number: "2026002" } });
    await expect(ensureInvoicePdf(noPdf.id)).rejects.toThrow(/nemá nahrané PDF/);
  });

  it("číselná řada aplikace naváže zvoleným číslem, změnit ji pak nejde", async () => {
    await setSeriesStart(2026, 11);
    await expect(setSeriesStart(2026, 20)).rejects.toThrow(/už začala/);
  });
});

describe("rychlá měsíční faktura", () => {
  it("posune měsíc v popisu", () => {
    expect(nextMonthDescription("Právní služby za říjen 2026")).toBe("Právní služby za listopad 2026");
    expect(nextMonthDescription("Služby – Prosinec 2026")).toBe("Služby – Leden 2027");
    expect(nextMonthDescription("za červen 2026")).toBe("za červenec 2026");
    expect(nextMonthDescription("za červenec 2026")).toBe("za srpen 2026");
    expect(nextMonthDescription("Paušální odměna")).toBe("Paušální odměna");
  });

  it("vezme odběratele a činnost z poslední faktury a vystaví č. 20260011 jen s novou částkou", async () => {
    const defaults = await quickInvoiceDefaults();
    expect(defaults?.customerId).toBe(base.customer.id);
    expect(defaults?.description).toBe("Právní služby za listopad 2026");
    const inv = await issueQuickInvoice({ description: defaults!.description, amount: "15 000" }, { now: NOV });
    expect(inv.number).toBe("20260011");
    expect(inv.origin).toBe("APP");
    expect(inv.amountDueHalere).toBe(1_500_000);
    expect(inv.issueDate).toBe("2026-11-07");
    expect(inv.dueDate).toBe("2026-11-21");
  });
});
