import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { IncomeSourceData, SupplierData } from "@/lib/validation";

export async function getAppSettings() {
  return prisma.appSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export type AppSettingsUpdate = Partial<{
  roundInvoiceTotal: boolean;
  salutation: string | null;
  emailAutoSendOnIssue: boolean;
  emailBccSelf: boolean;
  remindersAuto: boolean;
  reminderFirstDays: number;
  reminderRepeatDays: number;
  reminderMaxCount: number;
}>;

export async function updateAppSettings(data: AppSettingsUpdate) {
  const before = await getAppSettings();
  const after = await prisma.appSettings.update({ where: { id: 1 }, data });
  const keys = Object.keys(data) as (keyof AppSettingsUpdate)[];
  await audit({
    action: "SETTINGS_UPDATED",
    entityType: "AppSettings",
    entityId: "1",
    details: { before: Object.fromEntries(keys.map((k) => [k, before[k]])), after: data },
  });
  return after;
}

export async function getSupplier() {
  return prisma.supplierProfile.findUnique({ where: { id: 1 } });
}

/** Změnil by uložený profil platební údaje? (pak je nutné potvrzení kódem 2FA) */
export async function supplierBankChanged(data: SupplierData): Promise<boolean> {
  const current = await getSupplier();
  if (!current) return false;
  return (
    current.bankAccount !== data.bankAccount ||
    current.iban !== data.iban ||
    (current.bic ?? null) !== (data.bic ?? null)
  );
}

export async function saveSupplier(data: SupplierData) {
  const current = await getSupplier();
  const saved = await prisma.supplierProfile.upsert({
    where: { id: 1 },
    create: { id: 1, ...data },
    update: data,
  });
  const bankChanged =
    current !== null &&
    (current.bankAccount !== saved.bankAccount || current.iban !== saved.iban || current.bic !== saved.bic);
  await audit({
    action: current ? "SUPPLIER_UPDATED" : "SUPPLIER_CREATED",
    entityType: "SupplierProfile",
    entityId: "1",
    details: { fields: Object.keys(data) },
  });
  if (bankChanged) {
    await audit({
      action: "BANK_ACCOUNT_CHANGED",
      entityType: "SupplierProfile",
      entityId: "1",
      details: {
        before: { bankAccount: current.bankAccount, iban: current.iban, bic: current.bic },
        after: { bankAccount: saved.bankAccount, iban: saved.iban, bic: saved.bic },
      },
    });
  }
  return saved;
}

export async function listIncomeSources(options: { includeArchived?: boolean } = {}) {
  return prisma.incomeSource.findMany({
    where: options.includeArchived ? {} : { archived: false },
    orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
  });
}

export async function createIncomeSource(data: IncomeSourceData) {
  const source = await prisma.incomeSource.create({ data });
  await audit({
    action: "INCOME_SOURCE_CREATED",
    entityType: "IncomeSource",
    entityId: source.id,
    details: { ...data },
  });
  return source;
}

export async function updateIncomeSource(id: string, data: IncomeSourceData) {
  const source = await prisma.incomeSource.update({ where: { id }, data });
  await audit({
    action: "INCOME_SOURCE_UPDATED",
    entityType: "IncomeSource",
    entityId: id,
    details: { ...data },
  });
  return source;
}

export async function setIncomeSourceArchived(id: string, archived: boolean) {
  const source = await prisma.incomeSource.update({ where: { id }, data: { archived } });
  await audit({
    action: archived ? "INCOME_SOURCE_ARCHIVED" : "INCOME_SOURCE_RESTORED",
    entityType: "IncomeSource",
    entityId: id,
  });
  return source;
}
