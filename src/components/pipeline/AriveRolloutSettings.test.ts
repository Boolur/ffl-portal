import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/ariveRolloutActions', () => ({}));
import { ariveRolloutBudgetDescription, ariveRolloutEnrollmentFeedback, ariveRolloutRefreshFeedback } from './AriveRolloutSettings';

describe('operator sync feedback', () => {
  it('does not present a queued refresh as applied or freshly read', () => {
    const message = ariveRolloutRefreshFeedback({ success: true, queued: true });
    expect(message).toContain('Refresh queued');
    expect(message).not.toContain('Arive checked');
    expect(message).not.toContain('applied');
  });

  it('distinguishes a saved preview from a live update', () => {
    const message = ariveRolloutRefreshFeedback({ success: true, queued: false, applied: false, collected: true, changed: false });
    expect(message).toContain('snapshot is saved for review');
    expect(message).toContain('applying updates to live loans is paused');
    expect(message).not.toContain('already up to date');
  });

  it('reports a successfully applied changed file', () => {
    expect(ariveRolloutRefreshFeedback({ success: true, queued: false, applied: true, collected: true, changed: true }))
      .toContain('Updated values have been applied to the live BISU file');
  });

  it('reports an unchanged file only after successful application', () => {
    expect(ariveRolloutRefreshFeedback({ success: true, queued: false, applied: true, collected: true, changed: false }))
      .toContain('already up to date');
    expect(ariveRolloutRefreshFeedback({ success: true, queued: false, applied: false, collected: false, changed: false }))
      .not.toContain('already up to date');
    expect(ariveRolloutRefreshFeedback({ success: true, applied: true })).not.toContain('already up to date');
  });

  it('does not infer completed collection from a generic successful response', () => {
    const message = ariveRolloutRefreshFeedback({ success: true });
    expect(message).toContain('Review the latest collection and application timestamps');
    expect(message).not.toContain('Arive checked');
    expect(message).not.toContain('applied');
  });
});

describe('operator budget and enrollment feedback', () => {
  it('labels the effective operator cap without presenting it as Arive confirmation', () => {
    const message = ariveRolloutBudgetDescription({ allowanceSource: 'OPERATOR_AUTHORIZED', operatorRequestLimit: 60, allowance: 60, providerRequestLimit: null, windowSeconds: 60 });
    expect(message).toBe('Operator-authorized cap: 60 requests per minute. Arive’s provider allowance is unconfirmed.');
    expect(message).not.toContain('Provider-confirmed allowance');
  });
  it('retains provider wording only for a provider budget and tolerates older data', () => {
    expect(ariveRolloutBudgetDescription({ providerRequestLimit: 1000, windowSeconds: 60 })).toContain('Provider-confirmed allowance: 1000');
    expect(ariveRolloutBudgetDescription({ allowanceSource: 'PROVIDER_CONFIRMED', providerRequestLimit: 1000, windowSeconds: 60 })).toContain('80%');
    expect(ariveRolloutBudgetDescription({})).toBe('No request budget is configured.');
    expect(ariveRolloutBudgetDescription({ allowanceSource: 'UNKNOWN' })).toBe('No request budget is configured.');
  });
  it('reports actual enrollment outcomes and distinguishes checked files from newly verified files', () => {
    const message = ariveRolloutEnrollmentFeedback({ success: true, scanned: 25, verified: 7, review: 2 });
    expect(message).toContain('25 files checked · 7 verified · 2 need review');
    expect(message).toContain('Existing verified files may be included');
    expect(ariveRolloutEnrollmentFeedback({ success: true })).not.toContain('undefined');
  });
});
