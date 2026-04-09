-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_assignedRole_dueDate_idx" ON "Task"("assignedRole", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_assignedUserId_dueDate_idx" ON "Task"("assignedUserId", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_kind_dueDate_idx" ON "Task"("kind", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_status_dueDate_idx" ON "Task"("status", "dueDate");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Task_loanId_updatedAt_idx" ON "Task"("loanId", "updatedAt");
