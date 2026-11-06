import { LIFECYCLE_LABEL, type LifecycleStatus } from "@/lib/invoices/types";

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

/**
 * Zobrazovaný stav. Ukládá se jen životní cyklus (koncept → vystavena → stornována);
 * odeslána / uhrazena / po splatnosti se budou odvozovat z e-mailů a úhrad (kroky 4 a 5).
 */
export function invoiceStatusBadge(invoice: { status: string }): { label: string; tone: Tone } {
  const status = invoice.status as LifecycleStatus;
  switch (status) {
    case "KONCEPT":
      return { label: LIFECYCLE_LABEL.KONCEPT, tone: "neutral" };
    case "VYSTAVENA":
      return { label: LIFECYCLE_LABEL.VYSTAVENA, tone: "accent" };
    case "STORNOVANA":
      return { label: LIFECYCLE_LABEL.STORNOVANA, tone: "danger" };
    default:
      return { label: invoice.status, tone: "neutral" };
  }
}
