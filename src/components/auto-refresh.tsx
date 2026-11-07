"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Dokud se něco odesílá, každé 3 s obnoví data stránky (nejdéle 2 minuty). */
export function AutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > 120_000) return clearInterval(timer);
      router.refresh();
    }, 3_000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
