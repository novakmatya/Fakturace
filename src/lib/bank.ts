/** Český bankovní účet "předčíslí-číslo/kód banky" a IBAN. */

export type CzAccount = { prefix: string; number: string; bankCode: string };

const PREFIX_WEIGHTS = [10, 5, 8, 4, 2, 1];
const NUMBER_WEIGHTS = [6, 3, 7, 9, 10, 5, 8, 4, 2, 1];

function weightedMod11(digits: string, weights: number[]): number {
  const padded = digits.padStart(weights.length, "0");
  return padded.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0) % 11;
}

/** Rozloží "19-123457/0710" nebo "123457/0710"; ověří kontrolní součet ČNB. */
export function parseCzAccount(input: string): CzAccount | null {
  const match = input.replace(/\s/g, "").match(/^(?:(\d{1,6})-)?(\d{2,10})\/(\d{4})$/);
  if (!match) return null;
  const [, prefix = "", number, bankCode] = match;
  if (prefix && weightedMod11(prefix, PREFIX_WEIGHTS) !== 0) return null;
  if (weightedMod11(number, NUMBER_WEIGHTS) !== 0) return null;
  if (/^0+$/.test(number)) return null;
  return { prefix, number, bankCode };
}

export function formatCzAccount(account: CzAccount): string {
  const prefix = account.prefix.replace(/^0+/, "");
  const number = account.number.replace(/^0+/, "");
  return `${prefix ? `${prefix}-` : ""}${number}/${account.bankCode}`;
}

function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder;
}

function ibanToNumeric(iban: string): string {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  return rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
}

export function normalizeIban(input: string): string {
  return input.replace(/\s/g, "").toUpperCase();
}

export function isValidIban(input: string): boolean {
  const iban = normalizeIban(input);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false;
  if (iban.startsWith("CZ") && iban.length !== 24) return false;
  return mod97(ibanToNumeric(iban)) === 1;
}

/** IBAN z českého účtu: CZkk BBBB PPPPPP CCCCCCCCCC. */
export function czAccountToIban(account: CzAccount): string {
  const bban = account.bankCode + account.prefix.padStart(6, "0") + account.number.padStart(10, "0");
  const check = 98 - mod97(ibanToNumeric(`CZ00${bban}`));
  return `CZ${String(check).padStart(2, "0")}${bban}`;
}

/** "CZ6508000000192000145399" → "CZ65 0800 0000 1920 0014 5399" */
export function formatIban(input: string): string {
  return normalizeIban(input).replace(/(.{4})/g, "$1 ").trim();
}
