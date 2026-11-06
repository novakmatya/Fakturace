import { describe, expect, it, vi } from "vitest";
import { AresError, fetchAresCompany, mapAresSubject } from "@/lib/ares";
import { czAccountToIban, formatIban, isValidIban, parseCzAccount } from "@/lib/bank";
import { isValidIco, normalizeDic, normalizeIco } from "@/lib/ico";
import { buildSpayd, parseSpayd, toSpaydText } from "@/lib/spayd";

describe("IČO a DIČ", () => {
  it("ověřuje kontrolní součet IČO", () => {
    expect(isValidIco("00006947")).toBe(true); // Ministerstvo financí
    expect(isValidIco("27082440")).toBe(true);
    expect(isValidIco("6947")).toBe(true); // doplnění úvodních nul
    expect(isValidIco("27082441")).toBe(false);
    expect(isValidIco("abc")).toBe(false);
    expect(normalizeIco("6947")).toBe("00006947");
  });

  it("normalizuje DIČ", () => {
    expect(normalizeDic("cz 27082440")).toBe("CZ27082440");
    expect(normalizeDic("27082440")).toBeNull();
  });
});

describe("bankovní účet a IBAN", () => {
  it("převede český účet na IBAN (vzorový příklad ČNB)", () => {
    const account = parseCzAccount("19-2000145399/0800");
    expect(account).not.toBeNull();
    const iban = czAccountToIban(account!);
    expect(iban).toBe("CZ6508000000192000145399");
    expect(formatIban(iban)).toBe("CZ65 0800 0000 1920 0014 5399");
    expect(isValidIban(iban)).toBe(true);
  });

  it("odmítne účet se špatným kontrolním součtem", () => {
    expect(parseCzAccount("19-2000145398/0800")).toBeNull();
    expect(parseCzAccount("124/0100")).toBeNull();
    expect(isValidIban("CZ6508000000192000145398")).toBe(false);
  });
});

describe("QR platba (SPAYD)", () => {
  const base = { iban: "CZ6508000000192000145399", amountHalere: 300000 };

  it("sestaví řetězec s povinnými a volitelnými klíči", () => {
    const value = buildSpayd({
      ...base,
      dueDate: "2026-11-16",
      variableSymbol: "20260001",
      message: "Faktura 20260001",
      recipientName: "Jan Novák",
    });
    expect(value).toBe(
      "SPD*1.0*ACC:CZ6508000000192000145399*AM:3000.00*CC:CZK*DT:20261116*X-VS:20260001*MSG:Faktura 20260001*RN:Jan Novak",
    );
    expect(parseSpayd(value)).toMatchObject({ ACC: base.iban, AM: "3000.00", "X-VS": "20260001" });
  });

  it("odstraní diakritiku a hvězdičky a zkrátí text", () => {
    expect(toSpaydText("Příliš *žluťoučký* kůň", 60)).toBe("Prilis zlutoucky kun");
    expect(toSpaydText("x".repeat(80), 60)).toHaveLength(60);
  });

  it("odmítne neplatný IBAN, částku a symbol", () => {
    expect(() => buildSpayd({ ...base, iban: "CZ00" })).toThrow();
    expect(() => buildSpayd({ ...base, amountHalere: 0 })).toThrow();
    expect(() => buildSpayd({ ...base, variableSymbol: "12345678901" })).toThrow();
  });
});

describe("ARES", () => {
  it("sestaví adresu ze strukturované odpovědi", () => {
    const company = mapAresSubject({
      ico: "27082440",
      obchodniJmeno: "Alza.cz a.s.",
      dic: "CZ27082440",
      sidlo: {
        kodStatu: "CZ",
        nazevObce: "Praha",
        nazevMestskehoObvodu: "Praha 7",
        nazevCastiObce: "Holešovice",
        nazevUlice: "Jankovcova",
        cisloDomovni: 1522,
        cisloOrientacni: 53,
        psc: 17000,
        textovaAdresa: "Jankovcova 1522/53, Holešovice, 17000 Praha 7",
      },
    });
    expect(company).toMatchObject({
      ico: "27082440",
      name: "Alza.cz a.s.",
      dic: "CZ27082440",
      street: "Jankovcova 1522/53",
      city: "Praha 7",
      zip: "170 00",
      country: "CZ",
    });
  });

  it("zvládne obec bez ulic a doplní z textové adresy", () => {
    expect(
      mapAresSubject({
        ico: "6947",
        obchodniJmeno: "Obec",
        sidlo: { nazevObce: "Kožlí", nazevCastiObce: "Kožlí", cisloDomovni: 12, psc: 58401 },
      }),
    ).toMatchObject({ street: "Kožlí 12", city: "Kožlí", zip: "584 01" });
    expect(
      mapAresSubject({
        obchodniJmeno: "Firma",
        sidlo: { textovaAdresa: "Dlouhá 5, 11000 Praha 1" },
      }),
    ).toMatchObject({ street: "Dlouhá 5", city: "Praha 1", zip: "110 00" });
  });

  it("rozliší neplatné IČO, nenalezený subjekt a výpadek", async () => {
    await expect(fetchAresCompany("12345678")).rejects.toMatchObject({ kind: "invalid" });
    const notFound = vi.fn(async () => new Response("{}", { status: 404 }));
    await expect(fetchAresCompany("27082440", { fetchImpl: notFound })).rejects.toMatchObject({
      kind: "not_found",
    });
    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchAresCompany("27082440", { fetchImpl: offline })).rejects.toBeInstanceOf(AresError);
    const ok = vi.fn(
      async () =>
        new Response(JSON.stringify({ ico: "27082440", obchodniJmeno: "Alza.cz a.s.", sidlo: {} }), {
          status: 200,
        }),
    );
    const company = await fetchAresCompany("27082440", { fetchImpl: ok });
    expect(company.name).toBe("Alza.cz a.s.");
    expect(ok).toHaveBeenCalledWith(
      "https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty/27082440",
      expect.any(Object),
    );
  });
});
