/**
 * Peníze jsou vždy celá čísla v haléřích. Žádná desetinná čísla s plovoucí čárkou.
 * Množství jsou celá čísla v tisícinách (1 ks = 1000).
 */

const NBSP = " ";

/** Součet položky: množství × cena, zaokrouhleno na haléře (polovina od nuly). */
export function lineTotalHalere(quantityMilli: number, unitPriceHalere: number): number {
  assertSafeInt(quantityMilli, "množství");
  assertSafeInt(unitPriceHalere, "cena");
  const product = BigInt(quantityMilli) * BigInt(unitPriceHalere);
  const negative = product < 0n;
  const abs = negative ? -product : product;
  const rounded = (abs + 500n) / 1000n;
  const result = Number(negative ? -rounded : rounded);
  if (!Number.isSafeInteger(result)) throw new Error("Částka je mimo povolený rozsah.");
  return result;
}

/** Zaokrouhlení celkové částky na celé koruny (polovina od nuly); vrací rozdíl v haléřích. */
export function roundingToWholeCrowns(totalHalere: number): number {
  const sign = totalHalere < 0 ? -1 : 1;
  const abs = Math.abs(totalHalere);
  const rounded = Math.floor((abs + 50) / 100) * 100;
  return sign * rounded - totalHalere;
}

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 1234550 → "12 345,50 Kč" (mezery jsou nezlomitelné, aby se částka nezalomila). */
export function formatCzk(halere: number, options: { currency?: boolean } = {}): string {
  assertSafeInt(halere, "částka");
  const negative = halere < 0;
  const abs = Math.abs(halere);
  const crowns = Math.floor(abs / 100);
  const cents = abs % 100;
  const text = `${negative ? "−" : ""}${groupThousands(String(crowns))},${String(cents).padStart(2, "0")}`;
  return options.currency === false ? text : `${text}${NBSP}Kč`;
}

/** Částka pro QR platbu: "12345.50" (tečka, dvě desetinná místa, bez mezer). */
export function formatSpaydAmount(halere: number): string {
  if (!Number.isSafeInteger(halere) || halere <= 0) {
    throw new Error("Částka pro QR platbu musí být kladná.");
  }
  return `${Math.floor(halere / 100)}.${String(halere % 100).padStart(2, "0")}`;
}

/**
 * Převede vstup z formuláře na haléře. Přijímá "1 234,50", "1234.5", "1234".
 * Vrací null pro neplatný vstup nebo víc než dvě desetinná místa.
 */
export function parseCzkInput(input: string): number | null {
  const normalized = input.replace(/[\s  ]/g, "").replace(/kč$/i, "").replace(",", ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const negative = normalized.startsWith("-");
  const [whole, frac = ""] = normalized.replace("-", "").split(".");
  const value = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

/** Převede množství z formuláře ("1,5" → 1500). Max. tři desetinná místa, musí být kladné. */
export function parseQuantityInput(input: string): number | null {
  const normalized = input.replace(/[\s ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return null;
  const [whole, frac = ""] = normalized.split(".");
  const value = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1_000_000_000) return null;
  return value;
}

/** 1500 → "1,5"; 2000 → "2". */
export function formatQuantity(quantityMilli: number): string {
  const whole = Math.floor(quantityMilli / 1000);
  const frac = String(quantityMilli % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${groupThousands(String(whole))},${frac}` : groupThousands(String(whole));
}

function assertSafeInt(value: number, label: string) {
  if (!Number.isSafeInteger(value)) throw new Error(`Neplatná hodnota (${label}).`);
}
