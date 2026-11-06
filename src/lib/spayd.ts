import { isValidIban, normalizeIban } from "@/lib/bank";
import { compactDate, isIsoDate } from "@/lib/dates";
import { formatSpaydAmount } from "@/lib/money";

/**
 * QR Platba – řetězec ve formátu SPAYD 1.0 (Short Payment Descriptor, standard ČBA).
 * Klíče: ACC (IBAN[+BIC]), AM (částka), CC (měna), DT (splatnost RRRRMMDD),
 * MSG (zpráva, max. 60 znaků), RN (příjemce, max. 35), X-VS/X-SS/X-KS (max. 10 číslic).
 */
export type SpaydInput = {
  iban: string;
  bic?: string | null;
  amountHalere: number;
  currency?: string;
  dueDate?: string | null;
  variableSymbol?: string | null;
  specificSymbol?: string | null;
  constantSymbol?: string | null;
  message?: string | null;
  recipientName?: string | null;
};

/** Odstraní diakritiku a znaky, které by čtečky bank mohly špatně zpracovat. */
export function toSpaydText(value: string, maxLength: number): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\*/g, " ")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength)
    .trim();
}

function symbol(value: string | null | undefined, label: string): string | null {
  if (!value) return null;
  if (!/^\d{1,10}$/.test(value)) throw new Error(`${label} musí mít 1 až 10 číslic.`);
  return value;
}

export function buildSpayd(input: SpaydInput): string {
  const iban = normalizeIban(input.iban);
  if (!isValidIban(iban)) throw new Error("Neplatný IBAN pro QR platbu.");
  const currency = (input.currency ?? "CZK").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("Neplatná měna pro QR platbu.");

  const parts: string[] = ["SPD", "1.0"];
  const bic = input.bic?.replace(/\s/g, "").toUpperCase();
  parts.push(`ACC:${iban}${bic ? `+${bic}` : ""}`);
  const amount = formatSpaydAmount(input.amountHalere);
  if (amount.length > 10) throw new Error("Částka je pro QR platbu příliš vysoká.");
  parts.push(`AM:${amount}`);
  parts.push(`CC:${currency}`);
  if (input.dueDate) {
    if (!isIsoDate(input.dueDate)) throw new Error("Neplatné datum splatnosti pro QR platbu.");
    parts.push(`DT:${compactDate(input.dueDate)}`);
  }
  const vs = symbol(input.variableSymbol, "Variabilní symbol");
  const ss = symbol(input.specificSymbol, "Specifický symbol");
  const ks = symbol(input.constantSymbol, "Konstantní symbol");
  if (vs) parts.push(`X-VS:${vs}`);
  if (ss) parts.push(`X-SS:${ss}`);
  if (ks) parts.push(`X-KS:${ks}`);
  const msg = input.message ? toSpaydText(input.message, 60) : "";
  if (msg) parts.push(`MSG:${msg}`);
  const rn = input.recipientName ? toSpaydText(input.recipientName, 35) : "";
  if (rn) parts.push(`RN:${rn}`);
  return parts.join("*");
}

/** Rozloží řetězec SPAYD zpět na klíče (pro testy a kontrolu PDF). */
export function parseSpayd(value: string): Record<string, string> {
  const [header, version, ...fields] = value.split("*");
  if (header !== "SPD" || version !== "1.0") throw new Error("Neplatná hlavička SPAYD.");
  return Object.fromEntries(
    fields.map((field) => {
      const index = field.indexOf(":");
      return [field.slice(0, index), field.slice(index + 1)];
    }),
  );
}
