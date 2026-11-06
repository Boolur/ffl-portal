// Isolated PostgreSQL/WASM regression check. No environment/database credentials
// are read. Install @electric-sql/pglite outside the repo and point
// PORTAL_PGLITE_MODULE to its dist/index.js, then run this script with Node.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { PGlite } = await import(process.env.PORTAL_PGLITE_MODULE
  ? pathToFileURL(process.env.PORTAL_PGLITE_MODULE).href
  : '@electric-sql/pglite');
const db = new PGlite();
const mappings = {
  Task: ['overview', 'pipeline', 'tasks'],
  TaskAttachment: ['overview', 'tasks'],
  Loan: ['overview', 'pipeline', 'tasks'],
  ProcessingPipelineLoan: ['overview', 'pipeline'],
  PayrollCompRequest: ['overview', 'pipeline'],
  PendingStpDisposition: ['overview', 'pipeline'],
  ArivePipelineSync: ['overview', 'pipeline'],
};
const topics = ['overview', 'pipeline', 'tasks'];
let checks = 0;

async function markers() {
  const { rows } = await db.query('SELECT "topic", "version"::text FROM "PortalRevision" ORDER BY "topic"');
  return Object.fromEntries(rows.map(row => [row.topic, Number(row.version)]));
}
function expectDelta(before, after, changed) {
  assert.deepEqual(after, Object.fromEntries(topics.map(topic => [topic, before[topic] + (changed.includes(topic) ? 1 : 0)])));
  checks++;
}

try {
  for (const table of Object.keys(mappings)) {
    await db.exec(`CREATE TABLE "${table}" (id INTEGER PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0);`);
  }
  const migration = await readFile(new URL('../prisma/migrations/20261106230000_portal_change_markers/migration.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  assert.deepEqual(await markers(), { overview: 0, pipeline: 0, tasks: 0 });
  checks++;

  // No marker becomes visible even within the writer until deferred triggers run.
  await db.exec('BEGIN; INSERT INTO "Task" VALUES (1, 0);');
  assert.deepEqual(await markers(), { overview: 0, pipeline: 0, tasks: 0 });
  checks++;
  await db.exec('COMMIT');
  assert.deepEqual(await markers(), { overview: 1, pipeline: 1, tasks: 1 });
  checks++;

  // A rollback drops both records and their pending revision triggers.
  let before = await markers();
  await db.exec('BEGIN; UPDATE "Task" SET value = 1; INSERT INTO "Loan" VALUES (1, 0); ROLLBACK;');
  assert.deepEqual(await markers(), before);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM "Loan"')).rows[0].count, 0);
  checks++;

  // Cross-table and multi-statement bulk work advances each topic once.
  before = await markers();
  const bulkStarted = performance.now();
  await db.exec(`BEGIN;
    INSERT INTO "Task" SELECT n, 0 FROM generate_series(2, 5000) n;
    UPDATE "Task" SET value = value + 1;
    INSERT INTO "ProcessingPipelineLoan" VALUES (1, 0);
    INSERT INTO "TaskAttachment" VALUES (1, 0);
    UPDATE "TaskAttachment" SET value = value + 1;
    COMMIT;`);
  expectDelta(before, await markers(), topics);
  const bulkMs = Math.round(performance.now() - bulkStarted);

  // Transaction-local dedupe flags must reset between requests on one connection.
  for (let i = 0; i < 3; i++) {
    before = await markers();
    await db.exec('UPDATE "Task" SET value = value + 1 WHERE id = 1;');
    expectDelta(before, await markers(), topics);
  }

  // Insert, update and delete all preserve the intended topic mappings.
  for (const [table, expected] of Object.entries(mappings)) {
    for (const statement of [
      `INSERT INTO "${table}" VALUES (9000, 0)`,
      `UPDATE "${table}" SET value = value + 1 WHERE id = 9000`,
      `DELETE FROM "${table}" WHERE id = 9000`,
    ]) {
      before = await markers();
      await db.exec(statement);
      expectDelta(before, await markers(), expected);
    }
  }

  // Savepoint rollback also rolls back locally set flags and trigger work.
  before = await markers();
  await db.exec(`BEGIN; SAVEPOINT discarded;
    UPDATE "Task" SET value = value + 1 WHERE id = 1;
    SET CONSTRAINTS ALL IMMEDIATE;
    ROLLBACK TO discarded;
    UPDATE "TaskAttachment" SET value = value + 1 WHERE id = 1;
    COMMIT;`);
  expectDelta(before, await markers(), mappings.TaskAttachment);

  // An explicit immediate constraint check remains atomic with the transaction.
  before = await markers();
  await db.exec('BEGIN; UPDATE "Task" SET value = value + 1 WHERE id = 1; SET CONSTRAINTS ALL IMMEDIATE; ROLLBACK;');
  assert.deepEqual(await markers(), before);
  checks++;

  const secured = await db.query(`SELECT relrowsecurity AS enabled FROM pg_class WHERE oid = '"PortalRevision"'::regclass`);
  assert.equal(secured.rows[0].enabled, true);
  checks++;
  await db.exec(`CREATE ROLE portal_marker_reader; GRANT SELECT ON "PortalRevision" TO portal_marker_reader; SET ROLE portal_marker_reader;`);
  assert.equal((await db.query('SELECT * FROM "PortalRevision"')).rows.length, 0);
  await db.exec('RESET ROLE');
  checks++;

  console.log(JSON.stringify({ result: 'passed', checks, bulkRows: 5000, bulkInsertAndUpdateMs: bulkMs, storage: 'isolated in-memory PostgreSQL (PGlite)' }));
} finally {
  await db.close();
}
