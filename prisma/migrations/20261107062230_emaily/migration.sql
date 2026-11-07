-- CreateTable
CREATE TABLE "EmailTemplate" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "invoiceId" TEXT,
    "fromAddress" TEXT NOT NULL,
    "replyTo" TEXT,
    "toAddresses" TEXT NOT NULL,
    "ccAddresses" TEXT,
    "bccAddresses" TEXT,
    "subject" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "attachmentFileId" TEXT,
    "attachmentName" TEXT,
    "auto" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "queuedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" DATETIME,
    CONSTRAINT "EmailMessage_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "EmailMessage_attachmentFileId_fkey" FOREIGN KEY ("attachmentFileId") REFERENCES "FileObject" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppSettings" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT DEFAULT 1,
    "roundInvoiceTotal" BOOLEAN NOT NULL DEFAULT false,
    "emailAutoSendOnIssue" BOOLEAN NOT NULL DEFAULT true,
    "emailBccSelf" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_AppSettings" ("createdAt", "id", "roundInvoiceTotal", "updatedAt") SELECT "createdAt", "id", "roundInvoiceTotal", "updatedAt" FROM "AppSettings";
DROP TABLE "AppSettings";
ALTER TABLE "new_AppSettings" RENAME TO "AppSettings";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "EmailMessage_status_nextAttemptAt_idx" ON "EmailMessage"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailMessage_invoiceId_idx" ON "EmailMessage"("invoiceId");

-- ---------------------------------------------------------------------------
-- Integrita e-mailového logu: obsah je po zařazení do fronty neměnný,
-- stav jde jen dopředu a uzavřené záznamy nelze měnit ani mazat.
-- ---------------------------------------------------------------------------

CREATE TRIGGER "emailmessage_insert_queued" BEFORE INSERT ON "EmailMessage"
WHEN NEW."status" <> 'QUEUED' OR NEW."attempts" <> 0 OR NEW."sentAt" IS NOT NULL OR NEW."providerMessageId" IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Nový e-mail musí začínat ve frontě.');
END;

CREATE TRIGGER "emailmessage_invoice_issued" BEFORE INSERT ON "EmailMessage"
WHEN NEW."invoiceId" IS NOT NULL AND (SELECT "number" FROM "Invoice" WHERE "id" = NEW."invoiceId") IS NULL
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: E-mailem lze odeslat jen vystavený doklad.');
END;

CREATE TRIGGER "emailmessage_content_immutable" BEFORE UPDATE ON "EmailMessage"
WHEN NEW."kind" IS NOT OLD."kind"
  OR NEW."invoiceId" IS NOT OLD."invoiceId"
  OR NEW."fromAddress" IS NOT OLD."fromAddress"
  OR NEW."replyTo" IS NOT OLD."replyTo"
  OR NEW."toAddresses" IS NOT OLD."toAddresses"
  OR NEW."ccAddresses" IS NOT OLD."ccAddresses"
  OR NEW."bccAddresses" IS NOT OLD."bccAddresses"
  OR NEW."subject" IS NOT OLD."subject"
  OR NEW."bodyText" IS NOT OLD."bodyText"
  OR NEW."bodyHtml" IS NOT OLD."bodyHtml"
  OR NEW."attachmentFileId" IS NOT OLD."attachmentFileId"
  OR NEW."attachmentName" IS NOT OLD."attachmentName"
  OR NEW."auto" IS NOT OLD."auto"
  OR NEW."queuedAt" IS NOT OLD."queuedAt"
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Obsah e-mailu ve frontě ani v logu nelze měnit.');
END;

CREATE TRIGGER "emailmessage_closed_immutable" BEFORE UPDATE ON "EmailMessage"
WHEN OLD."status" IN ('SENT', 'FAILED', 'CANCELLED')
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Uzavřený záznam e-mailu je neměnný.');
END;

CREATE TRIGGER "emailmessage_status_flow" BEFORE UPDATE ON "EmailMessage"
WHEN NEW."status" IS NOT OLD."status" AND NOT (
  (OLD."status" = 'QUEUED' AND NEW."status" IN ('SENDING', 'CANCELLED'))
  OR (OLD."status" = 'SENDING' AND NEW."status" IN ('SENT', 'QUEUED', 'FAILED'))
)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Nepovolená změna stavu e-mailu.');
END;

CREATE TRIGGER "emailmessage_sent_complete" BEFORE UPDATE ON "EmailMessage"
WHEN NEW."status" = 'SENT' AND (NEW."sentAt" IS NULL OR NEW."providerMessageId" IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Odeslaný e-mail musí mít čas odeslání a ID zprávy.');
END;

CREATE TRIGGER "emailmessage_no_delete" BEFORE DELETE ON "EmailMessage"
BEGIN
  SELECT RAISE(ABORT, 'INTEGRITY: Záznamy e-mailů nelze mazat.');
END;
