"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, TextField } from "@/components/form-controls";
import { Card } from "@/components/ui";
import { quickInvoiceAction, type DraftFormState } from "./faktury/actions";

/** Faktura na jeden klik: stejný odběratel jako minule, změní se jen částka (a měsíc v popisu). */
export function QuickInvoiceCard({
  customerName,
  customerEmail,
  description,
  lastAmount,
  canSend,
}: {
  customerName: string;
  customerEmail: string | null;
  description: string;
  lastAmount: string;
  canSend: boolean;
}) {
  const [state, action] = useActionState<DraftFormState | null, FormData>(quickInvoiceAction, null);
  return (
    <Card>
      <form
        action={action}
        className="space-y-4"
        onSubmit={(e) => {
          if (!confirm("Vystavit fakturu? Po vystavení už ji nelze upravit ani smazat.")) e.preventDefault();
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold tracking-tight">Nová faktura pro {customerName}</h2>
          <span className="text-[13px] text-muted">minule {lastAmount}</span>
        </div>
        <FormMessage state={state} />
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
          <TextField name="description" label="Popis" defaultValue={description} required />
          <TextField name="amount" label="Částka (Kč)" inputMode="decimal" required autoFocus placeholder="např. 15 000" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="send" defaultChecked={canSend} disabled={!canSend} className="size-4" />
            {canSend ? `Rovnou odeslat na ${customerEmail}` : "E-mail se neodešle (není nastavený)"}
          </label>
          <SubmitButton pendingText="Vystavuji…">{canSend ? "Vystavit a odeslat" : "Vystavit"}</SubmitButton>
        </div>
      </form>
    </Card>
  );
}
