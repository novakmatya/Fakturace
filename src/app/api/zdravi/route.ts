import { prisma } from "@/lib/db";

// Kontrola dostupnosti pro Railway (healthcheck při nasazení).
// Nevrací žádná data – jen ověří, že aplikace běží a databáze odpovídá.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
