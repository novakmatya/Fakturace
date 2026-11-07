import path from "node:path";
import { env } from "@/env";
import { parseMailbox } from "@/lib/email/address";

type Mailbox = { name: string | null; address: string };

/**
 * Jak se e-maily doručují (vše přes HTTPS – Railway Hobby odchozí SMTP blokuje):
 * - `gmail`: skript Google Apps Script ve vašem účtu odešle e-mail z vašeho Gmailu
 *   (bez vlastní domény; odeslané e-maily máte ve složce Odeslané),
 * - `resend`: HTTPS API Resend (vyžaduje ověřenou vlastní doménu),
 * - `file`: jen při vývoji bez konfigurace – e-maily se uloží do DATA_DIR/dev-mail,
 * - `off`: odesílání není nastavené (aplikace nic neodešle a řekne proč).
 */
export type EmailConfig =
  | { mode: "gmail"; url: string; secret: string; from: Mailbox }
  | { mode: "resend"; apiKey: string; apiUrl: string; from: Mailbox }
  | { mode: "file"; dir: string; from: Mailbox }
  | { mode: "off"; reason: string };

export const GMAIL_SECRET_MIN = 24;

function senderOrReason(hint: string): Mailbox | string {
  const raw = env.MAIL_FROM?.trim();
  if (!raw) return `Chybí proměnná MAIL_FROM (${hint}).`;
  const parsed = parseMailbox(raw);
  return parsed ?? `MAIL_FROM nemá platný tvar – použijte např. Jan Novák <${hint.includes("Gmail") ? "vas.ucet@gmail.com" : "faktury@vase-domena.cz"}>.`;
}

export function emailConfig(): EmailConfig {
  const relayUrl = env.GMAIL_RELAY_URL?.trim();
  const relaySecret = env.GMAIL_RELAY_SECRET?.trim();
  if (relayUrl || relaySecret) {
    if (!relayUrl) return { mode: "off", reason: "Chybí proměnná GMAIL_RELAY_URL (adresa webové aplikace skriptu)." };
    if (!relaySecret || relaySecret.length < GMAIL_SECRET_MIN) {
      return {
        mode: "off",
        reason: `GMAIL_RELAY_SECRET chybí nebo je kratší než ${GMAIL_SECRET_MIN} znaků (vygenerujte: openssl rand -hex 24).`,
      };
    }
    const from = senderOrReason("adresa Gmailu, ze kterého skript odesílá");
    if (typeof from === "string") return { mode: "off", reason: from };
    return { mode: "gmail", url: relayUrl, secret: relaySecret, from };
  }

  const apiKey = env.RESEND_API_KEY?.trim();
  if (apiKey) {
    const from = senderOrReason("adresa na ověřené doméně v Resend");
    if (typeof from === "string") return { mode: "off", reason: from };
    return { mode: "resend", apiKey, apiUrl: env.RESEND_API_URL.replace(/\/+$/, ""), from };
  }

  if (env.NODE_ENV === "development") {
    const from = env.MAIL_FROM ? parseMailbox(env.MAIL_FROM) : null;
    return { mode: "file", dir: path.resolve(env.DATA_DIR, "dev-mail"), from: from ?? { name: null, address: "faktury@example.cz" } };
  }
  return {
    mode: "off",
    reason: "Odesílání e-mailů není nastavené – propojte Gmail (GMAIL_RELAY_URL, GMAIL_RELAY_SECRET a MAIL_FROM).",
  };
}

export function isEmailEnabled(): boolean {
  return emailConfig().mode !== "off";
}

export const EMAIL_MODE_LABEL: Record<EmailConfig["mode"], string> = {
  gmail: "přes váš Gmail",
  resend: "přes Resend",
  file: "vývojový režim",
  off: "vypnuto",
};
