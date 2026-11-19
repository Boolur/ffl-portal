import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ session: vi.fn(), user: vi.fn(), control: vi.fn(), connection: vi.fn(), count: vi.fn(), row: vi.fn(), tasks: vi.fn(), payroll: vi.fn(), practiceTasks: vi.fn(), loans: vi.fn(), practice: vi.fn(), auditUnique: vi.fn(), auditFirst: vi.fn(), auditMany: vi.fn(), auditCreate: vi.fn(), transaction: vi.fn(), lock: vi.fn(), loanUpdate: vi.fn(), rowUpdate: vi.fn(), taskUpdate: vi.fn(), notesUpsert: vi.fn(), syncUpdate: vi.fn(), api: vi.fn(), apiSession: vi.fn(), notes: vi.fn(), budget: vi.fn(), revalidate: vi.fn(), forbidden: vi.fn() }));
const errors = vi.hoisted(() => ({ AriveError: class AriveError extends Error {} }));
const privateManifest = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('next-auth', () => ({ getServerSession: m.session }));
vi.mock('next/cache', () => ({ revalidatePath: m.revalidate }));
vi.mock('@/lib/auth', () => ({ authOptions: {} }));
vi.mock('@/lib/adminTiers', async () => import('../../lib/adminTiers'));
vi.mock('@/lib/ariveClient', () => ({ AriveError: errors.AriveError, ariveReadOnlySession: m.apiSession, readAriveNotes: m.notes }));
vi.mock('@/lib/ariveTransport', async () => import('../../lib/ariveTransport'));
vi.mock('@/lib/ariveTransportPrisma', () => ({ isAriveBudgetReady: m.budget }));
vi.mock('@/lib/ariveApplicationSnapshot', async () => import('../../lib/ariveApplicationSnapshot'));
vi.mock('@/lib/ariveIdentity', async () => import('../../lib/ariveIdentity'));
vi.mock('@/lib/ariveSyncState', async () => import('../../lib/ariveSyncState'));
vi.mock('@/lib/ariveOneTimeReconciliation', async () => import('../../lib/ariveOneTimeReconciliation'));
vi.mock('@/lib/ariveOneTimeManifest', () => ({ getAriveOneTimeManifest: privateManifest.read }));
vi.mock('@/lib/ariveRollout', () => {
  const stable = (value: unknown): string => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value) ?? 'null';
  return { stableAriveValue: stable, isArivePracticeFile: m.practice, ariveRolloutJson: (value: unknown) => JSON.parse(JSON.stringify(value)) };
});
vi.mock('@/lib/prisma', () => ({ prisma: {
  user: { findUnique: m.user }, ariveRolloutControl: { findUnique: m.control, update: m.forbidden }, ariveIntegrationConfig: { findUnique: m.connection, update: m.forbidden },
  arivePipelineSync: { count: m.count, update: m.syncUpdate }, processingPipelineLoan: { findUnique: m.row, updateMany: m.rowUpdate },
  task: { findMany: m.tasks, updateMany: m.taskUpdate }, payrollCompRequest: { findMany: m.payroll, update: m.forbidden }, pilotPracticeTask: { findMany: m.practiceTasks },
  loan: { findMany: m.loans, updateMany: m.loanUpdate }, ariveLoanNotes: { upsert: m.notesUpsert }, notification: { create: m.forbidden },
  auditLog: { findUnique: m.auditUnique, findFirst: m.auditFirst, findMany: m.auditMany, create: m.auditCreate }, $transaction: m.transaction, $executeRaw: m.lock, $queryRaw: m.lock,
} }));
import { prisma } from '@/lib/prisma';
import { applyAriveOneTimeReconciliation, getAriveOneTimeReconciliationStatus, prepareAriveOneTimeReconciliation } from './ariveOneTimeReconciliationActions';

