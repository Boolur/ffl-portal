/** Narrow, admin-only identity evidence. Never includes complete provider responses. */
export type ActiveDiagnosticObservedIdentity = {
  loanNumber: string | null;
  guid: string | null;
  originatorEmail: string | null;
  borrowers: string[];
  issues: string[];
  team?: Array<{ email: string | null; role: string | null; primary: boolean | null }>;
  otherApplicants?: Array<{ name: string | null; applicantType: string | null }>;
  teamEvidenceSource?: 'DETAIL';
};
export type ActiveDiagnosticEvidence = {
  portal: {
    loanNumber: string;
    savedGuid: string | null;
    primaryOriginatorEmail: string | null;
    secondaryOriginatorEmail: string | null;
    savedOriginatorEmail: string | null;
    borrowerName: string | null;
  };
  search?: ActiveDiagnosticObservedIdentity;
  detail?: ActiveDiagnosticObservedIdentity;
  numericProbe?: { httpStatus: number | null; requestId: string | null; identity?: ActiveDiagnosticObservedIdentity };
  borrowerSearch?: { httpStatus: number | null; requestId: string | null; count: number | null; complete: boolean; candidatesTruncated: boolean; candidates: ActiveDiagnosticObservedIdentity[] };
};

/** Admin-only read projections. No credentials, complete provider bodies, or sync mutations. */
export type ActivePipelineDiagnosticRow = {
  pipelineId: string;
  loanNumber: string;
  borrowerName: string;
  loanOfficer: string;
  synthetic: boolean;
  outcome: string;
  message: string;
  checkedAt: string | null;
  searchHttpStatus: number | null;
  detailHttpStatus: number | null;
  requestId: string | null;
  evidence?: ActiveDiagnosticEvidence;
};

export type ActivePipelineDiagnosticRun = {
  id: string;
  status: 'READY' | 'RUNNING' | 'DEFERRED' | 'COMPLETE' | 'CANCELLED' | 'INVALIDATED';
  startedAt: string;
  finishedAt: string | null;
  total: number;
  checked: number;
  matched: number;
  needsReview: number;
  realTotal: number;
  syntheticTotal: number;
  realMatched: number;
  syntheticMatched: number;
  getRequests: number;
  authenticationRequests: number;
  retryAt: string | null;
  message: string | null;
  automaticSyncPaused: boolean;
  currentActiveCount: number;
  addedSinceStart: number;
  changedSinceStart: number;
  scope?: 'FULL' | 'FOLLOW_UP';
  parentRunId?: string;
  rootRunId?: string;
  baselineTotal?: number;
  rows: ActivePipelineDiagnosticRow[];
};

export type ActivePipelineDiagnosticResponse =
  | { success: true; run: ActivePipelineDiagnosticRun | null }
  | { success: false; error: string };
