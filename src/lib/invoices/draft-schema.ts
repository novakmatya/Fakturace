import { z } from "zod";
import { isIsoDate } from "@/lib/dates";
import { parseCzkInput, parseQuantityInput } from "@/lib/money";

const isoDate = (label: string) =>
  z.string().trim().refine(isIsoDate, `${label}: zadejte platné datum.`);

const optionalDigits = (label: string) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null)
    .refine((v) => v === null || /^\d{1,10}$/.test(v), `${label}: 1 až 10 číslic.`);

export const lineInputSchema = z.object({
  description: z.string().trim().min(1, "Zadejte popis položky.").max(300, "Popis je příliš dlouhý."),
  quantity: z
    .string()
    .trim()
    .transform((v) => parseQuantityInput(v))
    .refine((v): v is number => v !== null, "Množství musí být kladné (max. 3 desetinná místa)."),
  unit: z
    .string()
    .trim()
    .max(12, "Jednotka max. 12 znaků.")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .default(null),
  unitPrice: z
    .string()
    .trim()
    .transform((v) => parseCzkInput(v))
    .refine((v): v is number => v !== null, "Zadejte cenu (max. 2 desetinná místa)."),
  kind: z.enum(["STANDARD", "SERVICE_ADVANCE"]).default("STANDARD"),
});

export const draftSchema = z
  .object({
    customerId: z.string().trim().min(1, "Vyberte odběratele."),
    incomeSourceId: z.string().trim().min(1, "Vyberte činnost."),
    issueDate: isoDate("Datum vystavení"),
    dueDate: isoDate("Datum splatnosti"),
    supplyDate: z
      .string()
      .trim()
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null)
      .refine((v) => v === null || isIsoDate(v), "Datum plnění: zadejte platné datum."),
    paymentMethod: z.enum(["PREVOD", "HOTOVOST"]).default("PREVOD"),
    constantSymbol: optionalDigits("Konstantní symbol"),
    specificSymbol: optionalDigits("Specifický symbol"),
    note: z
      .string()
      .trim()
      .max(500, "Poznámka max. 500 znaků.")
      .transform((v) => (v === "" ? null : v))
      .nullable()
      .default(null),
    lines: z
      .array(lineInputSchema)
      .min(1, "Faktura potřebuje alespoň jednu položku.")
      .max(100, "Nejvýše 100 položek."),
  })
  .refine((d) => d.dueDate >= d.issueDate, {
    path: ["dueDate"],
    message: "Splatnost nemůže být dřív než vystavení.",
  });

export type DraftInput = z.input<typeof draftSchema>;
export type DraftData = z.output<typeof draftSchema>;
