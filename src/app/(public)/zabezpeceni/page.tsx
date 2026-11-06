import type { Metadata } from "next";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { requireUser } from "@/lib/session";
import { TwoFactorSetup } from "./two-factor-setup";

export const metadata: Metadata = { title: "Zabezpečení" };
export const dynamic = "force-dynamic";

export default async function SecurityPage() {
  const session = await requireUser({ allowWithoutTwoFactor: true });
  if (session.user.twoFactorEnabled) {
    return (
      <Card>
        <h1 className="mb-4 text-lg font-semibold">Zabezpečení</h1>
        <Alert tone="ok" title="Dvoufázové ověření je aktivní.">
          Při každém přihlášení zadáváte kód z ověřovací aplikace.
        </Alert>
        <ButtonLink href="/" className="mt-6 w-full">
          Zpět do aplikace
        </ButtonLink>
      </Card>
    );
  }
  return (
    <Card>
      <h1 className="text-lg font-semibold">Dvoufázové ověření</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Bez něj aplikaci nelze používat. Chrání faktury, platební údaje i daňové podklady i pro případ uniklého hesla.
      </p>
      <TwoFactorSetup />
    </Card>
  );
}
