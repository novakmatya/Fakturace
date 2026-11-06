export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center">
          <p className="label-caps text-accent">Fakturace</p>
          <p className="mt-1 text-sm text-muted">Faktury a roční daňové podklady</p>
        </div>
        {children}
      </div>
    </main>
  );
}
