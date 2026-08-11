ALTER TABLE "ProcessingPipelineLoan"
ADD COLUMN "processingMethod" TEXT;

UPDATE "ProcessingPipelineLoan" pipeline
SET "processingMethod" = COALESCE(
  NULLIF(task."submissionData"->>'processingMethod', ''),
  CASE
    WHEN pipeline."assignmentGroup" = 'THIRD_PARTY' THEN 'THIRD_PARTY'
    WHEN pipeline."assignmentGroup" IN ('KATHY_BUI', 'JACK_NGO', 'MARTIN_SON_BUI') THEN 'IN_HOUSE'
    ELSE NULL
  END
)
FROM "Task" task
WHERE task."id" = pipeline."sourceTaskId";

DELETE FROM "ProcessingPipelineLoan"
WHERE "processingMethod" = 'IN_HOUSE'
   OR "assignmentGroup" IN ('KATHY_BUI', 'JACK_NGO', 'MARTIN_SON_BUI');

CREATE INDEX "ProcessingPipelineLoan_processingMethod_idx"
ON "ProcessingPipelineLoan"("processingMethod");
