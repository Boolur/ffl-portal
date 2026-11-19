import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('./prisma', () => ({prisma:{}}));
vi.mock('@/lib/prisma', () => ({prisma:{}}));
vi.mock('@/lib/ariveCrypto', () => ({decryptAriveCredentials:vi.fn(),encryptAriveCredentials:vi.fn()}));
vi.mock('./ariveClient', () => ({ariveLeadershipPilotReadSession:vi.fn()}));
import { recordPilotBorrowerAttestation } from './arivePilotAttestation';
import { corroboratedPilotIdentityHash } from './ariveLeadershipPilotIdentity';
import { pilotMiddleNameReview } from './arivePilotAttestationTypes';

function fixture() {
  const revision = new Date(), now = new Date();
  const number = '12345', guid = 'fixture-guid', branch = 'Example Branch';
  const loan = {id:'test-loan', loanNumber:number, borrowerFirstName:'Example',borrowerLastName:'Middle',borrowerName:'Example Middle',
    loanOfficer:{email:'user@example.test'},secondaryLoanOfficer:null,amount:150000,propertyAddress:'1 Example St, Town, CA 91000',
    borrowerPhone:'2025550155',borrowerEmail:null,program:null};
  const row = {id:'file',loan,loanId:loan.id,pilotArive:{ ariveLoanId:number,lastAttemptAt:now,enrollmentStatus:'REVIEW',
    enrollmentIssue:pilotMiddleNameReview,borrowerAttestation:null,connectionRevision:revision,identityHash:corroboratedPilotIdentityHash(loan),leaseUntil:null }};
  const report={ number,name:'Example Middle Family',officerEmail:loan.loanOfficer.email,branch };
  const details={ ariveLoanId:number,sysGUID:guid,loanOriginatorEmail:loan.loanOfficer.email,baseLoanAmount:150000,orgUnitDisplayName:branch,
    subjectProperty:{addressLineText:'1 Example St',city:'Town',state:'CA',postalCode:'91000'},
    loanBorrowers:[{applicantType:'Borrower',firstName:'Example',lastName:'Family',mobilePhone10digit:loan.borrowerPhone}] };
  const control={enabled:true,generation:5};
  const tx={
    processingPipelineLoan:{findFirst:vi.fn().mockResolvedValue(row)},loan:{count:vi.fn().mockResolvedValue(1)},
    ariveIntegrationConfig:{findUnique:vi.fn().mockResolvedValue({updatedAt:revision})},
    pilotAriveControl:{findUnique:vi.fn().mockResolvedValue(control),update:vi.fn()},arivePracticeLoan:{findFirst:vi.fn().mockResolvedValue(null)},
    user:{findFirst:vi.fn().mockResolvedValue({id:'operator'})},pilotAriveProjection:{update:vi.fn()},
    $executeRaw:vi.fn(), $queryRaw:vi.fn().mockResolvedValue([{number,loanId:loan.id,outcome:'IDENTITY_MISMATCH',borrowerOnly:true}]),
  };
  const db={...tx,$transaction:vi.fn(async f=>f(tx))};
  const search={count:1,rows:[{ariveLoanId:number,sysGUID:guid}]};
  const api=vi.fn().mockResolvedValueOnce(search).mockResolvedValueOnce(details);
  const session=vi.fn().mockResolvedValue(api);
  const run=(role='ADMIN_III', checked:unknown=true, pilot=true) => recordPilotBorrowerAttestation(
    {id:'operator',role,canViewGeneralizedArive:pilot} as never,row.id,report,checked as boolean,db as never,session);
  return {tx,run,db,api,row,control,report,session,revision};
}
describe('private, single-file middle-name attestation',()=>{
  it('queues one private verification with actor provenance after both official source checks',async()=>{
    const f=fixture();
    expect(await f.run()).toBe(true);
    expect(f.tx.pilotAriveProjection.update).toHaveBeenCalledWith({where:{pipelineId:'file'},data:{
      borrowerAttestation:expect.objectContaining({operatorId:'operator',ariveGuid:'fixture-guid',boundEvidence:expect.stringMatching(/^[a-f0-9]{64}$/)}),
      manualRefreshRequestedAt:expect.any(Date), nextAttemptAt:expect.any(Date)}});
    Object.assign(f.row.pilotArive,{borrowerAttestation:{version:1}});
    expect(await f.run()).toBe(false);
    expect(f.session).toHaveBeenCalledTimes(1);
  });
  it('denies Standard, forged confirmation and non-Admin III roles before any reads',async()=>{
    const f=fixture();
    for(const role of ['ADMIN_II','MANAGER','LOAN_OFFICER','PROCESSOR_JR']) expect(await f.run(role)).toBe(false);
    expect(await f.run('ADMIN_III','false')).toBe(false);
    expect(await f.run('ADMIN_III',true,false)).toBe(false);
    expect(f.tx.processingPipelineLoan.findFirst).not.toHaveBeenCalled();
  });
  it.each(['role','pause','rotate','duplicate','practice','issue','source','history','branch','priorGuid','pinnedGuid'])('blocks %s changes during verification',async(change)=>{
    const f=fixture();
    if(change==='role') f.tx.user.findFirst.mockResolvedValue(null);
    if(change==='pause') f.tx.pilotAriveControl.findUnique.mockResolvedValueOnce(f.control).mockResolvedValueOnce({...f.control,generation:6});
    if(change==='rotate') f.tx.ariveIntegrationConfig.findUnique.mockResolvedValueOnce({updatedAt:f.revision}).mockResolvedValueOnce({updatedAt:new Date(+f.revision+10000)});
    if(change==='duplicate') f.tx.loan.count.mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    if(change==='practice') f.tx.arivePracticeLoan.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ariveLoanId:f.report.number});
    if(change==='issue') f.row.pilotArive.enrollmentIssue='A different review';
    if(change==='source') f.tx.processingPipelineLoan.findFirst.mockResolvedValueOnce(f.row).mockResolvedValueOnce({...f.row,loan:{...f.row.loan,propertyAddress:'Other'}});
    if(change==='history') f.tx.$queryRaw.mockResolvedValue([]);
    if(change==='branch') f.report.branch='Another';
    if(change==='priorGuid') Object.assign(f.row.pilotArive,{ariveGuid:'old-file'});
    if(change==='pinnedGuid') f.tx.processingPipelineLoan.findFirst.mockResolvedValueOnce(f.row).mockResolvedValueOnce({...f.row,
      ariveSync:{ariveLoanId:f.report.number,ariveGuid:'old-file',enrollmentStatus:'VERIFIED'}});
    expect(await f.run()).toBe(false);
    expect(f.tx.pilotAriveProjection.update).not.toHaveBeenCalled();
  });
});
