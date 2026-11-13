import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Offline PostgreSQL verification only. No Prisma Client, application imports,
// dotenv loading, database connection string from the environment, or remote DB.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
assert((args.length === 2 || args.length === 4 && args[2] === '--baseline-ref' && /^[a-f0-9]{40}$/i.test(args[3])) && args[0] === '--runtime' && isAbsolute(args[1]),
  'Usage: node src/scripts/verifyPilotSchema.mjs --runtime <absolute @electric-sql/pglite package directory> [--baseline-ref <40-character commit>]');
// Pin the pre-migration baseline so this verifier remains repeatable after commit.
const baselineRef = args[3] ?? '94814d4e90c54d87a14c724bdf2ba0acd5e4a648';
const runtime = resolve(args[1]);
const metadata = JSON.parse(readFileSync(join(runtime, 'package.json'), 'utf8'));
assert.equal(metadata.name, '@electric-sql/pglite');
const scratch = mkdtempSync(join(tmpdir(), 'bisu-pilot-offline-schema-'));
const childEnvironment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT'].includes(key.toUpperCase())));
Object.assign(childEnvironment, { CHECKPOINT_DISABLE: '1', PRISMA_HIDE_UPDATE_MESSAGE: '1',
  DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:1/offline',
  DIRECT_URL: 'postgresql://offline:offline@127.0.0.1:1/offline' });
