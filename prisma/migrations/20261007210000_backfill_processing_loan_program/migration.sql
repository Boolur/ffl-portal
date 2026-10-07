-- Backfill the canonical loan program from the Submit to Processing request
-- for active pipeline loans that do not already have a program.
UPDATE "Loan" AS loan
SET
  "program" = NULLIF(BTRIM(task."submissionData" ->> 'loanProgram'), ''),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "ProcessingPipelineLoan" AS pipeline
INNER JOIN "Task" AS task
  ON task."id" = pipeline."sourceTaskId"
WHERE
  pipeline."loanId" = loan."id"
  AND pipeline."archivedAt" IS NULL
  AND NULLIF(BTRIM(COALESCE(loan."program", '')), '') IS NULL
  AND NULLIF(BTRIM(task."submissionData" ->> 'loanProgram'), '') IS NOT NULL;

-- Correct legacy rows where Loan Program was previously copied into Loan Type.
-- Only replace known program values when the source task has a distinct Loan Type.
UPDATE "ProcessingPipelineLoan" AS pipeline
SET
  "loanType" = NULLIF(BTRIM(task."submissionData" ->> 'loanType'), ''),
  "version" = pipeline."version" + 1,
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Task" AS task
WHERE
  task."id" = pipeline."sourceTaskId"
  AND pipeline."archivedAt" IS NULL
  AND pipeline."loanType" IN (
    'Cash out',
    'Rate and Term',
    'IRRRL',
    'Streamline',
    'Purchase'
  )
  AND NULLIF(BTRIM(task."submissionData" ->> 'loanType'), '') IS NOT NULL;