const PIPELINE = '00000000-0000-4000-8000-000000000001';
const LOAN = '00000000-0000-4000-8000-000000000002';
const NOW = new Date('2026-11-19T20:00:00.000Z');
const APPLIED = 'ARIVE_ONE_TIME_RECONCILIATION_APPLIED';
const syntheticEntry = { loanId: LOAN, pipelineId: PIPELINE, oldNumber: 'OLD-SYNTHETIC', ariveLoanId: '99000001', borrower: 'Synthetic Applicant', sourceName: 'Synthetic Applicant', version: 1, street: '123 Example Lane', city: 'Example City', state: 'CA', zip: '00000', tasks: ['00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000004'] };
const clone = <T>(value: T): T => structuredClone(value);
type Audit = { id: string; userId: string; loanId?: string; action: string; details: string; createdAt: Date };
function initial() {
  return {
    session: { user: { id: 'admin', role: 'ADMIN_III', activeRole: undefined as string | undefined } }, actor: { id: 'admin', active: true, role: 'ADMIN_III', roles: [] as string[] },
    control: { collectionEnabled: false, applicationEnabled: false, enrollmentEnabled: false, generation: 11, updatedAt: NOW }, connection: { encryptedCredentials: 'SYNTHETIC_ENCRYPTED_CREDENTIAL', updatedAt: NOW }, enabled: 0, leases: 0,
    row: { id: PIPELINE, loanId: LOAN, version: 1, sheet: 'PIPELINE', pipelineStatus: 'SUBBED_TO_UW', updatedAt: NOW, statusChangedAt: NOW, movedAt: null, archivedAt: null, archivedById: null, fundedAt: null,
      titleStatus: 'NOT_STARTED', payoffStatus: 'NOT_STARTED', hoiStatus: 'NOT_STARTED', payoffOrderedAt: null, hoiOrderedAt: null, payoffExpiresAt: null,
      appraisalNeeded: null, appraisalOrderedAt: null, appraisalScheduledAt: null, appraisalBackAt: null, cdSent: false, cdWarningStartsAt: null,
      rateLock: false, rateLockExpiresAt: null, rateLockConfirmedAt: null, rateLockRequestedAt: null, rateLockRequestedById: null, approvedWithConditionsAt: null,
      estimatedSigningAt: null, firstPaymentAt: null, sixthPaymentAt: null, missingItemsCurrentStatus: null, loanType: 'HELOC', propertyState: 'CA', lender: 'Synthetic original lender',
      seniorProcessorId: 'senior-preserved', juniorProcessorId: 'junior-preserved', projectedRevenue: '123.45', finalRevenue: '99.99', sourceTaskId: '00000000-0000-4000-8000-000000000004',
      loan: { id: LOAN, loanNumber: 'OLD-SYNTHETIC', borrowerName: 'Synthetic Applicant', borrowerFirstName: 'Synthetic', borrowerLastName: 'Applicant', amount: '100000', program: 'Original program', propertyAddress: '123 Example Lane', borrowerPhone: null, borrowerEmail: null, updatedAt: NOW, loanOfficerId: 'lo-preserved', loanOfficer: { email: 'synthetic-lo@example.test' }, secondaryLoanOfficer: null },
      ariveSync: { enabled: false, ariveGuid: null, lastSuccessAt: null, ariveLoanId: 'OLD-SYNTHETIC', verifiedOriginatorEmail: null, snapshot: {}, collectedSnapshot: {}, fieldSources: {}, conflicts: [], routingProvenance: {}, everFunded: false }, notesSnapshot: null },
    tasks: ['00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004'].map(id => ({ id, loanId: LOAN, status: 'PENDING', workflowState: 'NONE', assignedUserId: 'assignee-preserved', updatedAt: NOW, submissionData: { arriveLoanNumber: 'OLD-SYNTHETIC', immutableHistoricalFact: 'Preserve' } })),
    payroll: [{ id: 'unlinked-financial-record', loanId: null, loanNumber: '99000001', status: 'PENDING_REVIEW', paidAt: null, fundedImportKey: null, splits: [{ id: 'split', amount: '88.00' }] }],
    details: { ariveLoanId: 99000001, sysGUID: 'synthetic-guid', loanOriginatorEmail: 'synthetic-lo@example.test', modifiedDateTime: '2026-11-19T19:00:00Z', archiveIndicator: false,
      loanBorrowers: [{ applicantType: 'Borrower', firstName: 'Synthetic', lastName: 'Applicant', borrowerPairLoanAppSequence: 1 }], subjectTBDIndicator: false,
      subjectProperty: { addressLineText: '123 Example Lane', city: 'Example City', state: 'CA', postalCode: '00000-0000' },
      totalLoanAmount: 123456, mortgageType: 'HELOC', lenderName: 'Synthetic source lender', currentLoanStatus: { status: 'LOAN_FUNDED', date: '2026-11-18' }, loanStatusHistory: [] },
    audits: [] as Audit[], extraLoans: [] as {loanNumber:string}[], practice: false, practiceTasks: [] as {id:string}[], sourceReads: 0,
  };
}
let state: ReturnType<typeof initial>;
let changeDuringRead = false;
let failTaskWrite = false;
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW); vi.stubEnv('VERCEL_ENV', 'production'); vi.stubEnv('NEXTAUTH_SECRET', 'synthetic-test-encryption-secret-not-a-real-secret');
  state = initial(); changeDuringRead = false; failTaskWrite = false;
  privateManifest.read.mockImplementation(async () => [clone(syntheticEntry), ...Array.from({length:6}, (_, i) => ({ ...syntheticEntry, loanId:`synthetic-loan-${i}`,pipelineId:`synthetic-pipeline-${i}`,ariveLoanId:`9900000${i+2}`,borrower:`Synthetic Applicant ${i+2}` }))]);
  m.session.mockImplementation(async () => clone(state.session)); m.user.mockImplementation(async () => clone(state.actor));
  m.control.mockImplementation(async () => clone(state.control)); m.connection.mockImplementation(async () => clone(state.connection));
  m.count.mockImplementation(async (args: {where:Record<string,unknown>}) => 'enabled' in args.where ? state.enabled : 'leaseUntil' in args.where ? state.leases : 0);
  m.row.mockImplementation(async () => { state.sourceReads++; return clone(state.row); }); m.tasks.mockImplementation(async () => clone(state.tasks));
  m.payroll.mockImplementation(async () => clone(state.payroll)); m.practiceTasks.mockImplementation(async () => clone(state.practiceTasks)); m.loans.mockImplementation(async () => clone(state.extraLoans)); m.practice.mockImplementation(async () => state.practice);
  m.budget.mockResolvedValue({ready:true, reason:null}); m.apiSession.mockResolvedValue(m.api);
  m.api.mockImplementation(async (path: string) => {
    if (path.includes('searchField=')) return {count:1,rows:[{ariveLoanId:99000001,sysGUID:'synthetic-guid'}]};
    if (path.endsWith('/trackers')) return {loanTrackers:[{name:'TITLE',currentTrackerStatus:{name:'RECEIVED',date:'2026-11-18'},trackerStatusesHistory:[]}]};
    if (path.includes('/notes')) return {loanNotes:[],count:0};
    if (changeDuringRead) state.row.loan.amount = '123456';
    return clone(state.details);
  });
  m.notes.mockImplementation(async (_id: string, api: (path:string)=>Promise<unknown>) => {await api('/loans/synthetic-guid/notes?limit=100&offset=0'); return [];});
  m.auditCreate.mockImplementation(async ({data}: {data:Omit<Audit,'createdAt'|'id'>&{id?:string}}) => { const row={...data,id:data.id||`audit-${state.audits.length}`,createdAt:new Date()}; state.audits.push(row); return clone(row); });
  m.auditUnique.mockImplementation(async ({where}: {where:{id:string}}) => clone(state.audits.find(a=>a.id===where.id)||null));
  m.auditFirst.mockImplementation(async () => clone(state.audits.find(a=>a.action===APPLIED)||null));
  m.auditMany.mockImplementation(async () => clone(state.audits.filter(a=>a.action===APPLIED)));
  m.transaction.mockImplementation(async (work:(tx:typeof prisma)=>Promise<unknown>) => { const before=clone(state); try{return await work(prisma);}catch(error){state=before;throw error;} });
  m.loanUpdate.mockImplementation(async ({data}: {data:object}) => {Object.assign(state.row.loan,data); return {count:1};});
  m.rowUpdate.mockImplementation(async ({data}: {data:Record<string,unknown>}) => {const fields={...data};delete fields.version;Object.assign(state.row,fields);state.row.version++;return {count:1};});
  m.taskUpdate.mockImplementation(async ({where,data}: {where:{id:string};data:object}) => {if(failTaskWrite)return{count:0};Object.assign(state.tasks.find(t=>t.id===where.id)!,data);return{count:1};});
  m.notesUpsert.mockResolvedValue({}); m.syncUpdate.mockImplementation(async ({data}:{data:object})=>{Object.assign(state.row.ariveSync,data);return{};});
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
async function prepare() {const r=await prepareAriveOneTimeReconciliation({pipelineId:PIPELINE});if(!r.success)throw new Error(r.error);return r.preview;}
function noWorkflowWrites(){for(const fn of [m.loanUpdate,m.rowUpdate,m.taskUpdate,m.notesUpsert,m.syncUpdate,m.forbidden])expect(fn).not.toHaveBeenCalled();}

