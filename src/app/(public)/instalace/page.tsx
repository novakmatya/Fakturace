import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { isSetupDone } from "@/lib/setup";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "Instalace" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  if (await isSetupDone()) redirect("/prihlaseni");
  return (
    <Card>
      <h1 className="text-lg font-semibold">Založení účtu</h1>
      <p className="mt-1 mb-6 text-sm text-muted">
        Aplikace má jediného uživatele. Po založení se tato stránka uzamkne a další účet už vytvořit nepůjde.
      </p>
      <SetupForm />
    </Card>
  );
}
