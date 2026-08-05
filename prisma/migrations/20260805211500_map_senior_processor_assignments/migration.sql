-- Keep the portal account aligned with the processor name selected by the
-- Loan Officer, without requiring a second manual routing-group assignment.
WITH processor_mapping("groupName", "processorName") AS (
  VALUES
    ('KATHY_BUI', 'Kathy Bui'),
    ('JACK_NGO', 'Jack Ngo'),
    ('MARTIN_SON_BUI', 'Martin Son Bui'),
    ('MARTIN_SON_BUI', 'Martin Bui')
)
UPDATE "User" AS u
SET
  "processingAssignmentGroups" = array_append(
    u."processingAssignmentGroups",
    processor_mapping."groupName"
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM processor_mapping
WHERE u."active" = true
  AND (u."role" = 'PROCESSOR_SR' OR 'PROCESSOR_SR' = ANY(u."roles"))
  AND lower(trim(u."name")) = lower(processor_mapping."processorName")
  AND NOT processor_mapping."groupName" = ANY(u."processingAssignmentGroups");

-- Repair rows created before the matching Sr Processor accounts existed.
-- Assign only when exactly one active Sr Processor has the selected name.
WITH processor_mapping("groupName", "processorName") AS (
  VALUES
    ('KATHY_BUI', 'Kathy Bui'),
    ('JACK_NGO', 'Jack Ngo'),
    ('MARTIN_SON_BUI', 'Martin Son Bui'),
    ('MARTIN_SON_BUI', 'Martin Bui')
),
unique_matches AS (
  SELECT
    p."id" AS "pipelineId",
    min(u."id") AS "seniorProcessorId"
  FROM "ProcessingPipelineLoan" AS p
  JOIN processor_mapping
    ON processor_mapping."groupName" = p."assignmentGroup"
  JOIN "User" AS u
    ON lower(trim(u."name")) = lower(processor_mapping."processorName")
   AND u."active" = true
   AND (u."role" = 'PROCESSOR_SR' OR 'PROCESSOR_SR' = ANY(u."roles"))
  WHERE p."seniorProcessorId" IS NULL
  GROUP BY p."id"
  HAVING count(*) = 1
)
UPDATE "ProcessingPipelineLoan" AS p
SET
  "seniorProcessorId" = unique_matches."seniorProcessorId",
  "updatedAt" = CURRENT_TIMESTAMP
FROM unique_matches
WHERE p."id" = unique_matches."pipelineId";
