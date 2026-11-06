import Link from "next/link";
import { requireUser } from "@/lib/session";
import { MainNav, SignOutButton } from "./nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="text-[15px] font-semibold tracking-tight text-ink">
            Fakturace
          </Link>
          <MainNav />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-[13px] text-muted sm:inline">{session.user.name}</span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
    </div>
  );
}
