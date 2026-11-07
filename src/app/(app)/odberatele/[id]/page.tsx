import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, Badge, ButtonLink, Card, CardTitle, PageHeader } from "@/components/ui";
import { getCustomer } from "@/lib/customers";
import { formatCzDate } from "@/lib/dates";
import { todayPrague } from "@/lib/dates";
import { invoiceStatusBadge } from "@/lib/invoices/display";
import { listInvoices } from "@/lib/invoices/service";
import { formatCzk } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { listIncomeSources } from "@/lib/settings";
import { toggleCustomerArchiveAction } from "../actions";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Odběratel" };

export default async function CustomerPage({ params, searchParams }: PageProps<"/odberatele/[id]">) {
  await requireUser();
  const { id } = await params;
  const customer = await getCustomer(id);
  if (!customer) notFound();
  const today = todayPrague();
  const [sources, invoices, query] = await Promise.all([
    listIncomeSources(),
    listInvoices({ customerId: id }),
    searchParams,
  ]);

  const defaults: Record<string, string> = {
    id: customer.id,
    kind: customer.kind,
    name: customer.name,
    street: customer.street,
    city: customer.city,
    zip: customer.zip,
    country: customer.country,
    ico: customer.ico ?? "",
    dic: customer.dic ?? "",
    email: customer.email ?? "",
    emailCc: customer.emailCc ?? "",
    defaultIncomeSourceId: customer.defaultIncomeSourceId ?? "",
    defaultDueDays: customer.defaultDueDays === null ? "" : String(customer.defaultDueDays),
    remindersEnabled: String(customer.remindersEnabled),
    note: customer.note ?? "",
  };

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/odberatele">Odběratelé</Link>}
        title={customer.name}
        description={customer.archived ? "Archivovaný odběratel – nelze mu vystavit novou fakturu." : undefined}
        actions={
          <>
            {!customer.archived ? <ButtonLink href={`/faktury/nova?odberatel=${customer.id}`}>Nová faktura</ButtonLink> : null}
            <form action={toggleCustomerArchiveAction}>
              <input type="hidden" name="id" value={customer.id} />
              <input type="hidden" name="archived" value={String(!customer.archived)} />
              <button type="submit" className="h-10 rounded-lg border border-line bg-surface px-4 text-sm hover:bg-panel">
                {customer.archived ? "Obnovit" : "Archivovat"}
              </button>
            </form>
          </>
        }
      />
      {query.ulozeno ? (
        <div className="mb-6">
          <Alert tone="ok">Odběratel je uložený.</Alert>
        </div>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CustomerForm defaults={defaults} incomeSources={sources.map((s) => ({ id: s.id, name: s.name, section: s.section }))} />
        </Card>
        <Card>
          <CardTitle>Doklady</CardTitle>
          {invoices.length === 0 ? (
            <p className="text-sm text-muted">Zatím žádné doklady.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {invoices.map((inv) => {
                const badge = invoiceStatusBadge(inv, today);
                return (
                  <li key={inv.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <Link href={`/faktury/${inv.id}`} className="font-medium hover:text-accent">
                        {inv.number ?? "Koncept"}
                      </Link>
                      <p className="text-[13px] text-muted">{formatCzDate(inv.issueDate)}</p>
                    </div>
                    <div className="text-right">
                      <p className="tabular">{formatCzk(inv.amountDueHalere)}</p>
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
