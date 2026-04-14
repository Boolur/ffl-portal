CREATE INDEX IF NOT EXISTS "Task_createdAt_idx" ON "Task"("createdAt");

CREATE INDEX IF NOT EXISTS "Task_assignedRole_createdAt_idx" ON "Task"("assignedRole", "createdAt");

CREATE INDEX IF NOT EXISTS "Task_assignedUserId_createdAt_idx" ON "Task"("assignedUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "Task_kind_createdAt_idx" ON "Task"("kind", "createdAt");

CREATE INDEX IF NOT EXISTS "Task_loanId_dueDate_idx" ON "Task"("loanId", "dueDate");
