import "server-only";
import { after } from "next/server";
import { kickOutbox } from "@/lib/email/worker";

/**
 * Po odeslání odpovědi uživateli hned zpracuje frontu e-mailů, takže e-mail
 * odejde během několika sekund a nečeká na další běh workeru.
 */
export function kickOutboxAfterResponse(): void {
  after(() => kickOutbox());
}
