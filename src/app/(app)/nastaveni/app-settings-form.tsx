"use client";

import { useActionState } from "react";
import { CheckboxField, FormMessage, SubmitButton } from "@/components/form-controls";
import { saveAppSettingsAction, type FormState } from "./actions";

export function AppSettingsForm({ roundInvoiceTotal }: { roundInvoiceTotal: boolean }) {
  const [state, action] = useActionState<FormState | null, FormData>(saveAppSettingsAction, null);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <CheckboxField
        name="roundInvoiceTotal"
        label="Zaokrouhlovat celkovou částku faktury na celé koruny"
        hint="Rozdíl se na faktuře ukáže jako řádek Zaokrouhlení. Platí pro nově ukládané koncepty."
        defaultChecked={roundInvoiceTotal}
      />
      <div className="flex justify-end">
        <SubmitButton variant="secondary">Uložit</SubmitButton>
      </div>
    </form>
  );
}
