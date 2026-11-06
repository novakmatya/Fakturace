-- Integrita dokladů vynucená přímo databází.
-- Platí i tehdy, kdyby aplikace obsahovala chybu: vystavený doklad nelze změnit
-- ani smazat, číselná řada nemá díry, audit log je jen pro zápis.

-- ---------------------------------------------------------------------------
-- Jediný uživatel aplikace
-- ---------------------------------------------------------------------------
CREATE TRIGGER "user_single_account"
BEFORE INSERT ON "user"
WHEN (SELECT COUNT(*) FROM "user") >= 1
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: aplikace má jen jeden uživatelský účet');
END;

-- ---------------------------------------------------------------------------
-- Číselné řady: začínají nulou, rostou jen o jedna, nemažou se
-- ---------------------------------------------------------------------------
CREATE TRIGGER "numberseries_insert_zero"
BEFORE INSERT ON "NumberSeries"
WHEN NEW."lastNumber" <> 0
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: nová číselná řada musí začínat nulou');
END;

CREATE TRIGGER "numberseries_increment_only"
BEFORE UPDATE ON "NumberSeries"
WHEN NEW."lastNumber" <> OLD."lastNumber" + 1
  OR NEW."lastNumber" > 9999
  OR NEW."docType" IS NOT OLD."docType"
  OR NEW."year" IS NOT OLD."year"
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: číselná řada smí růst jen o jedna');
END;

CREATE TRIGGER "numberseries_no_delete"
BEFORE DELETE ON "NumberSeries"
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: číselnou řadu nelze smazat');
END;

-- ---------------------------------------------------------------------------
-- Doklady (faktury a dobropisy)
-- ---------------------------------------------------------------------------
CREATE TRIGGER "invoice_insert_draft_only"
BEFORE INSERT ON "Invoice"
WHEN NEW."number" IS NOT NULL
  OR NEW."status" <> 'KONCEPT'
  OR NEW."issuedAt" IS NOT NULL
  OR NEW."type" NOT IN ('FAKTURA', 'DOBROPIS')
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: nový doklad musí být koncept bez čísla');
END;

CREATE TRIGGER "invoice_draft_stays_draft"
BEFORE UPDATE ON "Invoice"
WHEN OLD."number" IS NULL AND NEW."number" IS NULL
 AND (NEW."status" <> 'KONCEPT' OR NEW."issuedAt" IS NOT NULL OR NEW."type" IS NOT OLD."type")
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: doklad bez čísla musí zůstat konceptem');
END;

CREATE TRIGGER "invoice_issue_checks"
BEFORE UPDATE ON "Invoice"
WHEN OLD."number" IS NULL AND NEW."number" IS NOT NULL AND (
       NEW."status" <> 'VYSTAVENA'
    OR NEW."type" IS NOT OLD."type"
    OR NEW."seriesYear" IS NULL
    OR NEW."seriesYear" <> CAST(substr(NEW."issueDate", 1, 4) AS INTEGER)
    OR NEW."number" IS NOT (
           (CASE NEW."type" WHEN 'DOBROPIS' THEN 'D' ELSE '' END)
        || printf('%04d%04d', NEW."seriesYear",
               (SELECT "lastNumber" FROM "NumberSeries"
                 WHERE "docType" = NEW."type" AND "year" = NEW."seriesYear")))
    OR NEW."supplierSnapshot" IS NULL
    OR NEW."customerSnapshot" IS NULL
    OR NEW."issuedAt" IS NULL
    OR (SELECT COUNT(*) FROM "InvoiceLine" WHERE "invoiceId" = NEW."id") = 0
    OR NEW."totalHalere" <> (SELECT COALESCE(SUM("totalHalere"), 0)
                               FROM "InvoiceLine" WHERE "invoiceId" = NEW."id")
    OR NEW."amountDueHalere" <> NEW."totalHalere" + NEW."roundingHalere"
    OR (NEW."type" = 'FAKTURA' AND NEW."amountDueHalere" <= 0)
    OR (NEW."type" = 'DOBROPIS' AND (NEW."amountDueHalere" >= 0 OR NEW."correctsInvoiceId" IS NULL))
)
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: vystavení dokladu neprošlo kontrolou čísla, součtů nebo údajů');
END;

