import { audit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { DEFAULT_TEMPLATES, type TemplateKey, validateTemplate } from "@/lib/email/template-text";

export * from "@/lib/email/template-text";

export async function getTemplate(key: TemplateKey): Promise<{ subject: string; body: string; custom: boolean }> {
  const row = await prisma.emailTemplate.findUnique({ where: { key } });
  if (row) return { subject: row.subject, body: row.body, custom: true };
  return { ...DEFAULT_TEMPLATES[key], custom: false };
}

export async function saveTemplate(key: TemplateKey, input: { subject: string; body: string }) {
  const data = validateTemplate(input);
  await prisma.emailTemplate.upsert({ where: { key }, create: { key, ...data }, update: data });
  await audit({ action: "EMAIL_TEMPLATE_UPDATED", entityType: "EmailTemplate", entityId: key });
}

export async function resetTemplate(key: TemplateKey) {
  await prisma.emailTemplate.deleteMany({ where: { key } });
  await audit({ action: "EMAIL_TEMPLATE_RESET", entityType: "EmailTemplate", entityId: key });
}
