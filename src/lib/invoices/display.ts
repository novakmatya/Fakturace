import { LIFECYCLE_LABEL, type LifecycleStatus } from "@/lib/invoices/types";

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

/** Prisma `include` pro počet úspěšně odeslaných e-mailů s fakturou. */
export const SENT_EMAILS_COUNT = {
  _count: { select: { emails: { where: { kind: "INVOICE", status: "SENT" } } } },
} as const;

/**
 * Zobrazovaný stav. Ukládá se jen životní cyklus (koncept → vystavena → stornována);
 * „odeslána“ se odvozuje z logu e-mailů, uhrazena / po splatnosti z úhrad (krok 5).
 */
export function invoiceStatusBadge(invoice: {
  status: string;
  _count?: { emails?: number };
}): { label: string; tone: Tone } {
  const status = invoice.status as LifecycleStatus;
  switch (status) {
    case "KONCEPT":
      return { label: LIFECYCLE_LABEL.KONCEPT, tone: "neutral" };
    case "VYSTAVENA":
      return (invoice._count?.emails ?? 0) > 0
        ? { label: "Odeslána", tone: "accent" }
        : { label: LIFECYCLE_LABEL.VYSTAVENA, tone: "warn" };
    case "STORNOVANA":
      return { label: LIFECYCLE_LABEL.STORNOVANA, tone: "danger" };
    default:
      return { label: invoice.status, tone: "neutral" };
  }
}
