-- Recover projected revenue from the completed processing submission for
-- pipeline rows created before revenue was consistently copied.
UPDATE "ProcessingPipelineLoan" AS pipeline
SET "projectedRevenue" = CAST(
  REGEXP_REPLACE(task."submissionData"->>'projectedRevenue', '[^0-9.-]', '', 'g')
  AS DECIMAL(12, 2)
)
FROM "Task" AS task
WHERE pipeline."sourceTaskId" = task."id"
  AND pipeline."projectedRevenue" IS NULL
  AND REGEXP_REPLACE(
    COALESCE(task."submissionData"->>'projectedRevenue', ''),
    '[^0-9.-]',
    '',
    'g'
  ) ~ '^[0-9]+(\.[0-9]+)?$';

-- Final Revenue starts with the LO's submitted projection. A completed payroll
-- request or an audited pipeline edit can replace it later.
UPDATE "ProcessingPipelineLoan"
SET "finalRevenue" = "projectedRevenue"
WHERE "finalRevenue" IS NULL
  AND "projectedRevenue" IS NOT NULL;
