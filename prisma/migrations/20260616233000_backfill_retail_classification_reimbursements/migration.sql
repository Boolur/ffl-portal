UPDATE "PayrollCompRequest" request
SET
  "appliedPlanType" = 'RETAIL',
  "reimbursementTarget" = 'MANAGER'
WHERE EXISTS (
  SELECT 1
  FROM "PayrollCompPlan" plan
  WHERE plan."loanOfficerId" = request."loanOfficerId"
    AND plan."active" = true
    AND plan."userClassification" = 'RETAIL'
);

DELETE FROM "PayrollCompRequestSplit" split
USING "PayrollCompRequest" request
WHERE split."requestId" = request."id"
  AND split."roleLabel" IN ('Post-Split Add-Backs', 'Manager Reimbursement')
  AND EXISTS (
    SELECT 1
    FROM "PayrollCompPlan" plan
    WHERE plan."loanOfficerId" = request."loanOfficerId"
      AND plan."active" = true
      AND plan."userClassification" = 'RETAIL'
  );

WITH manager_splits AS (
  SELECT
    split."requestId",
    split."recipientUserId",
    split."recipientName",
    split."recipientEmail",
    request."postSplitAddBackTotal",
    ROW_NUMBER() OVER (PARTITION BY split."requestId" ORDER BY split."sortOrder", split."id") AS row_number,
    COUNT(*) OVER (PARTITION BY split."requestId") AS manager_count,
    MAX(split."sortOrder") OVER (PARTITION BY split."requestId") AS max_sort_order
  FROM "PayrollCompRequestSplit" split
  INNER JOIN "PayrollCompRequest" request ON request."id" = split."requestId"
  WHERE COALESCE(request."postSplitAddBackTotal", 0) > 0
    AND LOWER(TRIM(split."roleLabel")) = 'manager'
    AND EXISTS (
      SELECT 1
      FROM "PayrollCompPlan" plan
      WHERE plan."loanOfficerId" = request."loanOfficerId"
        AND plan."active" = true
        AND plan."userClassification" = 'RETAIL'
    )
)
INSERT INTO "PayrollCompRequestSplit" (
  "id",
  "requestId",
  "planId",
  "recipientUserId",
  "recipientName",
  "recipientEmail",
  "roleLabel",
  "payType",
  "splitPercent",
  "flatAmount",
  "amount",
  "sortOrder",
  "createdAt"
)
SELECT
  gen_random_uuid(),
  "requestId",
  NULL,
  "recipientUserId",
  "recipientName",
  "recipientEmail",
  'Manager Reimbursement',
  'FLAT',
  0,
  CASE
    WHEN row_number = manager_count THEN "postSplitAddBackTotal" - (ROUND(("postSplitAddBackTotal" / manager_count)::numeric, 2) * (manager_count - 1))
    ELSE ROUND(("postSplitAddBackTotal" / manager_count)::numeric, 2)
  END,
  CASE
    WHEN row_number = manager_count THEN "postSplitAddBackTotal" - (ROUND(("postSplitAddBackTotal" / manager_count)::numeric, 2) * (manager_count - 1))
    ELSE ROUND(("postSplitAddBackTotal" / manager_count)::numeric, 2)
  END,
  max_sort_order + row_number,
  CURRENT_TIMESTAMP
FROM manager_splits;
