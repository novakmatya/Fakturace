import { prisma } from "@/lib/db";
import { formatIban } from "@/lib/bank";
import { daysBetween, formatCzDate, todayPrague } from "@/lib/dates";
import { formatMailbox } from "@/lib/email/address";
import { emailConfig } from "@/lib/email/config";
import { type EmailKind, queueEmail } from "@/lib/email/outbox";
import {
  getTemplate,
  renderTemplateText,
  type TemplateKey,
  type TemplateVars,
  textToHtml,
} from "@/lib/email/templates";
import { ensureInvoicePdf } from "@/lib/invoices/documents";
import type { CustomerSnapshot, SupplierSnapshot } from "@/lib/invoices/types";
import { formatCzk } from "@/lib/money";
import { getAppSettings } from "@/lib/settings";

export class InvoiceEmailError extends Error {}

/** E-mail k dokladu: odeslání faktury nebo upomínka. */
export type DocumentEmailKind = Extract<EmailKind, "INVOICE" | "REMINDER">;

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

/**
 * Hodnoty proměnných šablony – vždy ze zmrazených údajů dokladu, ne z aktuálního
 * nastavení. `paidHalere` = už přijaté úhrady (u upomínky se počítá zbývající částka).
 */
export function invoiceTemplateVars(
  invoice: IssuedForEmail,
  { paidHalere = 0, today = todayPrague() }: { paidHalere?: number; today?: string } = {},
): TemplateVars {
  if (!invoice.number || !invoice.supplierSnapshot || !invoice.customerSnapshot) {
    throw new InvoiceEmailError("E-mailem lze odeslat jen vystavený doklad.");
  }
  const supplier = JSON.parse(invoice.supplierSnapshot) as SupplierSnapshot;
  const customer = JSON.parse(invoice.customerSnapshot) as CustomerSnapshot;
  const vs = invoice.variableSymbol ?? invoice.number;
  const remainingHalere = Math.max(invoice.amountDueHalere - paidHalere, 0);
  const remaining = formatCzk(remainingHalere);
  // QR kód v PDF je na celou částku – při částečné úhradě by sváděl k přeplatku.
  const qrHint = paidHalere === 0 ? " Nejrychleji ji zadáte načtením QR kódu z faktury v bankovní aplikaci." : "";
  const paymentSentence =
    invoice.paymentMethod === "HOTOVOST"
      ? `Částku ${remaining} prosím uhraďte v hotovosti.`
      : `Platbu prosím pošlete na účet ${supplier.bankAccount} s variabilním symbolem ${vs}.${qrHint}`;
  const signature = [supplier.name, supplier.phone, supplier.email, supplier.web].filter(Boolean).join("\n");
  return {
    cislo: invoice.number,
    castka: formatCzk(invoice.amountDueHalere),
    zbyva: remaining,
    dni_po_splatnosti: String(Math.max(daysBetween(invoice.dueDate, today), 0)),
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
    include: {
      customer: { select: { email: true, emailCc: true } },
      payments: { where: { cancelledAt: null }, select: { amountHalere: true } },
    },
  });
  if (!invoice) throw new InvoiceEmailError("Doklad neexistuje.");
  if (!invoice.number) throw new InvoiceEmailError("Koncept nelze odeslat – nejdřív ho vystavte.");
  if (invoice.type !== "FAKTURA") throw new InvoiceEmailError("Odesílání dobropisů přibude s dobropisy.");
  if (invoice.status !== "VYSTAVENA") throw new InvoiceEmailError("Stornovaný doklad se neodesílá.");
  return invoice;
}

const TEMPLATE_FOR: Record<DocumentEmailKind, TemplateKey> = { INVOICE: "INVOICE", REMINDER: "REMINDER" };

/** Předvyplněný e-mail k faktuře nebo upomínka (příjemci z karty odběratele, text ze šablony). */
export async function buildDocumentEmailDraft(kind: DocumentEmailKind, invoiceId: string, today = todayPrague()) {
  const invoice = await loadIssuedInvoice(invoiceId);
  const template = await getTemplate(TEMPLATE_FOR[kind]);
  const paidHalere = invoice.payments.reduce((sum, p) => sum + p.amountHalere, 0);
  const vars = invoiceTemplateVars(invoice, { paidHalere, today });
  return {
    to: invoice.customer.email ?? "",
    cc: invoice.customer.emailCc ?? "",
    subject: renderTemplateText(template.subject, vars),
    body: renderTemplateText(template.body, vars),
  };
}

export const buildInvoiceEmailDraft = (invoiceId: string) => buildDocumentEmailDraft("INVOICE", invoiceId);

type QueueInput = {
  to: string[];
  cc: string[];
  subject: string;
  body: string;
  auto?: boolean;
  dedupeKey?: string;
  now?: Date;
};

/**
 * Zařadí e-mail s PDF faktury do fronty. Odesílatel, odpověď a skrytá kopie
 * se doplní z konfigurace a nastavení; PDF je uložený originál dokladu.
 */
export async function queueDocumentEmail(kind: DocumentEmailKind, invoiceId: string, input: QueueInput) {
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
    kind,
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
    dedupeKey: input.dedupeKey,
    now: input.now,
  });
}

export const queueInvoiceEmail = (invoiceId: string, input: QueueInput) => queueDocumentEmail("INVOICE", invoiceId, input);

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
