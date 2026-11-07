import { describe, expect, it } from "vitest";
import { addDays, daysBetween, formatCzDate, formatCzDateTime, isIsoDate, pragueDateOf, todayPrague } from "@/lib/dates";
import { parseAddressList, parseMailbox } from "@/lib/email/address";
import { czPlural } from "@/lib/text";
import {
  formatCzk,
  formatQuantity,
  formatSpaydAmount,
  lineTotalHalere,
  parseCzkInput,
  parseQuantityInput,
  roundingToWholeCrowns,
} from "@/lib/money";

describe("peníze v haléřích", () => {
  it("součet položky zaokrouhluje na haléře polovinou od nuly", () => {
    expect(lineTotalHalere(1000, 150000)).toBe(150000); // 1 × 1 500,00
    expect(lineTotalHalere(1500, 150000)).toBe(225000); // 1,5 × 1 500,00
    expect(lineTotalHalere(333, 100)).toBe(33); // 0,333 × 1,00 = 0,333 → 0,33
    expect(lineTotalHalere(335, 100)).toBe(34); // 0,335 → 0,34 (polovina nahoru)
    expect(lineTotalHalere(335, -100)).toBe(-34); // u záporné ceny symetricky
    expect(lineTotalHalere(1, 1)).toBe(0);
  });

  it("zvládne velké částky bez ztráty přesnosti", () => {
    // 1 000 000 jednotek × 10 000 Kč = 10 mld. Kč, stále přesně v haléřích
    expect(lineTotalHalere(1_000_000_000, 1_000_000)).toBe(1_000_000_000_000);
    expect(() => lineTotalHalere(1_000_000_000, 10_000_000_000_000)).toThrow();
  });

  it("zaokrouhlení na celé koruny vrací rozdíl", () => {
    expect(roundingToWholeCrowns(123400)).toBe(0); // 1 234,00
    expect(roundingToWholeCrowns(123449)).toBe(-49); // 1 234,49 → 1 234
    expect(roundingToWholeCrowns(123450)).toBe(50); // 1 234,50 → 1 235
    expect(roundingToWholeCrowns(-12350)).toBe(-50); // −123,50 → −124
  });

  it("formátuje částku česky s nezlomitelnými mezerami", () => {
    expect(formatCzk(1234550)).toBe("12 345,50 Kč");
    expect(formatCzk(5)).toBe("0,05 Kč");
    expect(formatCzk(-150000)).toBe("−1 500,00 Kč");
    expect(formatCzk(100000000, { currency: false })).toBe("1 000 000,00");
  });

  it("čte částky z formuláře", () => {
    expect(parseCzkInput("1 234,50")).toBe(123450);
    expect(parseCzkInput("1234.5")).toBe(123450);
    expect(parseCzkInput("1500")).toBe(150000);
    expect(parseCzkInput("-500")).toBe(-50000);
    expect(parseCzkInput("12,345")).toBeNull();
    expect(parseCzkInput("abc")).toBeNull();
  });

  it("čte množství a formátuje ho zpět", () => {
    expect(parseQuantityInput("1,5")).toBe(1500);
    expect(parseQuantityInput("2")).toBe(2000);
    expect(parseQuantityInput("0")).toBeNull();
    expect(parseQuantityInput("0,0001")).toBeNull();
    expect(formatQuantity(1500)).toBe("1,5");
    expect(formatQuantity(2000)).toBe("2");
  });

  it("částka pro QR platbu má tečku a dvě desetinná místa", () => {
    expect(formatSpaydAmount(123450)).toBe("1234.50");
    expect(() => formatSpaydAmount(0)).toThrow();
  });
});

describe("kalendářní data v Europe/Prague", () => {
  it("platba 31. 12. ve 23:30 pražského času patří do starého roku", () => {
    // 23:30 v Praze = 22:30 UTC (zimní čas)
    expect(pragueDateOf(new Date("2026-12-31T22:30:00Z"))).toBe("2026-12-31");
    // 00:30 v Praze 1. 1. = 23:30 UTC 31. 12.
    expect(pragueDateOf(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(todayPrague(new Date("2026-07-31T22:30:00Z"))).toBe("2026-08-01"); // letní čas UTC+2
  });

  it("počítá s daty bez časové zóny", () => {
    expect(addDays("2026-12-20", 14)).toBe("2027-01-03");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2026-12-15", "2027-01-10")).toBe(26);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(formatCzDate("2026-11-06")).toBe("6. 11. 2026");
  });
});

describe("formátování a adresy", () => {
  it("datum a čas v pražském čase bez úvodních nul", () => {
    expect(formatCzDateTime(new Date("2026-11-07T06:05:00Z"))).toBe("7.\u00a011.\u00a02026 7:05");
    expect(formatCzDateTime(new Date("2026-07-31T22:30:00Z"))).toBe("1.\u00a08.\u00a02026 0:30"); // letní čas
  });

  it("český plurál", () => {
    expect([0, 1, 2, 4, 5, 11].map((n) => czPlural(n, "faktura", "faktury", "faktur"))).toEqual([
      "faktur",
      "faktura",
      "faktury",
      "faktury",
      "faktur",
      "faktur",
    ]);
  });

  it("seznam e-mailových adres", () => {
    expect(parseAddressList("a@example.cz, B@example.cz; a@example.cz")).toEqual({
      ok: true,
      addresses: ["a@example.cz", "B@example.cz"],
    });
    expect(parseAddressList("", { required: true }).ok).toBe(false);
    expect(parseAddressList("a@example.cz, nic")).toEqual({ ok: false, error: "Neplatná adresa: nic" });
  });

  it("odesílatel s jménem i bez", () => {
    expect(parseMailbox("Jan Novák <faktury@example.cz>")).toEqual({ name: "Jan Novák", address: "faktury@example.cz" });
    expect(parseMailbox('"Novák, advokát" <a@example.cz>')).toEqual({ name: "Novák, advokát", address: "a@example.cz" });
    expect(parseMailbox("faktury@example.cz")).toEqual({ name: null, address: "faktury@example.cz" });
    expect(parseMailbox("Jan Novák")).toBeNull();
  });
});
