ALTER TABLE "ProcessingPipelineLoan"
ADD COLUMN "leadSource" TEXT;

UPDATE "ProcessingPipelineLoan" pipeline
SET "leadSource" = COALESCE(
  NULLIF(
    CASE
      WHEN UPPER(TRIM(COALESCE(task."submissionData"->>'leadSource', ''))) = 'LEAD BUY'
        THEN COALESCE(
          NULLIF(TRIM(task."submissionData"->>'leadVendor'), ''),
          NULLIF(TRIM(task."submissionData"->>'leadSource'), '')
        )
      ELSE NULLIF(TRIM(task."submissionData"->>'leadSource'), '')
    END,
    ''
  ),
  (
    SELECT NULLIF(TRIM(payroll."leadSourceDetail"), '')
    FROM "PayrollCompRequest" payroll
    WHERE payroll."loanId" = pipeline."loanId"
      AND payroll."leadSourceDetail" IS NOT NULL
    ORDER BY payroll."paidAt" DESC NULLS LAST, payroll."createdAt" DESC
    LIMIT 1
  )
)
FROM "Task" task
WHERE task."id" = pipeline."sourceTaskId";
