"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton, TextField } from "@/components/form-controls";
import { setupAction } from "./actions";

export function SetupForm() {
  const [state, action] = useActionState(setupAction, null);
  const errors = state && !state.ok ? state.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <TextField name="name" label="Jméno" autoComplete="name" required errors={errors} />
      <TextField name="email" label="E-mail pro přihlášení" type="email" autoComplete="email" required errors={errors} />
      <TextField
        name="password"
        label="Heslo"
        type="password"
        autoComplete="new-password"
        minLength={12}
        required
        errors={errors}
        hint="Alespoň 12 znaků. Nejlépe heslová fráze ze správce hesel."
      />
      <TextField
        name="passwordConfirm"
        label="Heslo znovu"
        type="password"
        autoComplete="new-password"
        required
        errors={errors}
      />
      <TextField
        name="setupToken"
        label="Instalační kód"
        autoComplete="off"
        required
        errors={errors}
        hint="Hodnota SETUP_TOKEN z nastavení serveru."
      />
      <SubmitButton className="w-full" pendingText="Zakládám účet…">
        Založit účet
      </SubmitButton>
    </form>
  );
}
