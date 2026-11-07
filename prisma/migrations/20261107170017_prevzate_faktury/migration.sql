-- Přidání sloupce bez přestavby tabulky (přestavba by narazila na triggery jiných tabulek).
ALTER TABLE "Invoice" ADD COLUMN "origin" TEXT NOT NULL DEFAULT 'APP';

-- Kontrola vystavení rozlišuje vlastní a převzaté faktury.
DROP TRIGGER "invoice_issue_checks";

CREATE TRIGGER "invoice_issue_checks"
BEFORE UPDATE ON "Invoice"
WHEN OLD."number" IS NULL AND NEW."number" IS NOT NULL AND (
       NEW."status" <> 'VYSTAVENA'
    OR NEW."type" IS NOT OLD."type"
    -- vlastní faktury: číslo přesně z číselné řady aplikace
    OR (NEW."origin" = 'APP' AND (
           NEW."seriesYear" IS NULL
        OR NEW."seriesYear" <> CAST(substr(NEW."issueDate", 1, 4) AS INTEGER)
        OR NEW."number" IS NOT (
               (CASE NEW."type" WHEN 'DOBROPIS' THEN 'D' ELSE '' END)
            || printf('%04d%04d', NEW."seriesYear",
                   (SELECT "lastNumber" FROM "NumberSeries"
                     WHERE "docType" = NEW."type" AND "year" = NEW."seriesYear")))))
    -- převzaté starší faktury: původní číslo, mimo číselnou řadu aplikace
    OR (NEW."origin" = 'IMPORT' AND (NEW."seriesYear" IS NOT NULL OR trim(NEW."number") = ''))
    OR NEW."origin" NOT IN ('APP', 'IMPORT')
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

-- ---------------------------------------------------------------------------
-- Převzaté faktury: původ dokladu nelze dodatečně změnit.
-- Číselná řada aplikace může začít od zvoleného čísla (navázání na dřívější řadu).
-- ---------------------------------------------------------------------------

CREATE TRIGGER "invoice_origin_immutable"
BEFORE UPDATE ON "Invoice"
WHEN NEW."origin" IS NOT OLD."origin"
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: původ dokladu nelze měnit');
END;

DROP TRIGGER "numberseries_insert_zero";

CREATE TRIGGER "numberseries_insert_zero"
BEFORE INSERT ON "NumberSeries"
WHEN NEW."lastNumber" < 0 OR NEW."lastNumber" > 9998
BEGIN
    SELECT RAISE(ABORT, 'INTEGRITY: nová číselná řada musí začínat číslem 0 až 9998');
END;
