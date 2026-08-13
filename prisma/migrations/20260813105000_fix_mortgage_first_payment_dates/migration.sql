UPDATE "ProcessingPipelineLoan"
SET "firstPaymentAt" =
  DATE_TRUNC('month', "fundedAt") + INTERVAL '2 months 12 hours'
WHERE "fundedAt" IS NOT NULL
  AND (
    "firstPaymentAt" IS NULL
    OR "firstPaymentAt" <> DATE_TRUNC('month', "fundedAt") + INTERVAL '2 months 12 hours'
  );
