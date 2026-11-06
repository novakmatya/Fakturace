import { prisma, type Tx } from "@/lib/db";

export type AuditActor = "USER" | "SYSTEM";

export type AuditEntry = {
  action: string;
  actor?: AuditActor;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
};

/** Zapíše záznam do audit logu (tabulka je jen pro zápis – hlídá trigger). */
export async function audit(entry: AuditEntry, client: Tx = prisma): Promise<void> {
  await client.auditLog.create({
    data: {
      actor: entry.actor ?? "USER",
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      details: entry.details ? JSON.stringify(entry.details) : null,
    },
  });
}
