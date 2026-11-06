export const ARIVE_SYNC_PILOT = {
  loanNumber: '17881588',
  loanId: 'e29decf7-02e7-4032-929f-348e0822868f',
  ownerId: '2e28c6a5-67c0-442d-94bd-59897ad8d8cd',
  borrowerName: 'TESTING TESTER',
} as const;

export type AriveSyncIssue = { field: string; code: string; message: string };
export type AriveSyncConflict = {
  field: string; label: string; portalValue: string | null; ariveValue: string | null; detectedAt: string;
};
export type AriveSyncView = {
  enabled: boolean;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  error: string | null;
  stage: string | null;
  stageLabel: string | null;
  stageDate: string | null;
  conflicts: AriveSyncConflict[];
  missingFields: string[];
  issues: AriveSyncIssue[];
  managedFields: string[];
  canManage: boolean;
  structuredFields?: { key: string; label: string; value: string | null; author: string; updatedAt: string | null }[];
};

export function ariveSyncFieldLabel(field: string) {
  const labels: Record<string, string> = {
    pipelineStatus: 'Loan stage', sheet: 'Pipeline section', statusChangedAt: 'Stage date',
    titleStatus: 'Title', payoffStatus: 'Payoff', hoiStatus: 'Homeowners insurance',
    payoffOrderedAt: 'Payoff ordered', payoffExpiresAt: 'Payoff expiry', hoiOrderedAt: 'Insurance ordered',
    estimatedSigningAt: 'Scheduled signing', missingItemsCurrentStatus: 'Pending items',
    rateLock: 'Rate lock', rateLockExpiresAt: 'Lock expiration', rateLockConfirmedAt: 'Lock confirmation date',
    appraisalNeeded: 'Appraisal required', appraisalOrderedAt: 'Appraisal ordered',
    appraisalScheduledAt: 'Appraisal scheduled', appraisalBackAt: 'Appraisal received',
    cdSent: 'Closing disclosure sent', cdWarningStartsAt: 'Closing disclosure reminder date',
    fundedAt: 'Funding date', approvedWithConditionsAt: 'Conditional approval date',
  };
  return labels[field] || field.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase());
}