describe('seven-file one-time reconciliation authorization and transaction boundaries',()=>{
  it.each(['signed out','inactive','forged role','lower admin','wrong active role','preview'])('rejects %s before provider or source access',async scenario=>{
    if(scenario==='signed out')m.session.mockResolvedValue(null);
    if(scenario==='inactive')state.actor.active=false;
    if(scenario==='forged role')state.actor.role='LOAN_OFFICER';
    if(scenario==='lower admin')state.session.user.role='ADMIN_II';
    if(scenario==='wrong active role')state.session.user.activeRole='LOAN_OFFICER';
    if(scenario==='preview')vi.stubEnv('VERCEL_ENV','preview');
    expect((await getAriveOneTimeReconciliationStatus()).success).toBe(false);
    expect((await prepareAriveOneTimeReconciliation({pipelineId:PIPELINE})).success).toBe(false);
    expect((await applyAriveOneTimeReconciliation({planId:'12345678-1234-1234-1234-123456789abc',digest:'a'.repeat(64)})).success).toBe(false);
    expect(m.row).not.toHaveBeenCalled();expect(m.apiSession).not.toHaveBeenCalled();noWorkflowWrites();
  });
  it('cannot select a loan outside the fixed manifest',async()=>{
    expect((await prepareAriveOneTimeReconciliation({pipelineId:'unrelated-real-loan'})).success).toBe(false);
    expect(m.row).not.toHaveBeenCalled();expect(m.apiSession).not.toHaveBeenCalled();noWorkflowWrites();
  });
  it('returns only the seven allowlisted statuses without making provider calls',async()=>{
    const result=await getAriveOneTimeReconciliationStatus();expect(result.success).toBe(true);
    if(result.success){expect(result.rows).toHaveLength(7);expect(result.controls).toEqual({paused:true,generation:11});}
    expect(m.apiSession).not.toHaveBeenCalled();noWorkflowWrites();
  });
  it('respects the shared request budget before sending any provider call',async()=>{
    m.budget.mockResolvedValue({ready:false,reason:'Shared cooldown'});
    expect(await prepareAriveOneTimeReconciliation({pipelineId:PIPELINE})).toMatchObject({success:false,error:'Shared cooldown'});
    expect(m.apiSession).not.toHaveBeenCalled();noWorkflowWrites();
  });
  it.each(['collectionEnabled','applicationEnabled','enrollmentEnabled','enabled','leases'])('refuses to read while %s is active',async field=>{
    if(field==='enabled'||field==='leases')state[field]=1;else Object.assign(state.control,{[field]:true});
    expect((await prepareAriveOneTimeReconciliation({pipelineId:PIPELINE})).success).toBe(false);expect(m.apiSession).not.toHaveBeenCalled();noWorkflowWrites();
  });
  it.each(['duplicate','practice','property','borrower','originator','changed read','task alias'])('rejects %s evidence without workflow writes',async problem=>{
    if(problem==='duplicate')state.extraLoans=[{loanNumber:'099000001'}];
    if(problem==='practice')state.practice=true;
    if(problem==='property')state.details.subjectProperty.addressLineText='999 Wrong Street';
    if(problem==='borrower')state.details.loanBorrowers[0].lastName='Wrong';
    if(problem==='originator')state.details.loanOriginatorEmail='wrong@example.test';
    if(problem==='changed read')changeDuringRead=true;
    if(problem==='task alias')state.tasks[0].submissionData.arriveLoanNumber='other';
    expect((await prepareAriveOneTimeReconciliation({pipelineId:PIPELINE})).success).toBe(false);noWorkflowWrites();expect(m.auditCreate).not.toHaveBeenCalled();
  });
  it('prepares a bounded encrypted comparison and does not enable or apply anything',async()=>{
    const p=await prepare();expect(p.ariveLoanId).toBe('99000001');expect(p.sourceStage).toBe('LOAN_FUNDED');expect(p.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(m.api).toHaveBeenCalledTimes(5);noWorkflowWrites();expect(state.audits).toHaveLength(1);
    expect(state.audits[0].action).toBe('ARIVE_ONE_TIME_RECONCILIATION_PREPARED');expect(state.audits[0].loanId).toBeUndefined();
    expect(state.audits[0].details).not.toContain('Synthetic');expect(state.audits[0].details).not.toContain('SYNTHETIC_ENCRYPTED_CREDENTIAL');
    expect(p).not.toHaveProperty('snapshot');expect(p).not.toHaveProperty('credentialHash');
  });
  it.each(['digest','expired','connection','generation','source','financial','revoked role'])('rejects apply after %s changed',async change=>{
    const p=await prepare();
    if(change==='digest')p.digest='b'.repeat(64);
    if(change==='expired')vi.setSystemTime(new Date(NOW.getTime()+16*60_000));
    if(change==='connection')state.connection.encryptedCredentials='rotated';
    if(change==='generation')state.control.generation++;
    if(change==='source')state.row.loan.amount='120000';
    if(change==='financial')state.payroll[0].splits[0].amount='123';
    if(change==='revoked role')state.actor.active=false;
    expect((await applyAriveOneTimeReconciliation(p)).success).toBe(false);noWorkflowWrites();
  });
  it('rejects a changed private manifest entry before applying the old plan',async()=>{
    const p=await prepare();
    privateManifest.read.mockResolvedValue([{...syntheticEntry,ariveLoanId:'99000099'}]);
    expect((await applyAriveOneTimeReconciliation(p)).success).toBe(false);noWorkflowWrites();
  });
  it('rejects a different administrator, tampered encrypted plan, or role revocation while taking locks',async()=>{
    const p=await prepare();
    state.session.user.id='different-admin';state.actor.id='different-admin';
    expect((await applyAriveOneTimeReconciliation(p)).success).toBe(false);noWorkflowWrites();
    state.session.user.id='admin';state.actor.id='admin';
    const sealed=state.audits[0].details;state.audits[0].details=sealed.replace('encrypted','wrongField');
    expect((await applyAriveOneTimeReconciliation(p)).success).toBe(false);noWorkflowWrites();
    state.audits[0].details=sealed;
    m.user.mockResolvedValueOnce(clone(state.actor)).mockResolvedValueOnce({...state.actor,active:false});
    expect((await applyAriveOneTimeReconciliation(p)).success).toBe(false);noWorkflowWrites();
  });
  it('atomically applies only source-owned facts and exact task aliases, retaining pause and financial state',async()=>{
    const p=await prepare(), payroll=clone(state.payroll), tasks=clone(state.tasks);
    expect(await applyAriveOneTimeReconciliation(p)).toMatchObject({success:true,alreadyApplied:false});
    expect(state.row.loan.loanNumber).toBe('99000001');expect(state.row.loan.amount).toBe(123456);expect(state.row.sheet).toBe('FUNDING');
    expect(state.row.ariveSync).toMatchObject({enabled:false,operatorPaused:true,ariveGuid:'synthetic-guid',enrollmentStatus:'VERIFIED',nextAttemptAt:null,leaseToken:null,leaseUntil:null,manualRefreshRequestedAt:null});
    expect(state.payroll).toEqual(payroll);expect(state.row.projectedRevenue).toBe('123.45');expect(state.row.finalRevenue).toBe('99.99');expect(state.row.loan.loanOfficerId).toBe('lo-preserved');
    state.tasks.forEach((task,index)=>expect(task).toEqual({...tasks[index],submissionData:{...tasks[index].submissionData,arriveLoanNumber:'99000001'}}));
    expect(state.control).toMatchObject({collectionEnabled:false,applicationEnabled:false,enrollmentEnabled:false,generation:11});expect(m.forbidden).not.toHaveBeenCalled();
    expect(m.api).toHaveBeenCalledTimes(5);expect(state.audits.filter(a=>a.action===APPLIED)).toHaveLength(1);
    const writeCount=m.loanUpdate.mock.calls.length;expect(await applyAriveOneTimeReconciliation(p)).toMatchObject({success:true,alreadyApplied:true});expect(m.loanUpdate).toHaveBeenCalledTimes(writeCount);
  });
  it('rolls back preceding writes when a task compare-and-swap fails',async()=>{
    const p=await prepare(), before=clone(state);failTaskWrite=true;
    expect((await applyAriveOneTimeReconciliation(p)).success).toBe(false);expect(m.loanUpdate).toHaveBeenCalled();
    expect(state.row).toEqual(before.row);expect(state.tasks).toEqual(before.tasks);expect(state.payroll).toEqual(before.payroll);expect(state.audits).toEqual(before.audits);
  });
});
