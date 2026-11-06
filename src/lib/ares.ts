import { env } from "@/env";
import { isValidIco, normalizeDic, normalizeIco } from "@/lib/ico";

/**
 * ARES – Administrativní registr ekonomických subjektů (MF ČR), veřejné REST API bez klíče.
 * GET {ARES_BASE_URL}/{ičo}. Data slouží jen k předvyplnění formuláře; uživatel je potvrdí.
 */
export type AresCompany = {
  ico: string;
  name: string;
  dic: string | null;
  street: string;
  city: string;
  zip: string;
  country: string;
  textAddress: string | null;
  raw: unknown;
};

export class AresError extends Error {
  constructor(
    message: string,
    readonly kind: "invalid" | "not_found" | "unavailable",
  ) {
    super(message);
  }
}

type AresAddress = {
  kodStatu?: string;
  nazevObce?: string;
  nazevCastiObce?: string;
  nazevMestskehoObvodu?: string;
  nazevMestskeCastiObvodu?: string;
  nazevUlice?: string;
  cisloDomovni?: number | string;
  cisloOrientacni?: number | string;
  cisloOrientacniPismeno?: string;
  psc?: number | string;
  textovaAdresa?: string;
};

type AresSubject = {
  ico?: string;
  obchodniJmeno?: string;
  dic?: string;
  sidlo?: AresAddress;
};

function formatZip(value: number | string | undefined): string {
  const raw = String(value ?? "").replace(/\D/g, "");
  if (!raw) return "";
  const digits = raw.padStart(5, "0");
  return digits.length === 5 ? `${digits.slice(0, 3)} ${digits.slice(3)}` : "";
}

/** Převede odpověď ARES na adresu ve tvaru pro fakturu. Snese chybějící pole. */
export function mapAresSubject(json: AresSubject): AresCompany {
  const s = json.sidlo ?? {};
  const house = s.cisloDomovni ? String(s.cisloDomovni) : "";
  const orientation = s.cisloOrientacni ? `${s.cisloOrientacni}${s.cisloOrientacniPismeno ?? ""}` : "";
  const number = house && orientation ? `${house}/${orientation}` : house || orientation;
  const streetName = s.nazevUlice ?? s.nazevCastiObce ?? s.nazevObce ?? "";
  let street = [streetName, number].filter(Boolean).join(" ");
  let city =
    s.nazevObce === "Praha" && s.nazevMestskehoObvodu ? s.nazevMestskehoObvodu : (s.nazevObce ?? "");
  let zip = formatZip(s.psc);

  // Záloha: rozpad textové adresy "Ulice 1/2, Část, 11000 Praha 1".
  if ((!street || !city || !zip) && s.textovaAdresa) {
    const parts = s.textovaAdresa.split(",").map((p) => p.trim());
    const last = parts.at(-1) ?? "";
    const match = last.match(/^(\d{3}\s?\d{2})\s+(.+)$/);
    if (!street && parts.length > 1) street = parts[0];
    if (match) {
      if (!zip) zip = formatZip(match[1]);
      if (!city) city = match[2];
    }
  }

  return {
    ico: normalizeIco(json.ico ?? "") ?? "",
    name: (json.obchodniJmeno ?? "").trim(),
    dic: json.dic ? normalizeDic(json.dic) : null,
    street,
    city,
    zip,
    country: (s.kodStatu ?? "CZ").toUpperCase(),
    textAddress: s.textovaAdresa ?? null,
    raw: json,
  };
}

export async function fetchAresCompany(
  icoInput: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<AresCompany> {
  const ico = normalizeIco(icoInput);
  if (!ico || !isValidIco(ico)) throw new AresError("IČO nemá platný kontrolní součet.", "invalid");
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${env.ARES_BASE_URL}/${ico}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
      cache: "no-store",
    });
  } catch {
    throw new AresError("ARES teď neodpovídá. Údaje zadejte ručně nebo to zkuste později.", "unavailable");
  }
  if (response.status === 404) throw new AresError("Subjekt s tímto IČO v ARES není.", "not_found");
  if (!response.ok) {
    throw new AresError(`ARES vrátil chybu ${response.status}. Zkuste to později.`, "unavailable");
  }
  const company = mapAresSubject((await response.json()) as AresSubject);
  if (!company.name) throw new AresError("ARES nevrátil název subjektu.", "unavailable");
  return company;
}
