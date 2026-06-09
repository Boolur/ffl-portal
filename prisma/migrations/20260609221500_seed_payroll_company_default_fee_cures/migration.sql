INSERT INTO "PayrollLenderFeeRule" (
  "id",
  "lender",
  "loanChannel",
  "feeKind",
  "label",
  "amount",
  "required",
  "active",
  "notes",
  "createdAt",
  "updatedAt"
)
SELECT
  gen_random_uuid(),
  'Company Default',
  'NON_DELEGATED',
  'WIRE_FEE',
  'Wire Fee',
  180.00,
  true,
  true,
  'Company-wide cure when Wire Fee is entered as $0.',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1
  FROM "PayrollLenderFeeRule"
  WHERE "lender" = 'Company Default'
    AND "loanChannel" = 'NON_DELEGATED'
    AND "feeKind" = 'WIRE_FEE'
);
