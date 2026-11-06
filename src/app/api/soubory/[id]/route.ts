import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readStoredFile } from "@/lib/files";

export const dynamic = "force-dynamic";

/** Soubory se vydávají jen přihlášenému uživateli s 2FA; v URL je jen náhodné ID. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session || !session.user.twoFactorEnabled) {
    return NextResponse.json({ error: "Nepřihlášen" }, { status: 401 });
  }
  const { id } = await params;
  const file = await prisma.fileObject.findUnique({ where: { id } });
  if (!file) return NextResponse.json({ error: "Soubor neexistuje" }, { status: 404 });

  let data: Buffer;
  try {
    data = readStoredFile(file);
  } catch {
    return NextResponse.json({ error: "Soubor je nedostupný nebo poškozený" }, { status: 500 });
  }
  const download = new URL(request.url).searchParams.get("stahnout") === "1";
  const name = file.originalName ?? "soubor";
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
