import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, EmptyState, inputClass, PageHeader } from "@/components/ui";
import { formatCzDate, todayPrague, yearOf } from "@/lib/dates";
import { invoiceStatusBadge } from "@/lib/invoices/display";
import { listInvoices } from "@/lib/invoices/service";
import { formatCzk } from "@/lib/money";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Faktury" };

const STATUSES = [
  { value: "", label: "Všechny stavy" },
  { value: "KONCEPT", label: "Koncepty" },
  { value: "VYSTAVENA", label: "Vystavené" },
  { value: "STORNOVANA", label: "Stornované" },
];

export default async function InvoicesPage({ searchParams }: PageProps<"/faktury">) {
  await requireUser();
  const query = await searchParams;
  const currentYear = yearOf(todayPrague());
  const year = Number(query.rok) || currentYear;
  const status = typeof query.stav === "string" && STATUSES.some((s) => s.value === query.stav) ? query.stav : "";
  const invoices = await listInvoices({ year, status: status || undefined });
  const years = Array.from({ length: 6 }, (_, i) => currentYear + 1 - i);
  const issuedTotal = invoices
    .filter((i) => i.status === "VYSTAVENA" && i.type === "FAKTURA")
    .reduce((sum, i) => sum + i.amountDueHalere, 0);

  return (
    <>
      <PageHeader
        title="Faktury"
        description="Vystavené doklady jsou neměnné. Opravu nebo storno řeší dobropis."
        actions={<ButtonLink href="/faktury/nova">Nová faktura</ButtonLink>}
      />
      {query.smazano ? (
        <div className="mb-6">
          <Alert tone="ok">Koncept byl smazán.</Alert>
        </div>
      ) : null}

      <form className="mb-5 flex flex-wrap items-center gap-3" method="get">
        <select name="rok" defaultValue={String(year)} className={`${inputClass} w-auto`} aria-label="Rok">
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <select name="stav" defaultValue={status} className={`${inputClass} w-auto`} aria-label="Stav">
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="submit" className="h-10 rounded-lg border border-line bg-surface px-4 text-sm hover:bg-panel">
          Filtrovat
        </button>
        <p className="ml-auto text-sm text-muted">
          Vystaveno za {year}: <span className="tabular font-medium text-ink">{formatCzk(issuedTotal)}</span>
        </p>
      </form>

      {invoices.length === 0 ? (
        <EmptyState title="Žádné doklady" action={<ButtonLink href="/faktury/nova">Vystavit fakturu</ButtonLink>}>
          Pro zvolený rok a stav tu nic není.
        </EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-panel/60 text-left">
              <tr>
                <th className="label-caps px-4 py-2.5">Číslo</th>
                <th className="label-caps px-4 py-2.5">Odběratel</th>
                <th className="label-caps hidden px-4 py-2.5 sm:table-cell">Vystaveno</th>
                <th className="label-caps hidden px-4 py-2.5 md:table-cell">Splatnost</th>
                <th className="label-caps px-4 py-2.5 text-right">Částka</th>
                <th className="label-caps hidden px-4 py-2.5 sm:table-cell">Stav</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {invoices.map((inv) => {
                const badge = invoiceStatusBadge(inv);
                return (
                  <tr key={inv.id} className="hover:bg-panel/50">
                    <td className="tabular px-4 py-3">
                      <Link href={`/faktury/${inv.id}`} className="font-medium text-ink hover:text-accent">
                        {inv.number ?? "Koncept"}
                      </Link>
                      {inv.type === "DOBROPIS" ? <span className="ml-2 text-[13px] text-muted">dobropis</span> : null}
                    </td>
                    <td className="px-4 py-3">{inv.customer.name}</td>
                    <td className="tabular hidden px-4 py-3 text-muted sm:table-cell">{formatCzDate(inv.issueDate)}</td>
                    <td className="tabular hidden px-4 py-3 text-muted md:table-cell">{formatCzDate(inv.dueDate)}</td>
                    <td className="tabular px-4 py-3 text-right font-medium">{formatCzk(inv.amountDueHalere)}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
