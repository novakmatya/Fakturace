import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Card, CardTitle, PageHeader } from "@/components/ui";
import { listCustomers } from "@/lib/customers";
import { prisma } from "@/lib/db";
import { formatCzDate, todayPrague, yearOf } from "@/lib/dates";
import { formatCzk } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { listIncomeSources } from "@/lib/settings";
import { ImportForm, SeriesStartForm } from "./import-form";

export const metadata: Metadata = { title: "Převzít starší faktury" };

export default async function ImportPage() {
  await requireUser();
  const year = yearOf(todayPrague());
  const [customers, sources, imported, series] = await Promise.all([
    listCustomers(),
    listIncomeSources(),
    prisma.invoice.findMany({
      where: { origin: "IMPORT" },
      orderBy: { issueDate: "asc" },
      include: { payments: { where: { cancelledAt: null } }, customer: { select: { name: true } } },
    }),
    prisma.numberSeries.findUnique({ where: { docType_year: { docType: "FAKTURA", year } } }),
  ]);
  const activeCustomers = customers.filter((c) => !c.archived);
  const activeSources = sources.filter((s) => !s.archived);
  const last = imported.at(-1);
  const suggestedNext = imported.filter((i) => i.issueDate.startsWith(String(year))).length + 1;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/faktury">Faktury</Link>}
        title="Převzít starší faktury"
        description="Faktury vystavené dřív jinde. Uloží se s původním číslem a datem úhrady, takže daňový přehled bude za celý rok úplný."
      />
      {activeCustomers.length === 0 || activeSources.length === 0 ? (
        <Alert tone="warn">
          Nejdřív založte <Link href="/odberatele/novy" className="underline">odběratele</Link> a{" "}
          <Link href="/nastaveni/cinnosti" className="underline">činnost</Link>.
        </Alert>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Card>
            <CardTitle hint="Po uložení se formulář předvyplní na další měsíc – stačí upravit částku a datum úhrady.">
              Faktura
            </CardTitle>
            <ImportForm
              customers={activeCustomers.map((c) => ({ id: c.id, name: c.name }))}
              sources={activeSources.map((s) => ({ id: s.id, name: s.name, section: s.section }))}
              initial={{
                customerId: last?.customerId ?? activeCustomers[0].id,
                incomeSourceId: last?.incomeSourceId ?? activeSources[0].id,
                number: "",
                issueDate: "",
                dueDate: "",
                amount: "",
                description: "",
                paidOn: "",
              }}
            />
          </Card>
          <div className="space-y-6">
            <Card>
              <CardTitle>Převzato ({imported.length})</CardTitle>
              {imported.length === 0 ? (
                <p className="text-sm text-muted">Zatím nic.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {imported.map((inv) => (
                    <li key={inv.id} className="flex items-center justify-between gap-3 py-2">
                      <Link href={`/faktury/${inv.id}`} className="hover:text-accent">
                        {inv.number} · {formatCzDate(inv.issueDate)}
                      </Link>
                      <span className="tabular">
                        {formatCzk(inv.amountDueHalere)}
                        {inv.payments.length === 0 ? <span className="ml-1 text-[13px] text-danger">neuhr.</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card>
              <CardTitle hint="Ať číslování v aplikaci plynule naváže na faktury vystavené dřív.">Číslování v aplikaci</CardTitle>
              {series ? (
                <p className="text-sm text-muted">
                  Řada {year} už běží – další faktura bude {year}
                  {String(series.lastNumber + 1).padStart(4, "0")}.
                </p>
              ) : (
                <SeriesStartForm year={year} suggested={suggestedNext} />
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
