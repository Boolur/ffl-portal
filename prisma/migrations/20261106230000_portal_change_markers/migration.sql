CREATE TABLE "PortalRevision" (
  "topic" TEXT NOT NULL PRIMARY KEY,
  "version" BIGINT NOT NULL DEFAULT 0
);
INSERT INTO "PortalRevision" ("topic") VALUES ('overview'), ('pipeline'), ('tasks');
ALTER TABLE "PortalRevision" ENABLE ROW LEVEL SECURITY;

-- Run at commit, after the application has finished changing its records.
-- Each affected topic advances once per transaction, even for bulk imports.
-- All trigger topic lists start with overview, giving concurrent commits a
-- consistent lock order. Failed transactions never publish a new marker.
CREATE FUNCTION public.bump_portal_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  topic_name TEXT;
  bumped TEXT[] := string_to_array(COALESCE(current_setting('ffl.portal_revision_topics', true), ''), ',');
BEGIN
  FOR topic_name IN SELECT unnest(string_to_array(TG_ARGV[0], ',')) ORDER BY 1 LOOP
    IF NOT topic_name = ANY(bumped) THEN
      UPDATE public."PortalRevision" SET "version" = "version" + 1 WHERE "topic" = topic_name;
      bumped := array_append(bumped, topic_name);
    END IF;
  END LOOP;
  PERFORM set_config('ffl.portal_revision_topics', array_to_string(bumped, ','), true);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.bump_portal_revision() FROM PUBLIC;

CREATE CONSTRAINT TRIGGER portal_task_revision AFTER INSERT OR UPDATE OR DELETE ON "Task"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.bump_portal_revision('overview,pipeline,tasks');
CREATE CONSTRAINT TRIGGER portal_attachment_revision AFTER INSERT OR UPDATE OR DELETE ON "TaskAttachment"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.bump_portal_revision('overview,tasks');
CREATE CONSTRAINT TRIGGER portal_loan_revision AFTER INSERT OR UPDATE OR DELETE ON "Loan"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.bump_portal_revision('overview,pipeline,tasks');
CREATE CONSTRAINT TRIGGER portal_processing_revision AFTER INSERT OR UPDATE OR DELETE ON "ProcessingPipelineLoan"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.bump_portal_revision('overview,pipeline');
CREATE CONSTRAINT TRIGGER portal_payroll_revision AFTER INSERT OR UPDATE OR DELETE ON "PayrollCompRequest"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.bump_portal_revision('overview,pipeline');
CREATE CONSTRAINT TRIGGER portal_disposition_revision AFTER INSERT OR UPDATE OR DELETE ON "PendingStpDisposition"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.bump_portal_revision('overview,pipeline');
CREATE CONSTRAINT TRIGGER portal_arive_revision AFTER INSERT OR UPDATE OR DELETE ON "ArivePipelineSync"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.bump_portal_revision('overview,pipeline');