function run(command, commandArgs, cwd) {
  const result = spawnSync(command, commandArgs, { cwd, env: childEnvironment, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, timeout: 60_000 });
  if (result.error || result.status !== 0) throw new Error(`Offline ${command === process.execPath ? 'Prisma diff' : 'Git schema read'} failed: ${result.stderr || result.error?.message || result.status}`);
  return result.stdout;
}
function schemaSql(schema, filename) {
  // The schema lives outside the repository so Prisma cannot discover its .env.
  const path = join(scratch, filename);
  writeFileSync(path, schema.replace(/env\("(?:DATABASE_URL|DIRECT_URL)"\)/g, '"postgresql://offline:offline@127.0.0.1:1/offline"'));
  const sql = run(process.execPath, [join(root, 'node_modules/prisma/build/index.js'), 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', path, '--script'], scratch);
  writeFileSync(`${path}.sql`, sql);
  return sql;
}
const baseline = schemaSql(run('git', ['show', `${baselineRef}:prisma/schema.prisma`], root), 'baseline.prisma');
const expected = schemaSql(readFileSync(join(root, 'prisma/schema.prisma'), 'utf8'), 'expected.prisma');
const migrationNames = ['20261112190000_pilot_rollout_infrastructure', '20261113003000_arive_operator_request_budget'];
const migrations = migrationNames.map(name => readFileSync(join(root, 'prisma/migrations', name, 'migration.sql'), 'utf8'));
const migration = migrations.join('\n');
assert(!/^\s*(?:DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im.test(migration), 'Migration must remain additive.');
assert(!/\bALTER\s+TABLE[^;]+\bDROP\b/i.test(migration), 'Migration must not drop existing columns or constraints.');
writeFileSync(join(scratch, 'migration.sql'), migration);

// PGlite reads its local WASM package. Reject accidental JavaScript HTTP access.
globalThis.fetch = async () => { throw new Error('Network access is forbidden in offline schema verification.'); };
const { PGlite } = await import(pathToFileURL(join(runtime, 'dist/index.js')).href);
const db = new PGlite();
const target = new PGlite();
const checks = [];
const check = (name, fn) => fn().then(() => checks.push(name));
const queryRows = async (database, sql, values = []) => (await database.query(sql, values)).rows;
const one = async (sql, values = []) => (await queryRows(db, sql, values))[0];
const snapshot = async table => queryRows(db, `SELECT * FROM "${table}" ORDER BY "id"`);
const canonicalTables = ['User', 'Loan', 'Task', 'ProcessingPipelineLoan', 'ArivePipelineSync', 'Notification', 'AuditLog'];
async function structure(database) {
  const columns = await queryRows(database, `SELECT table_name, column_name, ordinal_position, data_type, udt_name, is_nullable, column_default, character_maximum_length, numeric_precision, numeric_scale, datetime_precision FROM information_schema.columns WHERE table_schema='public' ORDER BY table_name,column_name`);
  // ALTER ADD appends columns, while fresh CREATE follows datamodel order.
  const normalizedColumns = columns.map(({ ordinal_position: _position, ...column }) => column);
  const indexes = await queryRows(database, `SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname`);
  const constraints = await queryRows(database, `SELECT t.relname AS table_name,c.conname,pg_get_constraintdef(c.oid) AS definition FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace WHERE n.nspname='public' ORDER BY t.relname,c.conname`);
  const enums = await queryRows(database, `SELECT t.typname,e.enumlabel,e.enumsortorder FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' ORDER BY t.typname,e.enumsortorder`);
  return { columns: normalizedColumns, indexes, constraints, enums };
}
try {
  await db.exec(baseline);
  await db.exec(`
    INSERT INTO "User" ("id","email","name","role","updatedAt") VALUES ('offline-owner','offline-owner@example.invalid','Synthetic Schema Owner','ADMIN_III','2026-11-12T00:00:00Z');
    INSERT INTO "Loan" ("id","loanNumber","borrowerName","amount","loanOfficerId","updatedAt") VALUES ('offline-loan','900000000001','Synthetic Schema Borrower',12345.67,'offline-owner','2026-11-12T00:00:00Z');
    INSERT INTO "Task" ("id","title","loanId","kind","submissionData","updatedAt") VALUES ('offline-task','Synthetic existing processing task','offline-loan','SUBMIT_PROCESSING','{"existing":true}','2026-11-12T00:00:00Z');
    INSERT INTO "ProcessingPipelineLoan" ("id","loanId","sourceTaskId","lender","finalRevenue","version","updatedAt") VALUES ('offline-pipeline','offline-loan','offline-task','Synthetic existing lender',456.78,7,'2026-11-12T00:00:00Z');
    INSERT INTO "ArivePipelineSync" ("id","pipelineId","enabled","enabledById","ariveLoanId","ariveGuid","snapshot","failureCount","updatedAt") VALUES ('offline-sync','offline-pipeline',true,'offline-owner','900000000001','offline-guid','{"existingSnapshot":true}',3,'2026-11-12T00:00:00Z');
  `);
  const before = Object.fromEntries(await Promise.all(canonicalTables.map(async table => [table, await snapshot(table)])));
  await db.exec(migrations[0]);
  await db.exec(`INSERT INTO "AriveConnectionRuntime" ("id","enabled","providerRequestLimit","providerWindowSeconds","quotaConfirmedAt","updatedAt") VALUES ('existing-provider',true,100,60,'2026-11-12T00:00:00Z',CURRENT_TIMESTAMP);`);
  const providerBefore = await one('SELECT * FROM "AriveConnectionRuntime" WHERE "id"=$1', ['existing-provider']);
  await db.exec(migrations[1]);
  await check('Operator budget migration preserves provider configuration and does not authorize operator polling', async () => {
    const after = await one('SELECT * FROM "AriveConnectionRuntime" WHERE "id"=$1', ['existing-provider']);
    for (const key of Object.keys(providerBefore)) assert.deepEqual(after[key], providerBefore[key]);
    assert.equal(after.allowanceSource, 'PROVIDER_CONFIRMED');
    for (const key of ['operatorRequestLimit', 'operatorAuthorizedAt', 'operatorAuthorizedById']) assert.equal(after[key], null);
  });
  await check('Existing business values and enabled legacy integration survive unchanged', async () => {
    for (const table of canonicalTables) {
      const after = await snapshot(table);
      assert.equal(after.length, before[table].length, `${table} row count changed`);
      for (let i = 0; i < after.length; i++) for (const key of Object.keys(before[table][i])) assert.deepEqual(after[i][key], before[table][i][key], `${table}.${key} changed`);
    }
    const legacy = await one('SELECT "enabled","workerOwner","workerGeneration","connectionId","enrollmentStatus","operatorPaused","everFunded","collectedSnapshot","routingProvenance" FROM "ArivePipelineSync" WHERE "id"=$1', ['offline-sync']);
    assert.deepEqual(legacy, { enabled: true, workerOwner: 'LEGACY', workerGeneration: 0, connectionId: 'company', enrollmentStatus: 'VERIFIED', operatorPaused: false, everFunded: false, collectedSnapshot: {}, routingProvenance: {} });
    assert.equal((await one('SELECT "pilotViewEnabled" FROM "User" WHERE "id"=$1', ['offline-owner'])).pilotViewEnabled, false);
  });
  await check('Fresh rollout and shared transport controls default off', async () => {
    await db.exec(`INSERT INTO "AriveRolloutControl" ("updatedAt") VALUES (CURRENT_TIMESTAMP); INSERT INTO "AriveConnectionRuntime" ("id","updatedAt") VALUES ('company',CURRENT_TIMESTAMP);`);
    assert.deepEqual(await one('SELECT "collectionEnabled","applicationEnabled","enrollmentEnabled","cohortLimit","generation" FROM "AriveRolloutControl"'), { collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false, cohortLimit: 10, generation: 0 });
    assert.deepEqual(await one('SELECT "enabled","providerRequestLimit","providerWindowSeconds","quotaConfirmedAt","encryptedAccessToken","allowanceSource","operatorRequestLimit","operatorAuthorizedAt","operatorAuthorizedById" FROM "AriveConnectionRuntime" WHERE "id"=\'company\''), { enabled: false, providerRequestLimit: null, providerWindowSeconds: null, quotaConfirmedAt: null, encryptedAccessToken: null, allowanceSource: 'PROVIDER_CONFIRMED', operatorRequestLimit: null, operatorAuthorizedAt: null, operatorAuthorizedById: null });
  });
  await check('Migration structure exactly matches the current Prisma datamodel', async () => {
    await target.exec(expected);
    assert.deepEqual(await structure(db), await structure(target));
  });
  await check('Practice writes and cascades cannot modify canonical tasks, loans, notifications, or audits', async () => {
    const canonicalBefore = Object.fromEntries(await Promise.all(canonicalTables.map(async table => [table, await snapshot(table)])));
    await db.exec(`
      INSERT INTO "PilotPracticeTask" ("id","ownerId","sourceTaskId","sourceLoanId","title","snapshot","updatedAt") VALUES ('practice-task','offline-owner','offline-task','offline-loan','Synthetic practice only','{}',CURRENT_TIMESTAMP);
      INSERT INTO "PilotPracticePackage" ("id","taskId","items") VALUES ('practice-package','practice-task','[]');
      INSERT INTO "PilotPracticeFile" ("id","packageId","itemId","name","type","size","sourceAttachmentId") VALUES ('practice-file','practice-package','synthetic-item','synthetic.txt','text/plain',10,'nonexistent-synthetic-source');
      INSERT INTO "PilotPracticeEvent" ("id","taskId","actorId","persona","action","message") VALUES ('practice-event','practice-task','offline-owner','JR','REVIEW','Synthetic review');
      INSERT INTO "PilotPracticeNotification" ("id","taskId","persona","message") VALUES ('practice-notification','practice-task','LO','Synthetic notification');
      UPDATE "PilotPracticeTask" SET "state"='COMPLETED',"draft"='{"changed":true}',"version"="version"+1 WHERE "id"='practice-task';
      DELETE FROM "PilotPracticeTask" WHERE "id"='practice-task';
    `);
    for (const table of ['PilotPracticeTask', 'PilotPracticePackage', 'PilotPracticeFile', 'PilotPracticeEvent', 'PilotPracticeNotification']) {
      assert.equal((await one(`SELECT count(*)::integer AS count FROM "${table}"`)).count, 0, `${table} cascade failed`);
    }
    for (const table of canonicalTables) assert.deepEqual(await snapshot(table), canonicalBefore[table], `Practice changed ${table}`);
    const crossReferences = await queryRows(db, `SELECT source.relname AS source,target.relname AS target FROM pg_constraint c JOIN pg_class source ON source.oid=c.conrelid JOIN pg_class target ON target.oid=c.confrelid WHERE c.contype='f' AND source.relname LIKE 'PilotPractice%' AND target.relname NOT LIKE 'PilotPractice%'`);
    assert.deepEqual(crossReferences, []);
  });
  await check('Practice source references survive deletion of the synthetic canonical source', async () => {
    await db.exec(`INSERT INTO "PilotPracticeTask" ("id","ownerId","sourceTaskId","sourceLoanId","title","snapshot","updatedAt") VALUES ('practice-survivor','offline-owner','offline-task','offline-loan','Synthetic detached practice','{}',CURRENT_TIMESTAMP); DELETE FROM "Loan" WHERE "id"='offline-loan';`);
    assert.deepEqual(await one('SELECT "sourceTaskId","sourceLoanId","state","draft" FROM "PilotPracticeTask" WHERE "id"=$1', ['practice-survivor']), { sourceTaskId: 'offline-task', sourceLoanId: 'offline-loan', state: 'DRAFT', draft: {} });
  });
  const report = { passed: checks.length, checks, baselineCommit: baselineRef, runtime: `PGlite ${metadata.version}`, temporaryArtifacts: scratch, network: 'No database connections or JavaScript network requests; all rows synthetic and in memory.' };
  writeFileSync(join(scratch, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await db.close(); await target.close(); }
