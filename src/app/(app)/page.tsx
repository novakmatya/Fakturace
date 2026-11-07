import type { Metadata } from "next";
import Link from "next/link";
import { Alert, Badge, ButtonLink, Card, CardTitle, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatCzDate, todayPrague, yearOf } from "@/lib/dates";
import { failedEmailCount } from "@/lib/email/outbox";
import { invoiceStatusBadge, SENT_EMAILS_COUNT } from "@/lib/invoices/display";
import { formatCzk } from "@/lib/money";
import { czPlural } from "@/lib/text";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Přehled" };

export default async function DashboardPage() {
  const session = await requireUser();
  const year = yearOf(todayPrague());
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const [supplier, sourceCount, customerCount, issued, drafts, recent, unsent, failedEmails] = await Promise.all([
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
      include: { customer: { select: { name: true } }, ...SENT_EMAILS_COUNT },
    }),
    prisma.invoice.count({
      where: { type: "FAKTURA", status: "VYSTAVENA", emails: { none: { kind: "INVOICE", status: "SENT" } } },
    }),
    failedEmailCount(14),
  ]);

  const steps = [
    { done: supplier !== null, label: "Vyplnit údaje dodavatele", href: "/nastaveni" },
    { done: sourceCount > 0, label: "Přidat činnost (§ 7 nebo § 9)", href: "/nastaveni/cinnosti" },
    { done: customerCount > 0, label: "Přidat odběratele", href: "/odberatele/novy" },
    { done: issued._count > 0, label: "Vystavit první fakturu", href: "/faktury/nova" },
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

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="label-caps">Vystaveno {year}</p>
          <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{formatCzk(issued._sum.amountDueHalere ?? 0)}</p>
          <p className="mt-1 text-sm text-muted">{issued._count} {czPlural(issued._count, "faktura", "faktury", "faktur")} podle data vystavení</p>
        </Card>
        <Card>
          <p className="label-caps">Rozpracované</p>
          <p className="tabular mt-2 text-2xl font-semibold tracking-tight">{drafts}</p>
          <p className="mt-1 text-sm text-muted">
            {czPlural(drafts, "koncept čeká", "koncepty čekají", "konceptů čeká")} na vystavení
            {unsent > 0 ? (
              <>
                {" · "}
                <Link href="/faktury?stav=NEODESLANA" className="text-accent underline-offset-4 hover:underline">
                  {unsent} {czPlural(unsent, "faktura", "faktury", "faktur")} k odeslání
                </Link>
              </>
            ) : null}
          </p>
        </Card>
        <Card>
          <p className="label-caps">Příjmy podle úhrad</p>
          <p className="mt-2 text-sm text-muted">
            Evidence úhrad a roční podklady (§ 7 / § 9 podle data úhrady) přibudou v dalších krocích.
          </p>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardTitle>Poslední doklady</CardTitle>
          {recent.length === 0 ? (
            <p className="text-sm text-muted">Zatím žádné doklady.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {recent.map((inv) => {
                const badge = invoiceStatusBadge(inv);
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
        ) : null}
      </div>
    </>
  );
}
