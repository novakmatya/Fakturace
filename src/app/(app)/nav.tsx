"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cx } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

const LINKS = [
  { href: "/", label: "Přehled", exact: true },
  { href: "/faktury", label: "Faktury" },
  { href: "/odberatele", label: "Odběratelé" },
  { href: "/nastaveni", label: "Nastavení" },
];

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav className="-mx-1 flex items-center gap-1 overflow-x-auto text-sm" aria-label="Hlavní navigace">
      {LINKS.map((link) => {
        const active = link.exact ? pathname === link.href : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "rounded-md px-2.5 py-1.5 transition-colors",
              active ? "bg-surface font-medium text-ink shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-ink",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="rounded-md px-2.5 py-1.5 text-[13px] text-muted hover:bg-panel hover:text-ink"
      onClick={async () => {
        await authClient.signOut();
        router.replace("/prihlaseni");
        router.refresh();
      }}
    >
      Odhlásit
    </button>
  );
}
