CREATE TABLE "WebsiteLoanOfficerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'Mortgage Loan Originator',
    "nmls" TEXT,
    "photoUrl" TEXT,
    "phone" TEXT,
    "bookingUrl" TEXT,
    "licensedStates" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "bio" TEXT NOT NULL DEFAULT '',
    "yearsExperience" INTEGER,
    "loansClosed" TEXT,
    "city" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebsiteLoanOfficerProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WebsiteLoanOfficerProfile_userId_key"
ON "WebsiteLoanOfficerProfile"("userId");

CREATE UNIQUE INDEX "WebsiteLoanOfficerProfile_slug_key"
ON "WebsiteLoanOfficerProfile"("slug");

CREATE INDEX "WebsiteLoanOfficerProfile_publishedAt_idx"
ON "WebsiteLoanOfficerProfile"("publishedAt");

CREATE INDEX "WebsiteLoanOfficerProfile_featured_idx"
ON "WebsiteLoanOfficerProfile"("featured");

ALTER TABLE "WebsiteLoanOfficerProfile"
ADD CONSTRAINT "WebsiteLoanOfficerProfile_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
