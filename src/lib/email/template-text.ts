// Čistá logika šablon (bez databáze) – používá ji server i editor v prohlížeči.

export const TEMPLATE_KEYS = ["INVOICE", "REMINDER"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];

export const TEMPLATE_LABEL: Record<TemplateKey, string> = {
  INVOICE: "Odeslání faktury",
  REMINDER: "Upomínka",
};

/** Proměnné, které lze v šabloně použít, s popisem a ukázkovou hodnotou pro náhled. */
export const PLACEHOLDERS = {
  cislo: { label: "číslo dokladu", sample: "20260001" },
  castka: { label: "částka k úhradě", sample: "12 100,00 Kč" },
  zbyva: { label: "zbývá uhradit (po započtení úhrad)", sample: "12 100,00 Kč" },
  dni_po_splatnosti: { label: "počet dní po splatnosti", sample: "9" },
  splatnost: { label: "datum splatnosti", sample: "21. 11. 2026" },
  datum_vystaveni: { label: "datum vystavení", sample: "7. 11. 2026" },
  vs: { label: "variabilní symbol", sample: "20260001" },
  ucet: { label: "číslo účtu", sample: "19-2000145399/0800" },
  iban: { label: "IBAN", sample: "CZ65 0800 0000 1920 0014 5399" },
  platebni_udaje: {
    label: "věta s platebními údaji (podle způsobu úhrady)",
    sample:
      "Platbu prosím pošlete na účet 19-2000145399/0800 s variabilním symbolem 20260001. Nejrychleji ji zadáte načtením QR kódu z faktury v bankovní aplikaci.",
  },
  odberatel: { label: "název odběratele", sample: "Žluťoučká s.r.o." },
  dodavatel: { label: "vaše jméno nebo firma", sample: "Jan Novák" },
  podpis: { label: "podpis s kontakty", sample: "Jan Novák\n+420 777 123 456\njan@example.cz" },
} as const;

export type PlaceholderName = keyof typeof PLACEHOLDERS;
export type TemplateVars = Record<PlaceholderName, string>;

export const DEFAULT_TEMPLATES: Record<TemplateKey, { subject: string; body: string }> = {
  REMINDER: {
    subject: "Upomínka – faktura č. {cislo}",
    body: [
      "Dobrý den,",
      "",
      "dovoluji si Vás upozornit, že faktura č. {cislo} se splatností {splatnost} dosud není uhrazena. Zbývá uhradit {zbyva}.",
      "",
      "{platebni_udaje}",
      "",
      "Pokud jste platbu mezitím odeslali, považujte prosím tento e-mail za bezpředmětný a děkuji za ni.",
      "",
      "S pozdravem",
      "",
      "{podpis}",
    ].join("\n"),
  },
  INVOICE: {
    subject: "Faktura č. {cislo} – {dodavatel}",
    body: [
      "Dobrý den,",
      "",
      "v příloze Vám zasílám fakturu č. {cislo} na částku {castka} se splatností {splatnost}.",
      "",
      "{platebni_udaje}",
      "",
      "Děkuji a přeji hezký den.",
      "",
      "S pozdravem",
      "",
      "{podpis}",
    ].join("\n"),
  },
};

export const SUBJECT_MAX = 200;
export const BODY_MAX = 10_000;

const PLACEHOLDER_RE = /\{([a-z_]+)\}/g;

export function findUnknownPlaceholders(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(PLACEHOLDER_RE)) {
    if (!(match[1] in PLACEHOLDERS)) unknown.add(match[1]);
  }
  return [...unknown];
}

export function renderTemplateText(text: string, vars: TemplateVars): string {
  return text.replace(PLACEHOLDER_RE, (whole, name: string) =>
    name in vars ? vars[name as PlaceholderName] : whole,
  );
}

export function sampleVars(): TemplateVars {
  return Object.fromEntries(Object.entries(PLACEHOLDERS).map(([k, v]) => [k, v.sample])) as TemplateVars;
}

export class TemplateError extends Error {}

export function validateTemplate(input: { subject: string; body: string }): { subject: string; body: string } {
  const subject = input.subject.replace(/[\r\n]+/g, " ").trim();
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!subject) throw new TemplateError("Předmět nesmí být prázdný.");
  if (!body) throw new TemplateError("Text e-mailu nesmí být prázdný.");
  if (subject.length > SUBJECT_MAX) throw new TemplateError(`Předmět může mít nejvýše ${SUBJECT_MAX} znaků.`);
  if (body.length > BODY_MAX) throw new TemplateError(`Text může mít nejvýše ${BODY_MAX} znaků.`);
  const unknown = findUnknownPlaceholders(`${subject}\n${body}`);
  if (unknown.length) {
    throw new TemplateError(`Neznámé proměnné: ${unknown.map((u) => `{${u}}`).join(", ")}.`);
  }
  return { subject, body };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Z prostého textu udělá střídmé HTML: odstavce, zalomení řádků, nic navíc.
 * Co uživatel napíše, to odběratel uvidí – jen v čistší typografii.
 */
export function textToHtml(text: string, title: string): string {
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
  const font =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";
  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f3ef;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f3ef;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e7e5df;border-top:3px solid #1f3a5f;border-radius:10px;">
<tr><td style="padding:36px 40px 24px;font-family:${font};font-size:15px;line-height:1.65;color:#1c1c1a;">
${paragraphs}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
