WITH unique_loan_matches AS (
  SELECT
    payroll."id" AS "payrollId",
    MIN(loan."id") AS "loanId",
    COUNT(DISTINCT loan."id") AS "matchCount"
  FROM "PayrollCompRequest" payroll
  JOIN "Loan" loan
    ON UPPER(TRIM(loan."loanNumber")) = UPPER(TRIM(payroll."loanNumber"))
  WHERE payroll."loanId" IS NULL
  GROUP BY payroll."id"
)
UPDATE "PayrollCompRequest" payroll
SET "loanId" = matches."loanId"
FROM unique_loan_matches matches
WHERE payroll."id" = matches."payrollId"
  AND matches."matchCount" = 1;

WITH ranked_completed_requests AS (
  SELECT
    payroll."loanId",
    payroll."expectedRevenue",
    ROW_NUMBER() OVER (
      PARTITION BY payroll."loanId"
      ORDER BY
        COALESCE(payroll."paidAt", payroll."reviewedAt", payroll."updatedAt") DESC,
        payroll."id" DESC
    ) AS "rowNumber"
  FROM "PayrollCompRequest" payroll
  WHERE payroll."loanId" IS NOT NULL
    AND payroll."status" IN ('APPROVED', 'PAID')
)
UPDATE "ProcessingPipelineLoan" pipeline
SET
  "finalRevenue" = completed."expectedRevenue",
  "version" = pipeline."version" + 1
FROM ranked_completed_requests completed
WHERE pipeline."loanId" = completed."loanId"
  AND completed."rowNumber" = 1
  AND pipeline."finalRevenue" IS DISTINCT FROM completed."expectedRevenue";
