import { prisma } from "@/lib/db";
import { formatIban } from "@/lib/bank";
import { formatCzDate } from "@/lib/dates";
import { formatMailbox } from "@/lib/email/address";
import { emailConfig } from "@/lib/email/config";
import { queueEmail } from "@/lib/email/outbox";
import { getTemplate, renderTemplateText, type TemplateVars, textToHtml } from "@/lib/email/templates";
import { ensureInvoicePdf } from "@/lib/invoices/documents";
import type { CustomerSnapshot, SupplierSnapshot } from "@/lib/invoices/types";
import { formatCzk } from "@/lib/money";
import { getAppSettings } from "@/lib/settings";

export class InvoiceEmailError extends Error {}

type IssuedForEmail = {
  type: string;
  number: string | null;
  issueDate: string;
  dueDate: string;
  amountDueHalere: number;
  variableSymbol: string | null;
  paymentMethod: string;
  supplierSnapshot: string | null;
  customerSnapshot: string | null;
};

/** Hodnoty proměnných šablony – vždy ze zmrazených údajů dokladu, ne z aktuálního nastavení. */
export function invoiceTemplateVars(invoice: IssuedForEmail): TemplateVars {
  if (!invoice.number || !invoice.supplierSnapshot || !invoice.customerSnapshot) {
    throw new InvoiceEmailError("E-mailem lze odeslat jen vystavený doklad.");
  }
  const supplier = JSON.parse(invoice.supplierSnapshot) as SupplierSnapshot;
  const customer = JSON.parse(invoice.customerSnapshot) as CustomerSnapshot;
  const vs = invoice.variableSymbol ?? invoice.number;
  const amount = formatCzk(invoice.amountDueHalere);
  const paymentSentence =
    invoice.paymentMethod === "HOTOVOST"
      ? `Částku ${amount} prosím uhraďte v hotovosti.`
      : `Platbu prosím pošlete na účet ${supplier.bankAccount} s variabilním symbolem ${vs}. ` +
        "Nejrychleji ji zadáte načtením QR kódu z faktury v bankovní aplikaci.";
  const signature = [supplier.name, supplier.phone, supplier.email, supplier.web].filter(Boolean).join("\n");
  return {
    cislo: invoice.number,
    castka: amount,
    splatnost: formatCzDate(invoice.dueDate),
    datum_vystaveni: formatCzDate(invoice.issueDate),
    vs,
    ucet: supplier.bankAccount,
    iban: formatIban(supplier.iban),
    platebni_udaje: paymentSentence,
    odberatel: customer.name,
    dodavatel: supplier.name,
    podpis: signature,
  };
}

async function loadIssuedInvoice(invoiceId: string) {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { customer: { select: { email: true, emailCc: true } } },
  });
  if (!invoice) throw new InvoiceEmailError("Doklad neexistuje.");
  if (!invoice.number) throw new InvoiceEmailError("Koncept nelze odeslat – nejdřív ho vystavte.");
  if (invoice.type !== "FAKTURA") throw new InvoiceEmailError("Odesílání dobropisů přibude s dobropisy.");
  return invoice;
}

/** Předvyplněný e-mail k faktuře (příjemci z karty odběratele, text ze šablony). */
export async function buildInvoiceEmailDraft(invoiceId: string) {
  const invoice = await loadIssuedInvoice(invoiceId);
  const template = await getTemplate("INVOICE");
  const vars = invoiceTemplateVars(invoice);
  return {
    to: invoice.customer.email ?? "",
    cc: invoice.customer.emailCc ?? "",
    subject: renderTemplateText(template.subject, vars),
    body: renderTemplateText(template.body, vars),
  };
}

/**
 * Zařadí e-mail s PDF faktury do fronty. Odesílatel, odpověď a skrytá kopie
 * se doplní z konfigurace a nastavení; PDF je uložený originál dokladu.
 */
export async function queueInvoiceEmail(
  invoiceId: string,
  input: { to: string[]; cc: string[]; subject: string; body: string; auto?: boolean },
) {
  const config = emailConfig();
  if (config.mode === "off") throw new InvoiceEmailError(config.reason);
  const invoice = await loadIssuedInvoice(invoiceId);
  const pdf = await ensureInvoicePdf(invoiceId);
  const supplier = JSON.parse(invoice.supplierSnapshot!) as SupplierSnapshot;
  const settings = await getAppSettings();

  const fromAddress = config.from.address;
  const supplierEmail = supplier.email?.trim() || null;
  const supplierIsSender = supplierEmail !== null && supplierEmail.toLowerCase() === fromAddress.toLowerCase();
  // Odpovědi na e-mail dodavatele, pokud se odesílá z jiné adresy.
  const replyTo = supplierEmail && !supplierIsSender ? supplierEmail : null;
  // Skrytá kopie dodavateli – ne tam, kam se e-mail posílá, a ne na adresu odesílatele
  // (odeslaný e-mail je pak už ve složce Odeslané, např. u Gmailu).
  const recipients = new Set([...input.to, ...input.cc].map((a) => a.toLowerCase()));
  const bcc =
    settings.emailBccSelf && supplierEmail && !supplierIsSender && !recipients.has(supplierEmail.toLowerCase())
      ? [supplierEmail]
      : [];

  return queueEmail({
    kind: "INVOICE",
    invoiceId,
    from: formatMailbox(config.from.name ?? supplier.name, fromAddress),
    replyTo,
    to: input.to,
    cc: input.cc,
    bcc,
    subject: input.subject,
    bodyText: input.body,
    bodyHtml: textToHtml(input.body, input.subject),
    attachmentFileId: pdf.id,
    attachmentName: `Faktura-${invoice.number}.pdf`,
    auto: input.auto ?? false,
  });
}

/** Zkušební e-mail na adresu dodavatele – ověří celé nastavení odesílání. */
export async function queueTestEmail(to: string) {
  const config = emailConfig();
  if (config.mode === "off") throw new InvoiceEmailError(config.reason);
  const subject = "Zkušební e-mail z aplikace Fakturace";
  const body = [
    "Dobrý den,",
    "",
    "tento e-mail potvrzuje, že odesílání z aplikace Fakturace funguje.",
    "Faktury budou odcházet ze stejné adresy.",
  ].join("\n");
  return queueEmail({
    kind: "TEST",
    from: formatMailbox(config.from.name ?? "Fakturace", config.from.address),
    to: [to],
    subject,
    bodyText: body,
    bodyHtml: textToHtml(body, subject),
  });
}
