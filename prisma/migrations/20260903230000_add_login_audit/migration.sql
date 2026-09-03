CREATE TABLE "LoginAudit" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "userId" TEXT,
  "outcome" TEXT NOT NULL,
  "reason" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoginAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LoginAudit_createdAt_idx"
  ON "LoginAudit"("createdAt");

CREATE INDEX "LoginAudit_email_createdAt_idx"
  ON "LoginAudit"("email", "createdAt");

CREATE INDEX "LoginAudit_userId_createdAt_idx"
  ON "LoginAudit"("userId", "createdAt");

ALTER TABLE "LoginAudit"
  ADD CONSTRAINT "LoginAudit_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
