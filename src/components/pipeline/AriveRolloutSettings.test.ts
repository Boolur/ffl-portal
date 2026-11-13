import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/actions/ariveRolloutActions', () => ({}));
import { ariveRolloutRefreshFeedback } from './AriveRolloutSettings';

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
