import fs from "node:fs";
import path from "node:path";
import { parseMailbox } from "@/lib/email/address";
import type { EmailConfig } from "@/lib/email/config";

export type OutgoingEmail = {
  /** ID zprávy v aplikaci – zároveň klíč idempotence (opakovaný pokus neodešle duplikát). */
  id: string;
  from: string;
  replyTo: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
  attachment: { filename: string; content: Buffer } | null;
};

/** Chyba doručení. `permanent` = opakování nepomůže (špatná adresa, klíč, nasazení…). */
export class EmailDeliveryError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
    this.name = "EmailDeliveryError";
  }
}

const transient = (message: string) => new EmailDeliveryError(message, false);
const permanent = (message: string) => new EmailDeliveryError(message, true);

// ---------------------------------------------------------------------------
// Gmail přes Google Apps Script (webová aplikace ve vašem účtu)
// ---------------------------------------------------------------------------

type RelayReply = { ok: boolean; error?: string; permanent?: boolean; remaining?: number; duplicate?: boolean };

/** Česká zpráva pro známé chyby služby MailApp. */
function describeRelayError(message: string): { text: string; permanent: boolean } {
  if (/too many times for one day|limit exceeded/i.test(message)) {
    return { text: "Gmail: vyčerpaný denní limit e-mailů (u běžného účtu 100 příjemců denně). Zkuste to zítra.", permanent: false };
  }
  if (/invalid email|invalid argument: (to|cc|bcc|recipient)/i.test(message)) {
    return { text: `Gmail odmítl adresu příjemce (${message}).`, permanent: true };
  }
  return { text: `Gmail: ${message}`, permanent: false };
}

async function callGmailRelay(
  config: Extract<EmailConfig, { mode: "gmail" }>,
  payload: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<RelayReply> {
  let response: Response;
  try {
    // Apps Script odpovídá přesměrováním na stránku s výsledkem – fetch ho následuje.
    response = await fetchImpl(config.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, secret: config.secret }),
      redirect: "follow",
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "vypršel časový limit" : "síťová chyba";
    throw transient(`Gmail (Apps Script) není dostupný (${reason}).`);
  }
  if (response.status === 404) {
    throw permanent("Adresa skriptu neexistuje – zkontrolujte GMAIL_RELAY_URL (musí končit /exec).");
  }
  if (response.status === 401 || response.status === 403) {
    throw permanent("Google odmítl přístup ke skriptu – v nasazení nastavte „Kdo má přístup: Kdokoli“.");
  }
  if (response.status === 429 || response.status >= 500) {
    throw transient(`Google vrátil chybu ${response.status}.`);
  }
  const json = (await response.json().catch(() => null)) as RelayReply | null;
  if (!json || typeof json.ok !== "boolean") {
    throw permanent(
      "Skript nevrátil očekávanou odpověď – zkontrolujte nasazení („Spustit jako: Já“, „Kdo má přístup: Kdokoli“) a že je vložená aktuální verze skriptu.",
    );
  }
  if (!json.ok) {
    const described = describeRelayError(String(json.error ?? "neznámá chyba skriptu"));
    throw new EmailDeliveryError(described.text, json.permanent === true || described.permanent);
  }
  return json;
}

async function deliverViaGmail(
  email: OutgoingEmail,
  config: Extract<EmailConfig, { mode: "gmail" }>,
  fetchImpl: typeof fetch,
): Promise<string> {
  await callGmailRelay(
    config,
    {
      id: email.id,
      fromName: parseMailbox(email.from)?.name ?? "",
      to: email.to,
      cc: email.cc,
      bcc: email.bcc,
      replyTo: email.replyTo,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachment: email.attachment
        ? { filename: email.attachment.filename, contentType: "application/pdf", content: email.attachment.content.toString("base64") }
        : null,
    },
    fetchImpl,
  );
  return `gmail-${email.id}`;
}

/** Ověří spojení se skriptem bez odeslání e-mailu. Vrací zbývající denní limit. */
export async function pingGmailRelay(
  config: Extract<EmailConfig, { mode: "gmail" }>,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; remaining: number | null } | { ok: false; error: string }> {
  try {
    const reply = await callGmailRelay(config, { ping: true }, fetchImpl);
    return { ok: true, remaining: typeof reply.remaining === "number" ? reply.remaining : null };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Neznámá chyba." };
  }
}

// ---------------------------------------------------------------------------
// Resend (HTTPS API, vlastní doména)
// ---------------------------------------------------------------------------

type ResendErrorBody = { message?: string; name?: string };

async function deliverViaResend(
  email: OutgoingEmail,
  config: Extract<EmailConfig, { mode: "resend" }>,
  fetchImpl: typeof fetch,
): Promise<string> {
  const body: Record<string, unknown> = {
    from: email.from,
    to: email.to,
    subject: email.subject,
    text: email.text,
    html: email.html,
  };
  if (email.cc.length) body.cc = email.cc;
  if (email.bcc.length) body.bcc = email.bcc;
  if (email.replyTo) body.reply_to = email.replyTo;
  if (email.attachment) {
    body.attachments = [{ filename: email.attachment.filename, content: email.attachment.content.toString("base64") }];
  }

  let response: Response;
  try {
    response = await fetchImpl(`${config.apiUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.id,
        "User-Agent": "fakturace",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const reason = error instanceof Error && error.name === "TimeoutError" ? "vypršel časový limit" : "síťová chyba";
    throw transient(`Služba Resend není dostupná (${reason}).`);
  }

  if (response.ok) {
    const json = (await response.json().catch(() => null)) as { id?: string } | null;
    if (!json?.id) throw transient("Resend nevrátil ID zprávy.");
    return json.id;
  }

  const detail = ((await response.json().catch(() => null)) as ResendErrorBody | null)?.message ?? "";
  const status = response.status;
  // 409 = souběžný požadavek se stejným klíčem idempotence, 429 = limit, 5xx = výpadek.
  const isTransient = status === 409 || status === 429 || status >= 500;
  const prefix =
    status === 401 || status === 403
      ? "Resend odmítl API klíč nebo doménu odesílatele"
      : status === 422 || status === 400
        ? "Resend e-mail odmítl"
        : `Resend vrátil chybu ${status}`;
  throw new EmailDeliveryError(detail ? `${prefix}: ${detail}` : `${prefix}.`, !isTransient);
}

// ---------------------------------------------------------------------------
// Vývoj: uložení do souboru
// ---------------------------------------------------------------------------

function deliverToFile(email: OutgoingEmail, config: Extract<EmailConfig, { mode: "file" }>): string {
  fs.mkdirSync(config.dir, { recursive: true });
  const base = path.join(config.dir, email.id);
  const { attachment, ...rest } = email;
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify({ ...rest, attachment: attachment ? { filename: attachment.filename, bytes: attachment.content.length } : null }, null, 2),
  );
  fs.writeFileSync(`${base}.html`, email.html);
  return `dev-${email.id}`;
}

/** Doručí e-mail podle konfigurace. Vrací ID zprávy u poskytovatele. */
export async function deliverEmail(
  email: OutgoingEmail,
  config: EmailConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ providerMessageId: string }> {
  switch (config.mode) {
    case "gmail":
      return { providerMessageId: await deliverViaGmail(email, config, fetchImpl) };
    case "resend":
      return { providerMessageId: await deliverViaResend(email, config, fetchImpl) };
    case "file":
      return { providerMessageId: deliverToFile(email, config) };
    case "off":
      throw transient(config.reason);
  }
}
