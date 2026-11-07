import "server-only";
import { listCustomers } from "@/lib/customers";
import { emailConfig } from "@/lib/email/config";
import { getAppSettings, getSupplier, listIncomeSources } from "@/lib/settings";

/** Číselníky a výchozí hodnoty pro formulář faktury. */
export async function loadInvoiceFormContext() {
  const [customers, sources, supplier, settings] = await Promise.all([
    listCustomers(),
    listIncomeSources(),
    getSupplier(),
    getAppSettings(),
  ]);
  return {
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      defaultIncomeSourceId: c.defaultIncomeSourceId,
      defaultDueDays: c.defaultDueDays,
      email: c.email,
    })),
    incomeSources: sources.map((s) => ({ id: s.id, name: s.name, section: s.section })),
    supplierDueDays: supplier?.defaultDueDays ?? 14,
    roundTotals: settings.roundInvoiceTotal,
    canIssue: supplier !== null,
    emailEnabled: emailConfig().mode !== "off",
    autoSendDefault: settings.emailAutoSendOnIssue,
  };
}
