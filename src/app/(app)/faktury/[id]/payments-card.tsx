import { Card, CardTitle, cx } from "@/components/ui";
import { formatCzDate, formatCzDateTime } from "@/lib/dates";
import { formatCzk } from "@/lib/money";
import { PAYMENT_METHOD_SHORT, paymentSummary } from "@/lib/payments/service";
import { payInFullTodayAction } from "../payment-actions";
import { CancelPaymentForm, PaymentForm } from "./payment-forms";

type PaymentRow = {
  id: string;
  paidOn: string;
  amountHalere: number;
  method: string;
  source: string;
  note: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
};

/** Částka v haléřích → text do formuláře („1500,50“). */
function amountInput(halere: number): string {
  return (halere / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");
}

export function PaymentsCard({
  invoice,
  payments,
  today,
  canRecord,
}: {
  invoice: { id: string; amountDueHalere: number; paymentMethod: string };
  payments: PaymentRow[];
  today: string;
  canRecord: boolean;
}) {
  const summary = paymentSummary(invoice, payments);
  return (
    <Card>
      <CardTitle hint="Datum úhrady rozhoduje, do kterého roku příjem patří (peněžní princip).">Úhrady</CardTitle>

      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 rounded-lg bg-panel px-4 py-3 text-sm">
        <span>
          Uhrazeno <span className="tabular font-medium">{formatCzk(summary.paidHalere)}</span> z{" "}
          <span className="tabular">{formatCzk(invoice.amountDueHalere)}</span>
        </span>
        {summary.fullyPaid ? (
          <span className="font-medium text-ok">
            {summary.overpaidHalere > 0 ? `Přeplaceno o ${formatCzk(summary.overpaidHalere)}` : "Uhrazeno v plné výši"}
          </span>
        ) : (
          <span>
            zbývá <span className="tabular font-semibold">{formatCzk(summary.remainingHalere)}</span>
          </span>
        )}
      </div>

      {payments.length > 0 ? (
        <ul className="mb-4 divide-y divide-line text-sm">
          {payments.map((p) => {
            const cancelled = p.cancelledAt !== null;
            return (
              <li key={p.id} className="py-2.5">
                <div className={cx("flex flex-wrap items-center gap-x-3 gap-y-1", cancelled && "text-muted line-through")}>
                  <span className="tabular w-24">{formatCzDate(p.paidOn)}</span>
                  <span className="tabular font-medium">{formatCzk(p.amountHalere)}</span>
                  <span className="text-muted">{PAYMENT_METHOD_SHORT[p.method] ?? p.method}</span>
                  {p.source === "BANK_IMPORT" ? <span className="text-[13px] text-muted">z výpisu</span> : null}
                  {p.note ? <span className="min-w-0 flex-1 truncate text-muted">{p.note}</span> : null}
                </div>
                {cancelled ? (
                  <p className="mt-1 text-[13px] text-muted">
                    Stornováno {formatCzDateTime(p.cancelledAt!)}: {p.cancelReason}
                  </p>
                ) : canRecord ? (
                  <div className="mt-1">
                    <CancelPaymentForm invoiceId={invoice.id} paymentId={p.id} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      {canRecord && !summary.fullyPaid ? (
        <div className="space-y-4">
          <form action={payInFullTodayAction}>
            <input type="hidden" name="invoiceId" value={invoice.id} />
            <button
              type="submit"
              className="h-10 w-full rounded-lg border border-ok/30 bg-ok-soft px-4 text-sm font-medium text-ok hover:border-ok/50"
            >
              Uhrazeno dnes – {formatCzk(summary.remainingHalere)}
            </button>
          </form>
          <details className="rounded-lg border border-line">
            <summary className="cursor-pointer px-4 py-3 text-sm font-medium">Jiná částka nebo datum</summary>
            <div className="border-t border-line p-4">
              <PaymentForm
                invoiceId={invoice.id}
                defaultDate={today}
                defaultAmount={amountInput(summary.remainingHalere)}
                defaultMethod={invoice.paymentMethod === "HOTOVOST" ? "HOTOVOST" : "PREVOD"}
              />
            </div>
          </details>
        </div>
      ) : null}
    </Card>
  );
}
