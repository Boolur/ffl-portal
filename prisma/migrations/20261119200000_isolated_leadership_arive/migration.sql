ALTER TABLE "AriveTransportRequest" ADD COLUMN "responseMs" INTEGER;
ALTER TABLE "AriveConnectionRuntime" ADD COLUMN "reportedRequestsPerMinute" INTEGER;

CREATE TABLE "PilotAriveControl" (
  "id" TEXT PRIMARY KEY DEFAULT 'company',
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "generation" INTEGER NOT NULL DEFAULT 0,
  "revision" BIGINT NOT NULL DEFAULT 0,
  "cohortLimit" INTEGER DEFAULT 10 CHECK ("cohortLimit" IN (10,50)),
  "lastHintScanAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "PilotAriveProjection" (
  "pipelineId" TEXT PRIMARY KEY REFERENCES "ProcessingPipelineLoan"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "ariveLoanId" TEXT NOT NULL,
  "ariveGuid" TEXT,
  "verifiedOriginatorEmail" TEXT,
  "identityHash" TEXT,
  "connectionRevision" TIMESTAMP(3),
  "enrollmentStatus" TEXT NOT NULL DEFAULT 'PENDING',
  "enrollmentIssue" TEXT,
  "collectedAt" TIMESTAMP(3),
  "lastAttemptAt" TIMESTAMP(3),
  "nextAttemptAt" TIMESTAMP(3),
  "lastError" TEXT,
  "failureCount" INTEGER NOT NULL DEFAULT 0,
  "manualRefreshRequestedAt" TIMESTAMP(3),
  "watchedUntil" TIMESTAMP(3),
  "leaseUntil" TIMESTAMP(3),
  "leaseToken" TEXT,
  "projectionVersion" INTEGER NOT NULL DEFAULT 0,
  "sourceStage" TEXT,
  "sourceModifiedAt" TIMESTAMP(3),
  "lastHintModifiedAt" TIMESTAMP(3),
  "hintRequestedAt" TIMESTAMP(3),
  "sheet" "ProcessingPipelineSheet",
  "pipelineStatus" "ProcessingPipelineStatus",
  "archivedAt" TIMESTAMP(3),
  "snapshot" JSONB NOT NULL DEFAULT '{}',
  "notes" JSONB NOT NULL DEFAULT '[]',
  "routingProvenance" JSONB NOT NULL DEFAULT '{}',
  "everFunded" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "PilotAriveProjection_enrollmentStatus_nextAttemptAt_idx" ON "PilotAriveProjection"("enrollmentStatus","nextAttemptAt");
CREATE INDEX "PilotAriveProjection_sheet_archivedAt_pipelineStatus_idx" ON "PilotAriveProjection"("sheet","archivedAt","pipelineStatus");
CREATE INDEX "PilotAriveProjection_ariveLoanId_idx" ON "PilotAriveProjection"("ariveLoanId");
CREATE TABLE "PilotAriveRenderAck" (
  "pipelineId" TEXT NOT NULL REFERENCES "PilotAriveProjection"("pipelineId") ON DELETE CASCADE ON UPDATE CASCADE,
  "surface" TEXT NOT NULL,
  "projectionVersion" INTEGER NOT NULL,
  "collectedAt" TIMESTAMP(3) NOT NULL,
  "sourceChangedAt" TIMESTAMP(3),
  "renderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY("pipelineId","surface","projectionVersion")
);
CREATE INDEX "PilotAriveRenderAck_renderedAt_idx" ON "PilotAriveRenderAck"("renderedAt");
-- Browser clients use server-authorized actions; direct database roles receive
-- no access to the private loan snapshots or operator controls.
ALTER TABLE "PilotAriveControl" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PilotAriveProjection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PilotAriveRenderAck" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "PilotAriveControl", "PilotAriveProjection","PilotAriveRenderAck" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON "PilotAriveControl", "PilotAriveProjection","PilotAriveRenderAck" FROM anon;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON "PilotAriveControl", "PilotAriveProjection","PilotAriveRenderAck" FROM authenticated;
  END IF;
END $$;

-- The shared request and LO response still wake their normal staff queues.
-- Its private document package and Arive bookkeeping have their own readers.
CREATE OR REPLACE FUNCTION public.bump_portal_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $revision$
DECLARE
  topic_name TEXT;
  bumped TEXT[] := string_to_array(COALESCE(current_setting('ffl.portal_revision_topics', true), ''), ',');
  old_private BOOLEAN := false;
  new_private BOOLEAN := false;
BEGIN
  IF TG_TABLE_NAME = 'ArivePipelineSync' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'Task' THEN
    IF TG_OP <> 'INSERT' THEN
      old_private := OLD.kind IS NULL AND OLD.title = 'Processing submission pilot — documents'
        AND OLD."submissionData" #> '{submissionPilot,leadershipTest}' = 'true'::jsonb;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_private := NEW.kind IS NULL AND NEW.title = 'Processing submission pilot — documents'
        AND NEW."submissionData" #> '{submissionPilot,leadershipTest}' = 'true'::jsonb;
    END IF;
    IF (TG_OP = 'INSERT' OR old_private) AND (TG_OP = 'DELETE' OR new_private) THEN RETURN NULL; END IF;
  END IF;
  FOR topic_name IN SELECT unnest(string_to_array(TG_ARGV[0], ',')) ORDER BY 1 LOOP
    IF NOT topic_name = ANY(bumped) THEN
      UPDATE public."PortalRevision" SET "version" = "version" + 1 WHERE "topic" = topic_name;
      bumped := array_append(bumped, topic_name);
    END IF;
  END LOOP;
  PERFORM set_config('ffl.portal_revision_topics', array_to_string(bumped, ','), true);
  RETURN NULL;
END;
$revision$;
REVOKE ALL ON FUNCTION public.bump_portal_revision() FROM PUBLIC;
