import type { Metadata } from "next";
import { ButtonLink, EmptyState, PageHeader } from "@/components/ui";
import { listCustomers } from "@/lib/customers";
import { requireUser } from "@/lib/session";
import { CustomerList } from "./customer-list";

export const metadata: Metadata = { title: "Odběratelé" };

export default async function CustomersPage() {
  await requireUser();
  const customers = await listCustomers({ includeArchived: true });
  return (
    <>
      <PageHeader
        title="Odběratelé"
        description="Firmy se načtou z ARES podle IČO. Odběratele s doklady nelze smazat, jen archivovat."
        actions={<ButtonLink href="/odberatele/novy">Nový odběratel</ButtonLink>}
      />
      {customers.length === 0 ? (
        <EmptyState
          title="Zatím žádní odběratelé"
          action={<ButtonLink href="/odberatele/novy">Přidat prvního odběratele</ButtonLink>}
        >
          Stačí zadat IČO a údaje se doplní z ARES.
        </EmptyState>
      ) : (
        <CustomerList
          rows={customers.map((c) => ({
            id: c.id,
            name: c.name,
            kind: c.kind,
            ico: c.ico,
            city: c.city,
            email: c.email,
            invoiceCount: c._count.invoices,
            archived: c.archived,
          }))}
        />
      )}
    </>
  );
}
