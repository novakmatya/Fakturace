"use client";

import { useActionState } from "react";
import { CheckboxField, FormMessage, SubmitButton } from "@/components/form-controls";
import type { ActionResult } from "@/lib/validation";
import { saveEmailSettingsAction } from "./actions";

export function EmailSettingsForm({
  autoSend,
  bccSelf,
  supplierEmail,
}: {
  autoSend: boolean;
  bccSelf: boolean;
  supplierEmail: string | null;
}) {
  const [state, action] = useActionState<ActionResult | null, FormData>(saveEmailSettingsAction, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <CheckboxField
        name="emailAutoSendOnIssue"
        label="Při vystavení faktury rovnou odeslat e-mail odběrateli"
        hint="Výchozí volba u tlačítka Vystavit – u každé faktury ji můžete před vystavením vypnout."
        defaultChecked={autoSend}
      />
      <CheckboxField
        name="emailBccSelf"
        label="Posílat mi skrytou kopii každého e-mailu"
        hint={
          supplierEmail
            ? `Na ${supplierEmail} (e-mail z údajů dodavatele) – budete mít odeslané faktury ve své schránce.`
            : "Doplňte e-mail v údajích dodavatele, jinak se kopie neposílá."
        }
        defaultChecked={bccSelf}
      />
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Uložit</SubmitButton>
      </div>
    </form>
  );
}
