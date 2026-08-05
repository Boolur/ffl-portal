-- Processing submissions historically stored the selected lender under
-- "investor". Normalize that value into the pipeline snapshot and recover
-- subject-property state from any related submission that already has it.
UPDATE "ProcessingPipelineLoan" AS pipeline
SET
  "lender" = COALESCE(
    NULLIF(pipeline."lender", ''),
    NULLIF(source_task."submissionData"->>'lender', ''),
    NULLIF(source_task."submissionData"->>'investor', ''),
    NULLIF(source_task."submissionData"->>'investorName', ''),
    NULLIF(source_task."submissionData"->>'lenderName', ''),
    NULLIF(source_task."submissionData"->>'productProviderName', '')
  ),
  "propertyState" = COALESCE(
    NULLIF(pipeline."propertyState", ''),
    CASE
      WHEN COALESCE(
        source_task."submissionData"->>'propertyState',
        source_task."submissionData"->>'state'
      ) ~* '^[a-z]{2}$'
      THEN upper(COALESCE(
        source_task."submissionData"->>'propertyState',
        source_task."submissionData"->>'state'
      ))
      ELSE NULL
    END,
    (
      SELECT upper(COALESCE(
        related_task."submissionData"->>'propertyState',
        related_task."submissionData"->>'state'
      ))
      FROM "Task" AS related_task
      WHERE related_task."loanId" = pipeline."loanId"
        AND COALESCE(
          related_task."submissionData"->>'propertyState',
          related_task."submissionData"->>'state'
        ) ~* '^[a-z]{2}$'
      ORDER BY related_task."createdAt" DESC
      LIMIT 1
    )
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM "Task" AS source_task
WHERE source_task."id" = pipeline."sourceTaskId"
  AND (
    pipeline."lender" IS NULL
    OR pipeline."lender" = ''
    OR pipeline."propertyState" IS NULL
    OR pipeline."propertyState" = ''
  );
