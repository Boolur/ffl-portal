-- Match the predicates and sort orders used by the task desk and processing
-- pipeline. These indexes keep interactive reads from scanning growing tables.
CREATE INDEX IF NOT EXISTS "Task_kind_status_workflowState_assignedUserId_createdAt_idx"
ON "Task" ("kind", "status", "workflowState", "assignedUserId", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "ProcessingPipelineLoan_sheet_dateAssigned_idx"
ON "ProcessingPipelineLoan" ("sheet", "dateAssigned" DESC);

CREATE INDEX IF NOT EXISTS "ProcessingPipelineLoan_sheet_pipelineStatus_statusChangedAt_idx"
ON "ProcessingPipelineLoan" ("sheet", "pipelineStatus", "statusChangedAt" DESC);

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Loan_borrowerName_trgm_idx"
ON "Loan" USING gin ("borrowerName" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "Loan_loanNumber_trgm_idx"
ON "Loan" USING gin ("loanNumber" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ProcessingPipelineLoan_lender_trgm_idx"
ON "ProcessingPipelineLoan" USING gin ("lender" gin_trgm_ops);
