import { z } from "zod";

const emailSchema = z.email();

export const MAX_RECIPIENTS = 10;

/** Je to platná e-mailová adresa (bez jména)? */
export function isEmailAddress(value: string): boolean {
  return emailSchema.safeParse(value).success;
}

/**
 * Rozdělí seznam adres oddělených čárkou, středníkem nebo novým řádkem.
 * Vrací buď adresy (bez duplicit, v původním pořadí), nebo chybu k zobrazení.
 */
export function parseAddressList(
  input: string | null | undefined,
  { required = false }: { required?: boolean } = {},
): { ok: true; addresses: string[] } | { ok: false; error: string } {
  const parts = (input ?? "")
    .split(/[,;\n]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) {
    return required ? { ok: false, error: "Zadejte alespoň jednu e-mailovou adresu." } : { ok: true, addresses: [] };
  }
  const invalid = parts.filter((p) => !isEmailAddress(p));
  if (invalid.length > 0) {
    return { ok: false, error: `Neplatná adresa: ${invalid.join(", ")}` };
  }
  const unique = [...new Map(parts.map((p) => [p.toLowerCase(), p])).values()];
  if (unique.length > MAX_RECIPIENTS) {
    return { ok: false, error: `Nejvýše ${MAX_RECIPIENTS} adres.` };
  }
  return { ok: true, addresses: unique };
}

/**
 * Rozebere odesílatele ve tvaru `Jméno <adresa@domena.cz>` nebo `adresa@domena.cz`.
 */
export function parseMailbox(value: string): { name: string | null; address: string } | null {
  const trimmed = value.trim();
  const withName = /^(.*?)\s*<([^<>\s]+)>$/.exec(trimmed);
  if (withName) {
    const name = withName[1].trim().replace(/^"(.*)"$/, "$1").trim();
    const address = withName[2];
    return isEmailAddress(address) ? { name: name || null, address } : null;
  }
  return isEmailAddress(trimmed) ? { name: null, address: trimmed } : null;
}

/** Sestaví `Jméno <adresa>`; ze jména odstraní znaky, které by rozbily hlavičku. */
export function formatMailbox(name: string | null, address: string): string {
  const clean = (name ?? "").replace(/["<>\r\n]/g, "").trim();
  return clean ? `${clean} <${address}>` : address;
}
