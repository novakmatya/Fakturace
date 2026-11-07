"use client";

import { useState } from "react";
import { buttonClass, cx } from "@/components/ui";

/** Zkopíruje text do schránky (např. kód skriptu). */
export function CopyButton({ text, label = "Zkopírovat", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={cx(buttonClass("secondary", "sm"), className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? "Zkopírováno ✓" : label}
    </button>
  );
}
