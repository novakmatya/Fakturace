import { LIFECYCLE_LABEL, type LifecycleStatus } from "@/lib/invoices/types";

type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

/** Prisma `include` pro výpočet zobrazovaného stavu (odeslání a úhrady). */
export const STATUS_INCLUDE = {
  _count: { select: { emails: { where: { kind: "INVOICE", status: "SENT" } } } },
  payments: { where: { cancelledAt: null }, select: { amountHalere: true } },
} as const;

export type DisplayStatus =
  | "KONCEPT"
  | "VYSTAVENA"
  | "ODESLANA"
  | "CASTECNE_UHRAZENA"
  | "UHRAZENA"
  | "PO_SPLATNOSTI"
  | "STORNOVANA";

type StatusSource = {
  status: string;
  type?: string;
  dueDate?: string;
  amountDueHalere?: number;
  _count?: { emails?: number };
  payments?: { amountHalere: number }[];
};

/** Uhrazená částka z načtených (nestornovaných) úhrad. */
export function paidHalere(invoice: StatusSource): number {
  return (invoice.payments ?? []).reduce((sum, p) => sum + p.amountHalere, 0);
}

/**
 * Zobrazovaný stav. Ukládá se jen životní cyklus (koncept → vystavena → stornována);
 * odeslána se odvozuje z logu e-mailů, uhrazena / po splatnosti z úhrad a data.
 * Po splatnosti = den splatnosti už uplynul a faktura není plně uhrazená.
 */
export function displayStatus(invoice: StatusSource, today: string): DisplayStatus {
  const status = invoice.status as LifecycleStatus;
  if (status === "KONCEPT") return "KONCEPT";
  if (status === "STORNOVANA") return "STORNOVANA";
  const due = invoice.amountDueHalere ?? 0;
  const paid = paidHalere(invoice);
  if (invoice.type === "DOBROPIS") return (invoice._count?.emails ?? 0) > 0 ? "ODESLANA" : "VYSTAVENA";
  if (due > 0 && paid >= due) return "UHRAZENA";
  if (invoice.dueDate && invoice.dueDate < today) return "PO_SPLATNOSTI";
  if (paid > 0) return "CASTECNE_UHRAZENA";
  return (invoice._count?.emails ?? 0) > 0 ? "ODESLANA" : "VYSTAVENA";
}

const BADGES: Record<DisplayStatus, { label: string; tone: Tone }> = {
  KONCEPT: { label: LIFECYCLE_LABEL.KONCEPT, tone: "neutral" },
  VYSTAVENA: { label: LIFECYCLE_LABEL.VYSTAVENA, tone: "warn" },
  ODESLANA: { label: "Odeslána", tone: "accent" },
  CASTECNE_UHRAZENA: { label: "Částečně uhrazena", tone: "warn" },
  UHRAZENA: { label: "Uhrazena", tone: "ok" },
  PO_SPLATNOSTI: { label: "Po splatnosti", tone: "danger" },
  STORNOVANA: { label: LIFECYCLE_LABEL.STORNOVANA, tone: "neutral" },
};

export function statusBadge(status: DisplayStatus): { label: string; tone: Tone } {
  return BADGES[status];
}

/** Štítek stavu faktury pro seznamy a detail. */
export function invoiceStatusBadge(invoice: StatusSource, today: string): { label: string; tone: Tone } {
  return BADGES[displayStatus(invoice, today)];
}
