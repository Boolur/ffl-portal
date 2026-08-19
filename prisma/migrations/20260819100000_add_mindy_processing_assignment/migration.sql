UPDATE "User"
SET "processingAssignmentGroups" = CASE
  WHEN 'MINDY_NAGY' = ANY("processingAssignmentGroups")
    THEN "processingAssignmentGroups"
  ELSE ARRAY_APPEND("processingAssignmentGroups", 'MINDY_NAGY')
END
WHERE LOWER("email") = 'mnagy@bisuhomeloans.com';
