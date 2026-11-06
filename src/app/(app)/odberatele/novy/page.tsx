import type { Metadata } from "next";
import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { listIncomeSources } from "@/lib/settings";
import { CustomerForm } from "../customer-form";

export const metadata: Metadata = { title: "Nový odběratel" };

export default async function NewCustomerPage() {
  await requireUser();
  const sources = await listIncomeSources();
  return (
    <>
      <PageHeader eyebrow={<Link href="/odberatele">Odběratelé</Link>} title="Nový odběratel" />
      <Card className="max-w-3xl">
        <CustomerForm
          defaults={{ kind: "BUSINESS", country: "CZ", remindersEnabled: "true" }}
          incomeSources={sources.map((s) => ({ id: s.id, name: s.name, section: s.section }))}
        />
      </Card>
    </>
  );
}
