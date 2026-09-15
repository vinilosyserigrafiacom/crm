-- CreateTable
CREATE TABLE "Segment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'STATIC',
    "rulesJson" TEXT NOT NULL DEFAULT '{}',
    "onlyWithConsent" BOOLEAN NOT NULL DEFAULT true,
    "includeAllContacts" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Segment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SegmentMember" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "segmentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "addedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SegmentMember_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SegmentMember_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jobTitle" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "marketingOptOut" BOOLEAN NOT NULL DEFAULT false,
    "marketingConsentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Contact" ("createdAt", "customerId", "email", "id", "isPrimary", "jobTitle", "name", "notes", "phone", "updatedAt") SELECT "createdAt", "customerId", "email", "id", "isPrimary", "jobTitle", "name", "notes", "phone", "updatedAt" FROM "Contact";
DROP TABLE "Contact";
ALTER TABLE "new_Contact" RENAME TO "Contact";
CREATE INDEX "Contact_customerId_idx" ON "Contact"("customerId");
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
    "marketingOptOut" BOOLEAN NOT NULL DEFAULT false,
    "marketingConsentAt" DATETIME,
    "marketingConsentSource" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Customer" ("active", "code", "countryCode", "createdAt", "defaultVatRate", "email", "id", "kind", "legalName", "notes", "paymentTermsDays", "phone", "tags", "taxId", "taxIdType", "tradeName", "updatedAt", "vatExempt", "vatExemptReason", "website", "withholdingRate") SELECT "active", "code", "countryCode", "createdAt", "defaultVatRate", "email", "id", "kind", "legalName", "notes", "paymentTermsDays", "phone", "tags", "taxId", "taxIdType", "tradeName", "updatedAt", "vatExempt", "vatExemptReason", "website", "withholdingRate" FROM "Customer";
DROP TABLE "Customer";
ALTER TABLE "new_Customer" RENAME TO "Customer";
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"("code");
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
INSERT INTO "new_Order" ("billingSnapshot", "createdAt", "createdById", "currency", "customerId", "customerRef", "deliveredAt", "discountTotal", "dueDate", "globalDiscountRate", "id", "internalNotes", "linesSubtotal", "notes", "number", "orderDate", "quoteId", "series", "status", "taxableBase", "title", "total", "updatedAt", "vatBreakdown", "vatTotal", "withholdingTotal", "year") SELECT "billingSnapshot", "createdAt", "createdById", "currency", "customerId", "customerRef", "deliveredAt", "discountTotal", "dueDate", "globalDiscountRate", "id", "internalNotes", "linesSubtotal", "notes", "number", "orderDate", "quoteId", "series", "status", "taxableBase", "title", "total", "updatedAt", "vatBreakdown", "vatTotal", "withholdingTotal", "year" FROM "Order";
DROP TABLE "Order";
ALTER TABLE "new_Order" RENAME TO "Order";
CREATE UNIQUE INDEX "Order_number_key" ON "Order"("number");
CREATE INDEX "Order_customerId_idx" ON "Order"("customerId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE INDEX "Order_orderDate_idx" ON "Order"("orderDate");
CREATE INDEX "Order_dueDate_idx" ON "Order"("dueDate");
CREATE INDEX "Order_quoteId_idx" ON "Order"("quoteId");
CREATE INDEX "Order_status_boardPosition_idx" ON "Order"("status", "boardPosition");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Segment_name_key" ON "Segment"("name");

-- CreateIndex
CREATE INDEX "Segment_active_idx" ON "Segment"("active");

-- CreateIndex
CREATE INDEX "SegmentMember_customerId_idx" ON "SegmentMember"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "SegmentMember_segmentId_customerId_key" ON "SegmentMember"("segmentId", "customerId");
