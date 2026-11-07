-- AlterTable
ALTER TABLE "EmailMessage" ADD COLUMN "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "paidOn" TEXT NOT NULL,
    "amountHalere" INTEGER NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'PREVOD',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "bankReference" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "roundInvoiceTotal" BOOLEAN NOT NULL DEFAULT false,
    "emailAutoSendOnIssue" BOOLEAN NOT NULL DEFAULT true,
    "emailBccSelf" BOOLEAN NOT NULL DEFAULT true,
    "remindersAuto" BOOLEAN NOT NULL DEFAULT false,
    "reminderFirstDays" INTEGER NOT NULL DEFAULT 7,
    "reminderRepeatDays" INTEGER NOT NULL DEFAULT 14,
    "reminderMaxCount" INTEGER NOT NULL DEFAULT 3,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("createdAt", "emailAutoSendOnIssue", "emailBccSelf", "id", "roundInvoiceTotal", "updatedAt") SELECT "createdAt", "emailAutoSendOnIssue", "emailBccSelf", "id", "roundInvoiceTotal", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE INDEX "Payment_paidOn_idx" ON "Payment"("paidOn");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_dedupeKey_key" ON "EmailMessage"("dedupeKey");

-- ---------------------------------------------------------------------------
-- Integrita úhrad: rozhodují o zdanění (rok data úhrady), proto jsou
-- neměnné a nemazatelné. Chybnou úhradu lze jen stornovat s důvodem.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "payment_insert_checks" BEFORE INSERT ON "Payment"
WHEN (SELECT "number" FROM "Invoice" WHERE "id" = NEW."invoiceId") IS NULL
  OR (SELECT "status" FROM "Invoice" WHERE "id" = NEW."invoiceId") <> 'VYSTAVENA'
  OR NEW."paidOn" NOT GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'
  OR NEW."amountHalere" = 0
  OR ((SELECT "type" FROM "Invoice" WHERE "id" = NEW."invoiceId") = 'FAKTURA' AND NEW."amountHalere" < 0)
  OR ((SELECT "type" FROM "Invoice" WHERE "id" = NEW."invoiceId") = 'DOBROPIS' AND NEW."amountHalere" > 0)
  OR NEW."cancelledAt" IS NOT NULL
  OR NEW."cancelReason" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Úhradu lze zapsat jen k vystavenému dokladu, s platným datem a nenulovou částkou.');
END;

CREATE TRIGGER "payment_content_immutable" BEFORE UPDATE ON "Payment"
WHEN NEW."invoiceId" IS NOT OLD."invoiceId"
  OR NEW."paidOn" IS NOT OLD."paidOn"
  OR NEW."amountHalere" IS NOT OLD."amountHalere"
  OR NEW."method" IS NOT OLD."method"
  OR NEW."source" IS NOT OLD."source"
  OR NEW."note" IS NOT OLD."note"
  OR NEW."bankReference" IS NOT OLD."bankReference"
  OR NEW."createdAt" IS NOT OLD."createdAt"
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Zapsanou úhradu nelze měnit – stornujte ji a zapište správnou.');
END;

CREATE TRIGGER "payment_cancel_rules" BEFORE UPDATE ON "Payment"
WHEN OLD."cancelledAt" IS NOT NULL
  OR NEW."cancelledAt" IS NULL
  OR NEW."cancelReason" IS NULL
  OR trim(NEW."cancelReason") = ''
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Úhradu lze jen jednou stornovat, a to s uvedením důvodu.');
END;

CREATE TRIGGER "payment_no_delete" BEFORE DELETE ON "Payment"
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Úhrady nelze mazat – chybnou úhradu stornujte.');
END;

CREATE TRIGGER "emailmessage_dedupe_immutable" BEFORE UPDATE ON "EmailMessage"
WHEN NEW."dedupeKey" IS NOT OLD."dedupeKey"
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Obsah e-mailu ve frontě ani v logu nelze měnit.');
END;
