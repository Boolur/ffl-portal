-- CreateEnum
CREATE TYPE "LenderLinkType" AS ENUM ('PORTAL', 'RATES', 'GUIDE', 'SUPPORT', 'OTHER');

-- CreateTable
CREATE TABLE "Lender" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "logoStoragePath" TEXT,
    "logoFilename" TEXT,
    "logoUrl" TEXT,
    "portalUrl" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LenderContact" (
    "id" TEXT NOT NULL,
    "lenderId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LenderContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LenderLink" (
    "id" TEXT NOT NULL,
    "lenderId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "linkType" "LenderLinkType" NOT NULL DEFAULT 'PORTAL',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LenderLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Lender_slug_key" ON "Lender"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Lender_name_key" ON "Lender"("name");

-- CreateIndex
CREATE INDEX "Lender_active_sortOrder_idx" ON "Lender"("active", "sortOrder");

-- CreateIndex
CREATE INDEX "LenderContact_lenderId_sortOrder_idx" ON "LenderContact"("lenderId", "sortOrder");

-- CreateIndex
CREATE INDEX "LenderLink_lenderId_sortOrder_idx" ON "LenderLink"("lenderId", "sortOrder");

-- AddForeignKey
ALTER TABLE "LenderContact" ADD CONSTRAINT "LenderContact_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "Lender"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LenderLink" ADD CONSTRAINT "LenderLink_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "Lender"("id") ON DELETE CASCADE ON UPDATE CASCADE;
