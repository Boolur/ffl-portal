UPDATE "ProcessingPipelineLoan"
SET
  "titleStatus" = 'RECEIVED',
  "payoffStatus" = 'RECEIVED',
  "payoffOrderedAt" = NULL,
  "hoiStatus" = 'RECEIVED',
  "hoiOrderedAt" = NULL,
  "appraisalNeeded" = FALSE,
  "cdSent" = TRUE,
  "cdWarningStartsAt" = NULL,
  "rateLock" = TRUE,
  "rateLockExpiresAt" = NULL,
  "rateLockConfirmedAt" = COALESCE("rateLockConfirmedAt", CURRENT_TIMESTAMP),
  "rateLockRequestedAt" = NULL,
  "rateLockRequestedById" = NULL
WHERE UPPER(
  REGEXP_REPLACE(TRIM(COALESCE("lender", '')), '[^A-Za-z0-9]+', ' ', 'g')
) ~ '^(AVEN|FIGURE|NFTY)( |$)';

UPDATE "ProcessingPipelineLoan"
SET
  "titleStatus" = 'NOT_APPLICABLE',
  "payoffStatus" = 'NOT_APPLICABLE',
  "payoffOrderedAt" = NULL,
  "hoiStatus" = 'NOT_APPLICABLE',
  "hoiOrderedAt" = NULL
WHERE UPPER(TRIM(COALESCE("processingMethod", ''))) = 'THIRD_PARTY'
  AND UPPER(
    REGEXP_REPLACE(TRIM(COALESCE("lender", '')), '[^A-Za-z0-9]+', ' ', 'g')
  ) !~ '^(AVEN|FIGURE|NFTY)( |$)';
