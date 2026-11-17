/** Admin-only read projections. No credentials, provider bodies, or sync mutations. */
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
  rows: ActivePipelineDiagnosticRow[];
};

export type ActivePipelineDiagnosticResponse =
  | { success: true; run: ActivePipelineDiagnosticRun | null }
  | { success: false; error: string };
