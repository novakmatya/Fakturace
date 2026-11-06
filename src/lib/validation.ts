import { z } from "zod";
import { czAccountToIban, formatCzAccount, isValidIban, normalizeIban, parseCzAccount } from "@/lib/bank";
import { isValidIco, normalizeDic, normalizeIco } from "@/lib/ico";

export type FieldErrors = Record<string, string>;
export type ActionResult<T = undefined> =
  | { ok: true; data?: T; message?: string }
  | { ok: false; error?: string; fieldErrors?: FieldErrors };

export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".");
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Maximálně ${max} znaků.`)
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null);

export const czZip = z
  .string()
  .trim()
  .transform((v) => v.replace(/\s/g, ""))
  .refine((v) => /^\d{5}$/.test(v), "PSČ má 5 číslic.")
  .transform((v) => `${v.slice(0, 3)} ${v.slice(3)}`);

const icoField = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .default(null)
  .refine((v) => v === null || isValidIco(v), "IČO nemá platný kontrolní součet.")
  .transform((v) => (v === null ? null : normalizeIco(v)));

const dicField = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v))
  .nullable()
  .default(null)
  .refine((v) => v === null || normalizeDic(v) !== null, "DIČ má tvar CZ12345678.")
  .transform((v) => (v === null ? null : normalizeDic(v)));

const emailField = z
  .string()
  .trim()
  .transform((v) => (v === "" ? null : v.toLowerCase()))
  .nullable()
  .default(null)
  .refine((v) => v === null || z.email().safeParse(v).success, "Neplatný e-mail.");

const emailListField = z
  .string()
  .trim()
  .transform((v) =>
    v === ""
      ? null
      : v
          .split(/[,;\s]+/)
          .filter(Boolean)
          .map((e) => e.toLowerCase())
          .join(", "),
  )
  .nullable()
  .default(null)
  .refine(
    (v) => v === null || v.split(", ").every((e) => z.email().safeParse(e).success),
    "Neplatný e-mail v kopii.",
  );

const countryField = z
  .string()
  .trim()
  .toUpperCase()
  .default("CZ")
  .refine((v) => /^[A-Z]{2}$/.test(v), "Kód státu má dvě písmena (CZ, SK…).");

const dueDaysField = z.coerce
  .number({ error: "Zadejte počet dní." })
  .int("Celé číslo.")
  .min(0, "Nejméně 0 dní.")
  .max(365, "Nejvýše 365 dní.");

export const supplierSchema = z
  .object({
    name: z.string().trim().min(2, "Zadejte jméno nebo název.").max(120),
    street: z.string().trim().min(2, "Zadejte ulici a číslo.").max(120),
    city: z.string().trim().min(2, "Zadejte obec.").max(80),
    zip: czZip,
    country: countryField,
    ico: icoField,
    dic: dicField,
    bankAccount: z.string().trim().min(1, "Zadejte číslo účtu."),
    iban: z.string().trim().default(""),
    bic: optionalText(11),
    registerText: optionalText(200),
    email: emailField,
    phone: optionalText(40),
    web: optionalText(120),
    defaultDueDays: dueDaysField,
    vatNote: z.string().trim().min(1, "Text o DPH je povinný.").max(120).default("Nejsem plátce DPH."),
    footerText: optionalText(300),
  })
  .transform((data, ctx) => {
    const account = parseCzAccount(data.bankAccount);
    if (!account) {
      ctx.addIssue({
        code: "custom",
        path: ["bankAccount"],
        message: "Neplatné číslo účtu (tvar 123456789/0100, kontrolní součet ČNB).",
      });
      return z.NEVER;
    }
    const computed = czAccountToIban(account);
    const given = data.iban ? normalizeIban(data.iban) : computed;
    if (!isValidIban(given)) {
      ctx.addIssue({ code: "custom", path: ["iban"], message: "Neplatný IBAN." });
      return z.NEVER;
    }
    if (given !== computed) {
      ctx.addIssue({ code: "custom", path: ["iban"], message: "IBAN neodpovídá číslu účtu." });
      return z.NEVER;
    }
    return { ...data, bankAccount: formatCzAccount(account), iban: computed };
  });

export type SupplierInput = z.input<typeof supplierSchema>;
export type SupplierData = z.output<typeof supplierSchema>;

export const PAUSAL_CATEGORIES = {
  P80: "80 % – řemeslné živnosti, zemědělství",
  P60: "60 % – ostatní živnosti",
  P40: "40 % – jiné podnikání (svobodná povolání), autorská práva",
  P30: "30 % – nájem majetku v obchodním majetku",
} as const;

export type PausalCategory = keyof typeof PAUSAL_CATEGORIES;

export const incomeSourceSchema = z
  .object({
    name: z.string().trim().min(2, "Zadejte název činnosti.").max(80),
    section: z.enum(["S7", "S9"], { error: "Vyberte paragraf." }),
    pausalCategory: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null),
    shareNumerator: z.coerce.number().int().min(1, "Nejméně 1."),
    shareDenominator: z.coerce.number().int().min(1, "Nejméně 1."),
    printIco: z.coerce.boolean().default(false),
    printRegisterText: z.coerce.boolean().default(false),
  })
  .superRefine((data, ctx) => {
    if (data.section === "S7" && !(data.pausalCategory && data.pausalCategory in PAUSAL_CATEGORIES)) {
      ctx.addIssue({ code: "custom", path: ["pausalCategory"], message: "U § 7 vyberte kategorii paušálu." });
    }
    if (data.shareNumerator > data.shareDenominator) {
      ctx.addIssue({ code: "custom", path: ["shareNumerator"], message: "Podíl nemůže být větší než celek." });
    }
  })
  .transform((data) => ({
    ...data,
    pausalCategory: data.section === "S7" ? data.pausalCategory : null,
  }));

export type IncomeSourceData = z.output<typeof incomeSourceSchema>;

export const customerSchema = z
  .object({
    kind: z.enum(["BUSINESS", "PERSON"], { error: "Vyberte typ odběratele." }),
    name: z.string().trim().min(2, "Zadejte název nebo jméno.").max(160),
    street: z.string().trim().min(2, "Zadejte ulici a číslo.").max(120),
    city: z.string().trim().min(2, "Zadejte obec.").max(80),
    zip: z.string().trim().min(3, "Zadejte PSČ.").max(12),
    country: countryField,
    ico: icoField,
    dic: dicField,
    email: emailField,
    emailCc: emailListField,
    defaultIncomeSourceId: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null),
    defaultDueDays: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : Number(v)))
      .nullable()
      .default(null)
      .refine((v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 365), "0 až 365 dní."),
    remindersEnabled: z.coerce.boolean().default(false),
    note: optionalText(500),
  })
  .transform((data, ctx) => {
    let zip = data.zip;
    if (data.country === "CZ") {
      const parsed = czZip.safeParse(zip);
      if (!parsed.success) {
        ctx.addIssue({ code: "custom", path: ["zip"], message: "PSČ má 5 číslic." });
        return z.NEVER;
      }
      zip = parsed.data;
    }
    if (data.kind === "BUSINESS" && data.country === "CZ" && !data.ico) {
      ctx.addIssue({ code: "custom", path: ["ico"], message: "U české firmy nebo podnikatele zadejte IČO." });
      return z.NEVER;
    }
    return { ...data, zip };
  });

export type CustomerData = z.output<typeof customerSchema>;
