/**
 * Kalendářní data se ukládají jako text RRRR-MM-DD v časové zóně Europe/Prague.
 * Platba připsaná 31. 12. ve 23:30 tak nikdy nespadne do jiného roku.
 */

export const APP_TIME_ZONE = "Europe/Prague";

const isoFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Dnešní datum v Praze jako RRRR-MM-DD. */
export function todayPrague(now: Date = new Date()): string {
  return isoFormatter.format(now);
}

/** Kalendářní datum okamžiku v Praze (např. časové razítko platby). */
export function pragueDateOf(instant: Date): string {
  return isoFormatter.format(instant);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function parse(value: string): Date {
  if (!isIsoDate(value)) throw new Error(`Neplatné datum: ${value}`);
  const [y, m, d] = value.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const date = parse(value);
  date.setUTCDate(date.getUTCDate() + days);
  return format(date);
}

/** Rozdíl ve dnech b − a. */
export function daysBetween(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);
}

export function yearOf(value: string): number {
  parse(value);
  return Number(value.slice(0, 4));
}

/** "2026-11-06" → "6. 11. 2026" */
export function formatCzDate(value: string): string {
  const date = parse(value);
  return `${date.getUTCDate()}. ${date.getUTCMonth() + 1}. ${date.getUTCFullYear()}`;
}

/** "2026-11-06" → "20261106" (formát data pro QR platbu). */
export function compactDate(value: string): string {
  parse(value);
  return value.replaceAll("-", "");
}
