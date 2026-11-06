import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getSession } from "@/lib/session";
import { isSetupDone } from "@/lib/setup";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Přihlášení" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/prihlaseni">) {
  if (!(await isSetupDone())) redirect("/instalace");
  const session = await getSession();
  if (session?.user.twoFactorEnabled) redirect("/");
  if (session) redirect("/zabezpeceni");
  const params = await searchParams;
  const notice = params.ucet === "vytvoren" ? "Účet je založený. Přihlaste se a nastavte dvoufázové ověření." : undefined;
  return (
    <Card>
      <h1 className="mb-6 text-lg font-semibold">Přihlášení</h1>
      <LoginForm notice={notice} />
    </Card>
  );
}
