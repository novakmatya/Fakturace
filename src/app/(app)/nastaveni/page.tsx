import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardTitle, PageHeader } from "@/components/ui";
import { emailConfig } from "@/lib/email/config";
import { requireUser } from "@/lib/session";
import { getAppSettings, getSupplier, listIncomeSources } from "@/lib/settings";
import { AppSettingsForm } from "./app-settings-form";
import { SupplierForm } from "./supplier-form";

export const metadata: Metadata = { title: "Nastavení" };

export default async function SettingsPage() {
  await requireUser();
  const [supplier, settings, sources] = await Promise.all([getSupplier(), getAppSettings(), listIncomeSources()]);
  const defaults: Record<string, string> = supplier
    ? Object.fromEntries(
        Object.entries(supplier)
          .filter(([key]) => !["id", "createdAt", "updatedAt", "logoFileId", "vatMode"].includes(key))
          .map(([key, value]) => [key, value === null ? "" : String(value)]),
      )
    : { country: "CZ", defaultDueDays: "14", vatNote: "Nejsem plátce DPH." };

  const email = emailConfig();
  const emailHint =
    email.mode === "resend"
      ? `Odesílání zapnuto (${email.from.address}).`
      : email.mode === "file"
        ? "Vývojový režim – e-maily se jen ukládají."
        : "Odesílání zatím není nastavené.";

  return (
    <>
      <PageHeader title="Nastavení" description="Údaje dodavatele se na každou fakturu zmrazí v okamžiku vystavení." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardTitle hint={supplier ? undefined : "Bez údajů dodavatele nelze vystavit fakturu."}>Dodavatel</CardTitle>
          <SupplierForm defaults={defaults} />
        </Card>
        <div className="space-y-6">
          <Card>
            <CardTitle hint="Určují paragraf příjmu (§ 7 / § 9) a kategorii paušálu.">Činnosti</CardTitle>
            <ul className="mb-4 space-y-1.5 text-sm">
              {sources.length === 0 ? <li className="text-muted">Zatím žádná činnost.</li> : null}
              {sources.map((s) => (
                <li key={s.id} className="flex justify-between gap-3">
                  <span className="truncate">{s.name}</span>
                  <span className="text-muted">{s.section === "S7" ? "§ 7" : "§ 9"}</span>
                </li>
              ))}
            </ul>
            <Link href="/nastaveni/cinnosti" className="text-sm font-medium text-accent hover:underline">
              Spravovat činnosti →
            </Link>
          </Card>
          <Card>
            <CardTitle>Aplikace a faktury</CardTitle>
            <AppSettingsForm roundInvoiceTotal={settings.roundInvoiceTotal} salutation={settings.salutation ?? ""} />
          </Card>
          <Card>
            <CardTitle hint={emailHint}>E-maily</CardTitle>
            <Link href="/nastaveni/emaily" className="text-sm font-medium text-accent hover:underline">
              Šablona a odesílání →
            </Link>
          </Card>
          <Card>
            <CardTitle hint="Přihlášení heslem a kódem z ověřovací aplikace.">Zabezpečení</CardTitle>
            <Link href="/zabezpeceni" className="text-sm font-medium text-accent hover:underline">
              Stav dvoufázového ověření →
            </Link>
          </Card>
        </div>
      </div>
    </>
  );
}
