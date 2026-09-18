CREATE INDEX "AuditLog_loanId_createdAt_idx"
ON "AuditLog"("loanId", "createdAt" DESC);
