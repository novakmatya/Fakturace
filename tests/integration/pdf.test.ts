import jsQR from "jsqr";
import { PNG } from "pngjs";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { integrityMessage } from "@/lib/errors";
import { readStoredFile } from "@/lib/files";
import { ensureInvoicePdf, toPdfData } from "@/lib/invoices/documents";
import { invoiceSpayd, qrPngForSpayd } from "@/lib/invoices/pdf";
import { createDraft, issueInvoice } from "@/lib/invoices/service";
import { parseSpayd } from "@/lib/spayd";
import { draftData, NOW, seedBasics } from "../helpers/fixtures";

async function pdfText(data: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(data), disableFontFace: true, useSystemFonts: false })
    .promise;
  const parts: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    parts.push(content.items.map((item) => ("str" in item ? item.str : "")).join(" "));
  }
  return parts.join("\n").replace(/ /g, " ");
}

function decodeQr(png: Buffer): string | null {
  const image = PNG.sync.read(png);
  return jsQR(new Uint8ClampedArray(image.data), image.width, image.height)?.data ?? null;
}

let invoiceId: string;

beforeAll(async () => {
  const { customer, s7 } = await seedBasics();
  const draft = await createDraft(
    draftData(
      { customerId: customer.id, incomeSourceId: s7.id },
      {
        lines: [
          { description: "Konzultace – smluvní dokumentace", quantity: "2", unit: "hod", unitPrice: "1 500" },
          { description: "Příprava podání (žluťoučký kůň úpěl)", quantity: "1,5", unit: "hod", unitPrice: "1 200,50" },
        ],
      },
    ),
  );
  invoiceId = (await issueInvoice(draft.id, { now: NOW })).id;
});

describe("PDF faktury s QR platbou", () => {
  it("uloží PDF s českým textem, povinnými údaji a otiskem", async () => {
    const file = await ensureInvoicePdf(invoiceId);
    const data = readStoredFile(file);
    expect(data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(file.kind).toBe("INVOICE_PDF");

    // Popisky jsou v PDF verzálkami s prostrkáním – porovnáváme bez mezer a velikosti písmen.
    const compact = (value: string) => value.replace(/\s+/g, "").toLocaleLowerCase("cs");
    const text = compact(await pdfText(data));
    for (const expected of [
      "20260001",
      "Dodavatel",
      "Odběratel",
      "Jan Novák",
      "Žluťoučká s.r.o.",
      "IČO: 12345679",
      "IČO: 87654326",
      "Datum vystavení",
      "Datum splatnosti",
      "Variabilní symbol",
      "Příprava podání (žluťoučký kůň úpěl)",
      "4 800,75 Kč",
      "Nejsem plátce DPH.",
      "19-2000145399/0800",
      "QR Platba",
      "Fyzická osoba zapsaná v živnostenském rejstříku.",
    ]) {
      expect(text, `v PDF chybí: ${expected}`).toContain(compact(expected));
    }
  });

  it("QR kód nese správnou platbu ve formátu SPAYD", async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: invoiceId },
      include: { lines: true, correctsInvoice: true, pdfFile: true },
    });
    const spayd = invoiceSpayd(toPdfData(invoice));
    expect(spayd).not.toBeNull();
    const decoded = decodeQr(await qrPngForSpayd(spayd!));
    expect(decoded).toBe(spayd);
    expect(parseSpayd(decoded!)).toMatchObject({
      ACC: "CZ6508000000192000145399",
      AM: "4800.75",
      CC: "CZK",
      DT: "20261116",
      "X-VS": "20260001",
    });
  });

  it("uložené PDF je originál: znovu se negeneruje a vazbu nelze změnit", async () => {
    const first = await ensureInvoicePdf(invoiceId);
    const second = await ensureInvoicePdf(invoiceId);
    expect(second.id).toBe(first.id);
    const error = await prisma.invoice
      .update({ where: { id: invoiceId }, data: { pdfFileId: null } })
      .catch((e: unknown) => e);
    expect(integrityMessage(error)).toBeTruthy();
  });
});
