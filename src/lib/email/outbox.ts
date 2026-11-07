import { audit } from "@/lib/audit";
import { prisma, type Tx } from "@/lib/db";
import { emailConfig, type EmailConfig } from "@/lib/email/config";
import { deliverEmail, EmailDeliveryError } from "@/lib/email/transport";
import { readStoredFile } from "@/lib/files";

export type EmailKind = "INVOICE" | "REMINDER" | "TEST";
export type EmailStatus = "QUEUED" | "SENDING" | "SENT" | "FAILED" | "CANCELLED";

/** Po kolika minutách se zkouší znovu (index = počet dosavadních pokusů). */
const RETRY_MINUTES = [1, 5, 15, 60];
export const MAX_ATTEMPTS = RETRY_MINUTES.length + 1;
/** Zpráva „odesílá se“ déle než tohle je po pádu procesu – vrátí se do fronty. */
const STALE_SENDING_MS = 5 * 60_000;

export type QueueEmailInput = {
  kind: EmailKind;
  invoiceId?: string | null;
  from: string;
  replyTo?: string | null;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText: string;
  bodyHtml: string;
  attachmentFileId?: string | null;
  attachmentName?: string | null;
  auto?: boolean;
  /** Unikátní klíč proti duplicitám automatických e-mailů (např. upomínek). */
  dedupeKey?: string | null;
  /** Okamžik zařazení (výchozí: teď). */
  now?: Date;
};

export async function queueEmail(input: QueueEmailInput, client: Tx = prisma) {
  if (input.to.length === 0) throw new Error("E-mail musí mít alespoň jednoho příjemce.");
  const message = await client.emailMessage.create({
    data: {
      kind: input.kind,
      invoiceId: input.invoiceId ?? null,
      fromAddress: input.from,
      replyTo: input.replyTo ?? null,
      toAddresses: JSON.stringify(input.to),
      ccAddresses: input.cc?.length ? JSON.stringify(input.cc) : null,
      bccAddresses: input.bcc?.length ? JSON.stringify(input.bcc) : null,
      subject: input.subject,
      bodyText: input.bodyText,
      bodyHtml: input.bodyHtml,
      attachmentFileId: input.attachmentFileId ?? null,
      attachmentName: input.attachmentName ?? null,
      auto: input.auto ?? false,
      dedupeKey: input.dedupeKey ?? null,
      ...(input.now ? { queuedAt: input.now, nextAttemptAt: input.now } : {}),
    },
  });
  await audit(
    {
      action: "EMAIL_QUEUED",
      actor: input.auto ? "SYSTEM" : "USER",
      entityType: "EmailMessage",
      entityId: message.id,
      details: { kind: input.kind, invoiceId: input.invoiceId ?? null, to: input.to },
    },
    client,
  );
  return message;
}

export function parseStoredList(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export type OutboxResult = { sent: number; retried: number; failed: number };

/**
 * Odešle zprávy, které jsou na řadě. Bezpečné i při souběhu více volání:
 * zprávu si vždy „zamkne“ jen jedno volání (podmíněná změna stavu v databázi)
 * a opakovaný pokus používá stejný klíč idempotence, takže nevznikne duplikát.
 */
export async function processOutbox(
  options: { now?: Date; limit?: number; config?: EmailConfig; fetchImpl?: typeof fetch } = {},
): Promise<OutboxResult> {
  const now = options.now ?? new Date();
  const config = options.config ?? emailConfig();
  const result: OutboxResult = { sent: 0, retried: 0, failed: 0 };
  if (config.mode === "off") return result;

  // Zprávy, jejichž odesílání přerušil pád nebo restart, vrátit do fronty.
  await prisma.emailMessage.updateMany({
    where: { status: "SENDING", nextAttemptAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
    data: { status: "QUEUED", lastError: "Odesílání bylo přerušeno – zkusím znovu." },
  });

  const due = await prisma.emailMessage.findMany({
    where: { status: "QUEUED", nextAttemptAt: { lte: now } },
    orderBy: { queuedAt: "asc" },
    take: options.limit ?? 20,
    include: { attachment: true },
  });

  for (const message of due) {
    const claimed = await prisma.emailMessage.updateMany({
      where: { id: message.id, status: "QUEUED" },
      data: { status: "SENDING", attempts: { increment: 1 }, nextAttemptAt: now },
    });
    if (claimed.count === 0) continue;
    const attempt = message.attempts + 1;

    try {
      const attachment = message.attachment
        ? { filename: message.attachmentName ?? "priloha.pdf", content: readStoredFile(message.attachment) }
        : null;
      const { providerMessageId } = await deliverEmail(
        {
          id: message.id,
          from: message.fromAddress,
          replyTo: message.replyTo,
          to: parseStoredList(message.toAddresses),
          cc: parseStoredList(message.ccAddresses),
          bcc: parseStoredList(message.bccAddresses),
          subject: message.subject,
          text: message.bodyText,
          html: message.bodyHtml,
          attachment,
        },
        config,
        options.fetchImpl,
      );
      await prisma.emailMessage.update({
        where: { id: message.id },
        data: { status: "SENT", sentAt: new Date(), providerMessageId, lastError: null },
      });
      await audit({
        action: "EMAIL_SENT",
        actor: "SYSTEM",
        entityType: "EmailMessage",
        entityId: message.id,
        details: { invoiceId: message.invoiceId, providerMessageId, attempt },
      });
      result.sent++;
    } catch (error) {
      const permanent = error instanceof EmailDeliveryError ? error.permanent : true;
      const reason =
        error instanceof EmailDeliveryError
          ? error.message
          : error instanceof Error
            ? `Neočekávaná chyba: ${error.message}`
            : "Neočekávaná chyba.";
      if (permanent || attempt >= MAX_ATTEMPTS) {
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: { status: "FAILED", lastError: reason },
        });
        await audit({
          action: "EMAIL_FAILED",
          actor: "SYSTEM",
          entityType: "EmailMessage",
          entityId: message.id,
          details: { invoiceId: message.invoiceId, reason, attempt },
        });
        result.failed++;
      } else {
        const delayMinutes = RETRY_MINUTES[Math.min(attempt - 1, RETRY_MINUTES.length - 1)];
        await prisma.emailMessage.update({
          where: { id: message.id },
          data: { status: "QUEUED", lastError: reason, nextAttemptAt: new Date(now.getTime() + delayMinutes * 60_000) },
        });
        result.retried++;
      }
    }
  }
  return result;
}

/** Zrušení zprávy, která čeká na další pokus (odeslané už zrušit nelze). */
export async function cancelQueuedEmail(id: string): Promise<boolean> {
  const { count } = await prisma.emailMessage.updateMany({
    where: { id, status: "QUEUED" },
    data: { status: "CANCELLED" },
  });
  if (count > 0) await audit({ action: "EMAIL_CANCELLED", entityType: "EmailMessage", entityId: id });
  return count > 0;
}

export async function listEmailsForInvoice(invoiceId: string) {
  return prisma.emailMessage.findMany({ where: { invoiceId }, orderBy: { queuedAt: "desc" } });
}

/** Počet e-mailů, které se za posledních `days` dní nepodařilo odeslat. */
export async function failedEmailCount(days = 14): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 3600_000);
  return prisma.emailMessage.count({ where: { status: "FAILED", queuedAt: { gte: since } } });
}
