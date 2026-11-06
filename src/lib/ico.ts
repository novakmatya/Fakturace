/** Normalizuje IČO na 8 číslic (doplní úvodní nuly). Vrací null pro nečíselný vstup. */
export function normalizeIco(input: string): string | null {
  const digits = input.replace(/\s/g, "");
  if (!/^\d{1,8}$/.test(digits)) return null;
  return digits.padStart(8, "0");
}

/** Kontrolní součet IČO (modulo 11, váhy 8 až 2). */
export function isValidIco(input: string): boolean {
  const ico = normalizeIco(input);
  if (!ico) return false;
  const digits = ico.split("").map(Number);
  const sum = digits.slice(0, 7).reduce((acc, digit, i) => acc + digit * (8 - i), 0);
  const check = (11 - (sum % 11)) % 10;
  return check === digits[7];
}

/** DIČ: dvoupísmenný kód státu + 2 až 12 znaků. Formální kontrola, ne ověření v registru. */
export function normalizeDic(input: string): string | null {
  const value = input.replace(/\s/g, "").toUpperCase();
  if (!value) return null;
  return /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(value) ? value : null;
}
