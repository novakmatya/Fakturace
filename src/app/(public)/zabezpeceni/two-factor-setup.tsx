"use client";

import QRCode from "qrcode";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert, Button, Field, inputClass } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { recordTwoFactorEnabled } from "./actions";

type Step = "password" | "scan" | "codes";

export function TwoFactorSetup() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("password");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [totpUri, setTotpUri] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (!totpUri) return;
    QRCode.toDataURL(totpUri, { margin: 1, width: 220, errorCorrectionLevel: "M" }).then(setQr);
  }, [totpUri]);

  const secret = totpUri ? new URL(totpUri).searchParams.get("secret") : null;

  async function onPassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const password = String(new FormData(event.currentTarget).get("password") ?? "");
    const { data, error: authError } = await authClient.twoFactor.enable({ password, method: "totp" });
    setPending(false);
    if (authError || !data || data.method !== "totp") {
      setError(authError?.code === "INVALID_PASSWORD" ? "Nesprávné heslo." : "Zapnutí se nezdařilo, zkuste to znovu.");
      return;
    }
    setTotpUri(data.totpURI);
    setBackupCodes(data.backupCodes);
    setStep("scan");
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    const code = String(new FormData(event.currentTarget).get("code") ?? "").replace(/\s/g, "");
    const { error: authError } = await authClient.twoFactor.verifyTotp({ code });
    if (authError) {
      setPending(false);
      setError("Kód nesouhlasí. Zkontrolujte, že má telefon správný čas, a zadejte nový kód.");
      return;
    }
    await recordTwoFactorEnabled();
    setPending(false);
    setStep("codes");
  }

  function downloadCodes() {
    const text = `Fakturace – záložní kódy pro přihlášení\nKaždý kód lze použít jen jednou.\n\n${backupCodes.join("\n")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "fakturace-zalozni-kody.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (step === "password") {
    return (
      <form onSubmit={onPassword} className="space-y-4">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <Field label="Potvrďte heslo" htmlFor="password">
          <input id="password" name="password" type="password" autoComplete="current-password" required className={inputClass} />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Připravuji…" : "Pokračovat"}
        </Button>
      </form>
    );
  }

  if (step === "scan") {
    return (
      <form onSubmit={onVerify} className="space-y-5">
        {error ? <Alert tone="danger">{error}</Alert> : null}
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>Otevřete ověřovací aplikaci (1Password, Bitwarden, Google Authenticator…).</li>
          <li>Naskenujte QR kód nebo opište klíč.</li>
          <li>Zadejte šestimístný kód z aplikace.</li>
        </ol>
        <div className="flex flex-col items-center gap-3 rounded-lg border border-line bg-panel p-4">
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element -- data URL vygenerovaná v prohlížeči
            <img src={qr} alt="QR kód pro ověřovací aplikaci" width={180} height={180} className="rounded bg-white p-2" />
          ) : (
            <div className="size-[180px] animate-pulse rounded bg-line" />
          )}
          {secret ? <code className="tabular break-all text-center text-xs text-muted">{secret}</code> : null}
        </div>
        <Field label="Kód z aplikace" htmlFor="code">
          <input
            id="code"
            name="code"
            className={`${inputClass} tabular text-center text-lg tracking-[0.3em]`}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
            autoFocus
          />
        </Field>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? "Ověřuji…" : "Zapnout dvoufázové ověření"}
        </Button>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <Alert tone="ok" title="Dvoufázové ověření je zapnuté.">
        Uložte si záložní kódy. Pomohou, když ztratíte telefon. Zobrazují se jen teď.
      </Alert>
      <ul className="tabular grid grid-cols-2 gap-2 rounded-lg border border-line bg-panel p-4 font-mono text-sm">
        {backupCodes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button type="button" variant="secondary" className="w-full" onClick={downloadCodes}>
        Stáhnout kódy jako text
      </Button>
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="mt-0.5 size-4 accent-[var(--color-accent)]"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        <span>Kódy mám bezpečně uložené (ve správci hesel nebo vytištěné).</span>
      </label>
      <Button type="button" className="w-full" disabled={!confirmed} onClick={() => {
          router.replace("/");
          router.refresh();
        }}>
        Pokračovat do aplikace
      </Button>
    </div>
  );
}
