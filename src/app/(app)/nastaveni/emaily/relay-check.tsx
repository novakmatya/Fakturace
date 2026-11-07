"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/form-controls";
import type { ActionResult } from "@/lib/validation";
import { pingRelayAction } from "./actions";

export function RelayCheck() {
  const [state, action] = useActionState<ActionResult | null, FormData>(pingRelayAction, null);
  return (
    <form action={action} className="space-y-3">
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingText="Ověřuji…">
        Ověřit spojení s Gmailem
      </SubmitButton>
    </form>
  );
}
