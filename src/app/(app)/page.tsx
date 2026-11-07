import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, CardTitle, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { daysBetween, formatCzDate, todayPrague, yearOf } from "@/lib/dates";
import { failedEmailCount } from "@/lib/email/outbox";
import { displayStatus, invoiceStatusBadge, paidHalere, STATUS_INCLUDE } from "@/lib/invoices/display";
import { formatCzk } from "@/lib/money";
import { cashIncome } from "@/lib/payments/income";
import { requireUser } from "@/lib/session";
import { czPlural } from "@/lib/text";

export const metadata: Metadata = { title: "Přehled" };

function Stat({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  return (
    <Card>
      <p className="label-caps">{label}</p>
      <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{value}</p>
      {children ? <div className="mt-1 text-sm text-muted">{children}</div> : null}
    </Card>
  );
}

export default async function DashboardPage() {
  const session = await requireUser();
  const today = todayPrague();
  const year = yearOf(today);
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [supplier, sourceCount, customerCount, issued, drafts, recent, open, income, failedEmails] = await Promise.all([
    prisma.supplierProfile.findUnique({ where: { id: 1 }, select: { id: true } }),
    prisma.incomeSource.count({ where: { archived: false } }),
    prisma.customer.count({ where: { archived: false } }),
    prisma.invoice.aggregate({
      where: { type: "FAKTURA", status: "VYSTAVENA", issueDate: { gte: from, lte: to } },
      _count: true,
      _sum: { amountDueHalere: true },
    }),
    prisma.invoice.count({ where: { status: "KONCEPT" } }),
    prisma.invoice.findMany({
      orderBy: [{ updatedAt: "desc" }],
      take: 6,
      include: { customer: { select: { name: true } }, ...STATUS_INCLUDE },
    }),
    prisma.invoice.findMany({
      where: { type: "FAKTURA", status: "VYSTAVENA" },
      orderBy: { dueDate: "asc" },
      include: { customer: { select: { name: true } }, ...STATUS_INCLUDE },
    }),
    cashIncome(year),
    failedEmailCount(14),
  ]);

  const unpaid = open
    .map((inv) => ({ inv, status: displayStatus(inv, today), remaining: inv.amountDueHalere - paidHalere(inv) }))
    .filter((x) => x.status !== "UHRAZENA" && x.remaining > 0);
  const outstanding = unpaid.reduce((sum, x) => sum + x.remaining, 0);
  const overdue = unpaid.filter((x) => x.status === "PO_SPLATNOSTI");
  const overdueSum = overdue.reduce((sum, x) => sum + x.remaining, 0);
  const unsent = unpaid.filter((x) => x.status === "VYSTAVENA").length;

  const steps = [
    { done: supplier !== null, label: "Vyplnit údaje dodavatele", href: "/nastaveni" },
    { done: sourceCount > 0, label: "Přidat činnost (§ 7 nebo § 9)", href: "/nastaveni/cinnosti" },
    { done: customerCount > 0, label: "Přidat odběratele", href: "/odberatele/novy" },
    { done: issued._count > 0 || open.length > 0, label: "Vystavit první fakturu", href: "/faktury/nova" },
  ];
  const setupDone = steps.every((s) => s.done);
  const firstName = session.user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`Dobrý den, ${firstName}`}
        description={`Přehled roku ${year}.`}
        actions={<ButtonLink href="/faktury/nova">Nová faktura</ButtonLink>}
      />

      {failedEmails > 0 ? (
        <div className="mb-6">
          <Alert tone="danger">
            {failedEmails} {czPlural(failedEmails, "e-mail se", "e-maily se", "e-mailů se")} za posledních 14 dní
            nepodařilo odeslat. Důvod a nové odeslání najdete v detailu faktury v sekci E-maily.
          </Alert>
        </div>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label={`Přijato ${year}`} value={formatCzk(income.totalHalere)}>
          <p>
            § 7: <span className="tabular">{formatCzk(income.bySection.S7)}</span> · § 9:{" "}
            <span className="tabular">{formatCzk(income.bySection.S9)}</span>
          </p>
          <p className="text-[13px]">příjmy podle data úhrady (peněžní princip)</p>
        </Stat>
        <Stat label="K úhradě" value={formatCzk(outstanding)}>
          {overdue.length > 0 ? (
            <Link href="/faktury?stav=PO_SPLATNOSTI" className="text-danger underline-offset-4 hover:underline">
              {overdue.length} po splatnosti ({formatCzk(overdueSum)})
            </Link>
          ) : (
            <p>{unpaid.length > 0 ? "nic po splatnosti" : "vše uhrazeno"}</p>
          )}
        </Stat>
        <Stat label={`Vystaveno ${year}`} value={formatCzk(issued._sum.amountDueHalere ?? 0)}>
          <p>
            {issued._count} {czPlural(issued._count, "faktura", "faktury", "faktur")} podle data vystavení
          </p>
        </Stat>
        <Stat label="Rozpracované" value={String(drafts)}>
          <p>
            {czPlural(drafts, "koncept čeká", "koncepty čekají", "konceptů čeká")} na vystavení
            {unsent > 0 ? (
              <>
                {" · "}
                <Link href="/faktury?stav=NEODESLANA" className="text-accent underline-offset-4 hover:underline">
                  {unsent} k odeslání
                </Link>
              </>
            ) : null}
          </p>
        </Stat>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card>
          <CardTitle>Poslední doklady</CardTitle>
          {recent.length === 0 ? (
            <p className="text-sm text-muted">Zatím žádné doklady.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {recent.map((inv) => {
                const badge = invoiceStatusBadge(inv, today);
                return (
                  <li key={inv.id} className="flex items-center gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/faktury/${inv.id}`} className="font-medium hover:text-accent">
                        {inv.number ?? "Koncept"} · {inv.customer.name}
                      </Link>
                      <p className="text-[13px] text-muted">vystaveno {formatCzDate(inv.issueDate)}</p>
                    </div>
                    <span className="tabular font-medium">{formatCzk(inv.amountDueHalere)}</span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {!setupDone ? (
          <Card>
            <CardTitle hint="Čtyři kroky k první faktuře.">Začínáme</CardTitle>
            <ol className="space-y-3 text-sm">
              {steps.map((step, i) => (
                <li key={step.href} className="flex items-center gap-3">
                  <span
                    className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                      step.done ? "bg-ok-soft text-ok" : "bg-panel text-muted"
                    }`}
                  >
                    {step.done ? "✓" : i + 1}
                  </span>
                  {step.done ? (
                    <span className="text-muted line-through decoration-line">{step.label}</span>
                  ) : (
                    <Link href={step.href} className="font-medium text-accent hover:underline">
                      {step.label}
                    </Link>
                  )}
                </li>
              ))}
            </ol>
          </Card>
        ) : (
          <Card>
            <CardTitle hint="Nejdéle neuhrazené nahoře.">Po splatnosti</CardTitle>
            {overdue.length === 0 ? (
              <p className="text-sm text-muted">Žádná faktura není po splatnosti.</p>
            ) : (
              <ul className="divide-y divide-line text-sm">
                {overdue.slice(0, 6).map(({ inv, remaining }) => {
                  const days = daysBetween(inv.dueDate, today);
                  return (
                    <li key={inv.id} className="flex items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <Link href={`/faktury/${inv.id}`} className="font-medium hover:text-accent">
                          {inv.number} · {inv.customer.name}
                        </Link>
                        <p className="text-[13px] text-danger">
                          {days} {czPlural(days, "den", "dny", "dní")} po splatnosti
                        </p>
                      </div>
                      <span className="tabular font-medium">{formatCzk(remaining)}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
