import { describe, expect, it } from 'vitest';
import { initialPilotPackage, reconcileReturnedPilotReview } from './submissionPilot';
import { pilotDecisionError } from './pilotReviewChecklist';

describe('returned document review', () => {
  it('allows final completion after all returned documents are approved', () => {
    const p = initialPilotPackage(); p.state = 'CHANGES';
    p.items.forEach(item => { item.waiver = 'Not needed'; item.review = 'APPROVED'; });
    reconcileReturnedPilotReview(p, { status: 'PENDING', workflowState: 'READY_TO_COMPLETE', assignedUserId: 'jr' });
    expect(pilotDecisionError(p, 'APPROVE_INITIAL_DISCLOSURES')).toBeNull();
    expect(p.reviewerId).toBe('jr');
  });
  it.each(['NONE', 'WAITING_ON_LO'])('does not unlock %s tasks', workflowState => {
    const p = initialPilotPackage(); p.state = 'CHANGES';
    reconcileReturnedPilotReview(p, { status: 'PENDING', workflowState, assignedUserId: 'jr' });
    expect(p.state).toBe('CHANGES');
  });
  it.each(['DRAFT', 'APPROVED'] as const)('does not reopen %s packages', state => {
    const p = initialPilotPackage(); p.state = state;
    reconcileReturnedPilotReview(p, { status: 'PENDING', workflowState: 'READY_TO_COMPLETE', assignedUserId: 'jr' });
    expect(p.state).toBe(state);
  });
});
