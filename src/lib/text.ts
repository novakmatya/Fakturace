/** Český plurál: 1 faktura, 2–4 faktury, 0 a 5+ faktur. */
export function czPlural(count: number, one: string, few: string, many: string): string {
  const n = Math.abs(count);
  if (n === 1) return one;
  if (n >= 2 && n <= 4) return few;
  return many;
}
