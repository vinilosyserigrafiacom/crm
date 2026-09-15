-- CreateTable
CREATE TABLE "WooSyncRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "since" DATETIME,
    "customersCreated" INTEGER NOT NULL DEFAULT 0,
    "customersUpdated" INTEGER NOT NULL DEFAULT 0,
    "ordersCreated" INTEGER NOT NULL DEFAULT 0,
    "ordersUpdated" INTEGER NOT NULL DEFAULT 0,
    "ordersSkipped" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "warnings" TEXT NOT NULL DEFAULT '[]',
    "triggeredById" TEXT,
    CONSTRAINT "WooSyncRun_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Customer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COMPANY',
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "taxId" TEXT,
    "taxIdType" TEXT NOT NULL DEFAULT 'NIF',
    "countryCode" TEXT NOT NULL DEFAULT 'ES',
    "email" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 0,
    "defaultVatRate" INTEGER NOT NULL DEFAULT 2100,
    "vatExempt" BOOLEAN NOT NULL DEFAULT false,
    "vatExemptReason" TEXT,
    "withholdingRate" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "tags" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "wooId" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'CRM',
    "syncedAt" DATETIME,
    "marketingOptOut" BOOLEAN NOT NULL DEFAULT false,
    "marketingConsentAt" DATETIME,
    "marketingConsentSource" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Customer" ("active", "code", "countryCode", "createdAt", "defaultVatRate", "email", "id", "kind", "legalName", "marketingConsentAt", "marketingConsentSource", "marketingOptOut", "notes", "paymentTermsDays", "phone", "tags", "taxId", "taxIdType", "tradeName", "updatedAt", "vatExempt", "vatExemptReason", "website", "withholdingRate") SELECT "active", "code", "countryCode", "createdAt", "defaultVatRate", "email", "id", "kind", "legalName", "marketingConsentAt", "marketingConsentSource", "marketingOptOut", "notes", "paymentTermsDays", "phone", "tags", "taxId", "taxIdType", "tradeName", "updatedAt", "vatExempt", "vatExemptReason", "website", "withholdingRate" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");
CREATE UNIQUE INDEX "Customer_wooId_key" ON "Customer"("wooId");
CREATE INDEX "Customer_legalName_idx" ON "Customer"("legalName");
CREATE INDEX "Customer_taxId_idx" ON "Customer"("taxId");
CREATE INDEX "Customer_active_idx" ON "Customer"("active");
CREATE TABLE "new_Order" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "number" TEXT,
    "series" TEXT NOT NULL DEFAULT 'A',
    "year" INTEGER NOT NULL,
    "customerId" TEXT NOT NULL,
    "quoteId" TEXT,
    "createdById" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "boardPosition" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT 'CRM',
    "wooId" INTEGER,
    "wooNumber" TEXT,
    "wooStatus" TEXT,
    "syncedAt" DATETIME,
    "orderDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATETIME,
    "deliveredAt" DATETIME,
    "title" TEXT,
    "customerRef" TEXT,
    "notes" TEXT,
    "internalNotes" TEXT,
    "billingSnapshot" TEXT,
    "globalDiscountRate" INTEGER NOT NULL DEFAULT 0,
    "linesSubtotal" INTEGER NOT NULL DEFAULT 0,
    "discountTotal" INTEGER NOT NULL DEFAULT 0,
    "taxableBase" INTEGER NOT NULL DEFAULT 0,
    "vatTotal" INTEGER NOT NULL DEFAULT 0,
    "withholdingTotal" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "vatBreakdown" TEXT NOT NULL DEFAULT '[]',
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Order_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Order" ("billingSnapshot", "boardPosition", "createdAt", "createdById", "currency", "customerId", "customerRef", "deliveredAt", "discountTotal", "dueDate", "globalDiscountRate", "id", "internalNotes", "linesSubtotal", "notes", "number", "orderDate", "quoteId", "series", "status", "taxableBase", "title", "total", "updatedAt", "vatBreakdown", "vatTotal", "withholdingTotal", "year") SELECT "billingSnapshot", "boardPosition", "createdAt", "createdById", "currency", "customerId", "customerRef", "deliveredAt", "discountTotal", "dueDate", "globalDiscountRate", "id", "internalNotes", "linesSubtotal", "notes", "number", "orderDate", "quoteId", "series", "status", "taxableBase", "title", "total", "updatedAt", "vatBreakdown", "vatTotal", "withholdingTotal", "year" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");
CREATE UNIQUE INDEX "Order_wooId_key" ON "Order"("wooId");
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_orderDate_idx" ON "Order"("orderDate");
CREATE INDEX "Order_dueDate_idx" ON "Order"("dueDate");
CREATE INDEX "Order_source_idx" ON "Order"("source");
CREATE INDEX "Order_quoteId_idx" ON "Order"("quoteId");
CREATE INDEX "Order_status_boardPosition_idx" ON "Order"("status", "boardPosition");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "WooSyncRun_startedAt_idx" ON "WooSyncRun"("startedAt");
