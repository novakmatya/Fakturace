import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import type { CustomerData } from "@/lib/validation";

export async function listCustomers(options: { query?: string; includeArchived?: boolean } = {}) {
  const query = options.query?.trim();
  return prisma.customer.findMany({
    where: {
      ...(options.includeArchived ? {} : { archived: false }),
      ...(query
        ? {
            OR: [
              { name: { contains: query } },
              { ico: { contains: query } },
              { email: { contains: query } },
              { city: { contains: query } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: { _count: { select: { invoices: true } } },
  });
}

export async function getCustomer(id: string) {
  return prisma.customer.findUnique({ where: { id }, include: { defaultIncomeSource: true } });
}

export async function createCustomer(data: CustomerData, aresData?: unknown) {
  const customer = await prisma.customer.create({
    data: {
      ...data,
      aresData: aresData ? JSON.stringify(aresData) : null,
      aresFetchedAt: aresData ? new Date() : null,
    },
  });
  await audit({ action: "CUSTOMER_CREATED", entityType: "Customer", entityId: customer.id });
  return customer;
}

export async function updateCustomer(id: string, data: CustomerData) {
  const customer = await prisma.customer.update({ where: { id }, data });
  await audit({ action: "CUSTOMER_UPDATED", entityType: "Customer", entityId: id });
  return customer;
}

/** Odběratele nelze smazat (je na dokladech); lze ho jen archivovat. */
export async function setCustomerArchived(id: string, archived: boolean) {
  const customer = await prisma.customer.update({ where: { id }, data: { archived } });
  await audit({
    action: archived ? "CUSTOMER_ARCHIVED" : "CUSTOMER_RESTORED",
    entityType: "Customer",
    entityId: id,
  });
  return customer;
}
