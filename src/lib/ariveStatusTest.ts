export const ARIVE_STATUS_TEST_LOAN_NUMBER = '17881588';
export const ARIVE_TEST_STAGES = ['APPLICATION_INTAKE', 'QUALIFICATION', 'LOAN_SETUP', 'UNDERWRITING_SUBMITTED'] as const;
export type AriveTestStage = typeof ARIVE_TEST_STAGES[number];
const knownStages = new Set<string>([...ARIVE_TEST_STAGES, 'PREAPPROVED', 'DISCLOSURE_SENT', 'APPROVED_WITH_CONDITION', 'RE_SUBMITTAL', 'CLEAR_TO_CLOSE', 'DOCS_OUT', 'DOCS_SIGNED', 'LOAN_FUNDED', 'BROKER_CHECK_RECEIVED', 'COMMISSION_PAID', 'SUSPENDED']);

export class AriveStatusTestError extends Error {}
export type AriveStageEntry = { stage: string; date: string };
export type AriveTestLoanStatus = {
  id: string; stage: string; date: string; archived: boolean; history: AriveStageEntry[];
};
export type AriveTestStatusSnapshot = {
  readId: string; stage: string; date: string; historyCount: number; checkedAt: string; canChange: boolean;
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AriveStatusTestError('Arive returned an unexpected test-loan response.');
  return value as Record<string, unknown>;
}
function normalized(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').toLowerCase() : '';
}
function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const day = value.slice(0, 10);
  const dayDate = new Date(`${day}T00:00:00.000Z`);
  return Number.isFinite(dayDate.getTime()) && dayDate.toISOString().slice(0, 10) === day && Number.isFinite(Date.parse(value));
}
function stageEntry(value: unknown): AriveStageEntry {
  const record = object(value);
  if (typeof record.status !== 'string' || !knownStages.has(record.status) || !validDate(record.date) || record.adverseReason) {
    throw new AriveStatusTestError('Arive stage history could not be safely preserved. No stage update was sent.');
  }
  return { stage: record.status, date: record.date };
}

/** Validate the remote identity on every read, including readback after a write. */
export function parseAriveTestLoanStatus(value: unknown, expectedOriginatorEmail: string): AriveTestLoanStatus {
  const details = object(value);
  const borrowers = Array.isArray(details.loanBorrowers) ? details.loanBorrowers : [];
  const primary = borrowers.map(object).filter(b => b.applicantType === 'Borrower');
  if (String(details.ariveLoanId) !== ARIVE_STATUS_TEST_LOAN_NUMBER || typeof details.sysGUID !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(details.sysGUID)
      || !expectedOriginatorEmail.trim() || normalized(details.loanOriginatorEmail) !== normalized(expectedOriginatorEmail)
      || primary.length !== 1 || normalized(primary[0].firstName) !== 'testing' || normalized(primary[0].lastName) !== 'tester') {
    throw new AriveStatusTestError('Arive did not confirm TESTING TESTER, loan 17881588, and Matt as its originator. No stage update was sent.');
  }
  const current = stageEntry(details.currentLoanStatus);
  if (details.archiveIndicator != null && typeof details.archiveIndicator !== 'boolean') throw new AriveStatusTestError('Arive did not confirm whether the test loan is archived. No stage update was sent.');
  if (!Array.isArray(details.loanStatusHistory) || details.loanStatusHistory.length > 100) throw new AriveStatusTestError('Arive stage history is unavailable. No stage update was sent.');
  const history = details.loanStatusHistory.map(stageEntry);
  if (!history.some(entry => entry.stage === current.stage && Date.parse(entry.date) === Date.parse(current.date))) history.push(current);
  return { id: details.sysGUID, stage: current.stage, date: current.date, archived: details.archiveIndicator === true, history };
}

export function canChangeAriveTestStage(value: AriveTestLoanStatus): boolean {
  return !value.archived && (ARIVE_TEST_STAGES as readonly string[]).includes(value.stage);
}

/** Retain every existing stage/date. Returning to an existing stage retains its date. */
export function buildAriveTestStageUpdate(before: AriveTestLoanStatus, expected: string, target: string, today: string) {
  if (!(ARIVE_TEST_STAGES as readonly string[]).includes(target) || !canChangeAriveTestStage(before)) throw new AriveStatusTestError('Status testing is limited to active test files in intake, qualification, setup, or underwriting submission.');
  if (before.stage !== expected) throw new AriveStatusTestError('The Arive stage changed. Read it again before updating.');
  if (target === before.stage) throw new AriveStatusTestError('Choose a different test stage.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today) || !validDate(today)) throw new AriveStatusTestError('A valid stage date is required.');
  const stages = before.history.map(entry => ({ stage: entry.stage, stageDate: entry.date, current: false }));
  let targetIndex = -1;
  stages.forEach((entry, index) => { if (entry.stage === target) targetIndex = index; });
  if (targetIndex < 0) stages.push({ stage: target, stageDate: today, current: true });
  else stages[targetIndex].current = true;
  return { loanStages: stages };
}

export function ariveTestHistoryPreserved(before: AriveTestLoanStatus, after: AriveTestLoanStatus): boolean {
  const available = after.history.map(entry => `${entry.stage}:${Date.parse(entry.date)}`);
  return before.history.every(entry => {
    const index = available.indexOf(`${entry.stage}:${Date.parse(entry.date)}`);
    if (index < 0) return false;
    available.splice(index, 1);
    return true;
  });
}
