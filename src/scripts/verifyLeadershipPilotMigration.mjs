import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run a real PostgreSQL migration in memory without application credentials.
const runtime = process.argv[2];
assert(runtime && path.isAbsolute(runtime), 'Pass the absolute path of the local @electric-sql/pglite package.');
assert.equal(JSON.parse(await readFile(path.join(runtime, 'package.json'), 'utf8')).name, '@electric-sql/pglite');
const { PGlite } = await import(pathToFileURL(path.join(runtime, 'dist/index.js')).href);
const db = new PGlite();
try {
  await db.exec(`
    CREATE TYPE "ProcessingPipelineSheet" AS ENUM ('PIPELINE','FUNDING','RESTRUCTURE');
    CREATE TYPE "ProcessingPipelineStatus" AS ENUM ('FUNDED','PENDING_APPROVAL');
    CREATE TABLE "ProcessingPipelineLoan" ("id" TEXT PRIMARY KEY,"version" INT NOT NULL);
    CREATE TABLE "AriveTransportRequest" ("id" TEXT PRIMARY KEY);
    CREATE TABLE "AriveConnectionRuntime" ("id" TEXT PRIMARY KEY);
    CREATE ROLE anon; CREATE ROLE authenticated;
    INSERT INTO "ProcessingPipelineLoan" VALUES ('synthetic-file',4);
  `);
  await db.exec(
    await readFile(
      new URL('../../prisma/migrations/20261119200000_isolated_leadership_arive/migration.sql', import.meta.url),
      'utf8',
    ),
  );
  const one = async (sql) => (await db.query(sql)).rows[0];
  await db.exec('INSERT INTO "PilotAriveControl" ("updatedAt") VALUES (now())');
  assert.deepEqual(await one('SELECT "enabled","cohortLimit","generation" FROM "PilotAriveControl"'), {
    enabled: false,
    cohortLimit: 10,
    generation: 0,
  });
  await db.exec(
    `INSERT INTO "PilotAriveProjection" ("pipelineId","ariveLoanId","updatedAt") VALUES ('synthetic-file','1001',now())`,
  );
  await db.exec(
    `UPDATE "PilotAriveProjection" SET "sheet"='FUNDING',"projectionVersion"=1 WHERE "pipelineId"='synthetic-file'`,
  );
  assert.deepEqual(await one('SELECT * FROM "ProcessingPipelineLoan"'), { id: 'synthetic-file', version: 4 });
  await db.exec(`
    CREATE TABLE "PortalRevision" ("topic" TEXT PRIMARY KEY, "version" BIGINT NOT NULL DEFAULT 0);
    INSERT INTO "PortalRevision" ("topic") VALUES ('tasks');
    CREATE TABLE "Task" ("id" TEXT PRIMARY KEY, kind TEXT, title TEXT, "submissionData" JSONB);
    CREATE CONSTRAINT TRIGGER task_change AFTER INSERT OR UPDATE OR DELETE ON "Task"
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.bump_portal_revision('tasks');
  `);
  await db.exec(`INSERT INTO "Task" VALUES ('package',NULL,'Processing submission pilot — documents',
    '{"submissionPilot":{"leadershipTest":true}}')`);
  await db.exec(`UPDATE "Task" SET "submissionData" = jsonb_set("submissionData",'{submissionPilot,revision}','2') WHERE id='package'`);
  assert.equal(Number((await one('SELECT version FROM "PortalRevision"')).version), 0);
  await db.exec(`INSERT INTO "Task" VALUES ('request','SUBMIT_PROCESSING','Test - Submit for Processing','{"leadershipPilotTest":true}')`);
  assert.equal(Number((await one('SELECT version FROM "PortalRevision"')).version), 1);
  await db.exec(`UPDATE "Task" SET title='Renamed staff request' WHERE id='request'`);
  assert.equal(Number((await one('SELECT version FROM "PortalRevision"')).version), 2);
  await db.exec(`DELETE FROM "Task" WHERE id='package'`);
  assert.equal(Number((await one('SELECT version FROM "PortalRevision"')).version), 2);
  await db.exec(
    `INSERT INTO "PilotAriveRenderAck" ("pipelineId","surface","projectionVersion","collectedAt") VALUES ('synthetic-file','grid',1,now())`,
  );
  await db.exec(
    `INSERT INTO "PilotAriveRenderAck" ("pipelineId","surface","projectionVersion","collectedAt") VALUES ('synthetic-file','grid',1,now()) ON CONFLICT DO NOTHING`,
  );
  assert.equal((await one('SELECT count(*)::int AS n FROM "PilotAriveRenderAck"')).n, 1);
  const tables = ['PilotAriveControl', 'PilotAriveProjection', 'PilotAriveRenderAck'];
  for (const name of tables) {
    assert.equal((await one(`SELECT relrowsecurity FROM pg_class WHERE relname='${name}'`)).relrowsecurity, true);
    for (const role of ['authenticated', 'anon']) {
      assert.equal((await one(`SELECT has_table_privilege('${role}','"${name}"','SELECT') AS allowed`)).allowed, false);
    }
  }
  console.log(
    'Leadership migration passed: disabled default, isolated projection, idempotent render receipt, private tables and roles.',
  );
} finally {
  await db.close();
}