CREATE TRIGGER "invoice_issued_immutable"
BEFORE UPDATE ON "Invoice"
WHEN OLD."number" IS NOT NULL AND (
       NEW."number" IS NOT OLD."number"
    OR NEW."type" IS NOT OLD."type"
    OR NEW."seriesYear" IS NOT OLD."seriesYear"
    OR NEW."customerId" IS NOT OLD."customerId"
    OR NEW."incomeSourceId" IS NOT OLD."incomeSourceId"
    OR NEW."incomeSection" IS NOT OLD."incomeSection"
    OR NEW."pausalCategory" IS NOT OLD."pausalCategory"
    OR NEW."shareNumerator" IS NOT OLD."shareNumerator"
    OR NEW."shareDenominator" IS NOT OLD."shareDenominator"
    OR NEW."issueDate" IS NOT OLD."issueDate"
    OR NEW."dueDate" IS NOT OLD."dueDate"
    OR NEW."supplyDate" IS NOT OLD."supplyDate"
    OR NEW."variableSymbol" IS NOT OLD."variableSymbol"
    OR NEW."constantSymbol" IS NOT OLD."constantSymbol"
    OR NEW."specificSymbol" IS NOT OLD."specificSymbol"
    OR NEW."currency" IS NOT OLD."currency"
    OR NEW."paymentMethod" IS NOT OLD."paymentMethod"
    OR NEW."totalHalere" IS NOT OLD."totalHalere"
    OR NEW."roundingHalere" IS NOT OLD."roundingHalere"
    OR NEW."amountDueHalere" IS NOT OLD."amountDueHalere"
    OR NEW."note" IS NOT OLD."note"
    OR NEW."supplierSnapshot" IS NOT OLD."supplierSnapshot"
    OR NEW."customerSnapshot" IS NOT OLD."customerSnapshot"
    OR NEW."issuedAt" IS NOT OLD."issuedAt"
    OR NEW."correctsInvoiceId" IS NOT OLD."correctsInvoiceId"
    OR NEW."recurringPlanId" IS NOT OLD."recurringPlanId"
    OR NEW."periodKey" IS NOT OLD."periodKey"
    OR NEW."createdAt" IS NOT OLD."createdAt"
    OR (OLD."pdfFileId" IS NOT NULL AND NEW."pdfFileId" IS NOT OLD."pdfFileId")
    OR (OLD."pdfSha256" IS NOT NULL AND NEW."pdfSha256" IS NOT OLD."pdfSha256")
    OR (OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS NOT OLD."cancelledAt")
    OR (OLD."cancelReason" IS NOT NULL AND NEW."cancelReason" IS NOT OLD."cancelReason")
    OR NEW."status" NOT IN ('VYSTAVENA', 'STORNOVANA')
    OR (OLD."status" = 'STORNOVANA' AND NEW."status" <> 'STORNOVANA')
    OR (NEW."status" = 'STORNOVANA' AND NEW."cancelledAt" IS NULL)
)
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: vystavený doklad nelze měnit');
END;

CREATE TRIGGER "invoice_no_delete_issued"
BEFORE DELETE ON "Invoice"
WHEN OLD."number" IS NOT NULL OR OLD."status" <> 'KONCEPT'
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: vystavený doklad nelze smazat');
END;

-- ---------------------------------------------------------------------------
-- Položky dokladů
-- ---------------------------------------------------------------------------
CREATE TRIGGER "invoiceline_no_insert_issued"
BEFORE INSERT ON "InvoiceLine"
WHEN (SELECT "number" FROM "Invoice" WHERE "id" = NEW."invoiceId") IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: položky vystaveného dokladu nelze měnit');
END;

CREATE TRIGGER "invoiceline_no_update_issued"
BEFORE UPDATE ON "InvoiceLine"
WHEN (SELECT "number" FROM "Invoice" WHERE "id" = OLD."invoiceId") IS NOT NULL
  OR (SELECT "number" FROM "Invoice" WHERE "id" = NEW."invoiceId") IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: položky vystaveného dokladu nelze měnit');
END;

CREATE TRIGGER "invoiceline_no_delete_issued"
BEFORE DELETE ON "InvoiceLine"
WHEN (SELECT "number" FROM "Invoice" WHERE "id" = OLD."invoiceId") IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: položky vystaveného dokladu nelze mazat');
END;

-- Součet položky = množství × cena, zaokrouhleno na haléře (polovina od nuly).
CREATE TRIGGER "invoiceline_total_check_insert"
BEFORE INSERT ON "InvoiceLine"
WHEN NEW."quantityMilli" <= 0
  OR length(trim(NEW."description")) = 0
  OR NEW."totalHalere" IS NOT (
       CASE WHEN NEW."quantityMilli" * NEW."unitPriceHalere" >= 0
            THEN (NEW."quantityMilli" * NEW."unitPriceHalere" + 500) / 1000
            ELSE -(((-(NEW."quantityMilli" * NEW."unitPriceHalere")) + 500) / 1000)
       END)
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: součet položky nesouhlasí s množstvím a cenou');
END;

CREATE TRIGGER "invoiceline_total_check_update"
BEFORE UPDATE ON "InvoiceLine"
WHEN NEW."quantityMilli" <= 0
  OR length(trim(NEW."description")) = 0
  OR NEW."totalHalere" IS NOT (
       CASE WHEN NEW."quantityMilli" * NEW."unitPriceHalere" >= 0
            THEN (NEW."quantityMilli" * NEW."unitPriceHalere" + 500) / 1000
            ELSE -(((-(NEW."quantityMilli" * NEW."unitPriceHalere")) + 500) / 1000)
       END)
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: součet položky nesouhlasí s množstvím a cenou');
END;

-- ---------------------------------------------------------------------------
-- Uložené soubory: neměnné; doklady, účtenky a importy nemazatelné
-- ---------------------------------------------------------------------------
CREATE TRIGGER "fileobject_immutable"
BEFORE UPDATE ON "FileObject"
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: uložený soubor nelze měnit');
END;

CREATE TRIGGER "fileobject_documents_no_delete"
BEFORE DELETE ON "FileObject"
WHEN OLD."kind" IN ('INVOICE_PDF', 'RECEIPT', 'BANK_IMPORT')
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: doklady, účtenky a importy nelze mazat');
END;

-- ---------------------------------------------------------------------------
-- Audit log: jen zápis
-- ---------------------------------------------------------------------------
CREATE TRIGGER "auditlog_no_update"
BEFORE UPDATE ON "AuditLog"
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: audit log nelze měnit');
END;

CREATE TRIGGER "auditlog_no_delete"
BEFORE DELETE ON "AuditLog"
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: audit log nelze mazat');
END;
