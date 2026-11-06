"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

type AuthErrorLike = { status?: number; code?: string; message?: string } | null | undefined;

function describeError(error: AuthErrorLike, fallback: string): string {
  if (!error) return fallback;
  if (error.status === 429) return "Příliš mnoho pokusů. Počkejte prosím několik minut.";
  switch (error.code) {
    case "INVALID_EMAIL_OR_PASSWORD":
      return "Nesprávný e-mail nebo heslo.";
    case "INVALID_CODE":
    case "INVALID_BACKUP_CODE":
      return "Kód není platný. Zkontrolujte čas v telefonu a zkuste nový kód.";
    case "INVALID_TWO_FACTOR_COOKIE":
      return "Přihlášení vypršelo. Zadejte prosím znovu heslo.";
    default:
      return fallback;
  }
}

export function LoginForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const goHome = () => {
    router.replace("/");
    router.refresh();
  };
  const [step, setStep] = useState<"password" | "code">("password");
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const { data, error: authError } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setPending(false);
    if (authError) return setError(describeError(authError, "Přihlášení se nezdařilo."));
    if (data && "twoFactorRedirect" in data && data.twoFactorRedirect) {
      setStep("code");
      return;
    }
    // 2FA ještě není zapnuté – aplikace přesměruje na jeho nastavení.
    goHome();
  }

  async function onCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const result = useBackup
      ? await authClient.twoFactor.verifyBackupCode({ code })
      : await authClient.twoFactor.verifyTotp({ code });
    setPending(false);
    if (result.error) {
      if (result.error.code === "INVALID_TWO_FACTOR_COOKIE") setStep("password");
      return setError(describeError(result.error, "Ověření se nezdařilo."));
    }
    goHome();
  }

  if (step === "code") {
    return (
      <form onSubmit={onCode} className="space-y-4" key="code">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field
          label={useBackup ? "Záložní kód" : "Kód z ověřovací aplikace"}
          htmlFor="code"
          hint={useBackup ? "Každý záložní kód lze použít jen jednou." : "Šestimístný kód, který se mění každých 30 sekund."}
        >
          <input
            id="code"
            name="code"
            className={`${inputClass} tabular text-center text-lg tracking-[0.3em]`}
            inputMode={useBackup ? "text" : "numeric"}
            autoComplete="one-time-code"
            autoFocus
            required
            maxLength={useBackup ? 24 : 6}
          />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Ověřuji…" : "Ověřit a přihlásit"}
        </Button>
        <button
          type="button"
          className="w-full text-center text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
          onClick={() => {
            setUseBackup(!useBackup);
            setError(null);
          }}
        >
          {useBackup ? "Použít kód z aplikace" : "Nemám telefon – použít záložní kód"}
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onPassword} className="space-y-4" key="password">
      {notice ? <Alert tone="ok">{notice}</Alert> : null}
      {error ? <Alert tone="danger">{error}</Alert> : null}
      <Field label="E-mail" htmlFor="email">
        <input id="email" name="email" type="email" autoComplete="username" required className={inputClass} />
      </Field>
      <Field label="Heslo" htmlFor="password">
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className={inputClass}
        />
      </Field>
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Přihlašuji…" : "Pokračovat"}
      </Button>
    </form>
  );
}
