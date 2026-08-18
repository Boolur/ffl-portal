ALTER TABLE "Loan"
ADD COLUMN "borrowerFirstName" TEXT,
ADD COLUMN "borrowerLastName" TEXT;

-- Historical fallback: final word is the last name; everything before it is
-- the first name. A one-word borrower remains entirely in First Name.
UPDATE "Loan"
SET
  "borrowerFirstName" = CASE
    WHEN BTRIM("borrowerName") ~ '\s'
      THEN REGEXP_REPLACE(BTRIM("borrowerName"), '\s+\S+$', '')
    ELSE BTRIM("borrowerName")
  END,
  "borrowerLastName" = CASE
    WHEN BTRIM("borrowerName") ~ '\s'
      THEN REGEXP_REPLACE(BTRIM("borrowerName"), '^.*\s+', '')
    ELSE NULL
  END;

-- Prefer structured values captured by Submit to Processing whenever present.
UPDATE "Loan" AS loan
SET
  "borrowerFirstName" = COALESCE(
    NULLIF(BTRIM(task."submissionData"->>'borrowerFirstName'), ''),
    loan."borrowerFirstName"
  ),
  "borrowerLastName" = COALESCE(
    NULLIF(BTRIM(task."submissionData"->>'borrowerLastName'), ''),
    loan."borrowerLastName"
  )
FROM "ProcessingPipelineLoan" AS pipeline
JOIN "Task" AS task ON task."id" = pipeline."sourceTaskId"
WHERE pipeline."loanId" = loan."id";
