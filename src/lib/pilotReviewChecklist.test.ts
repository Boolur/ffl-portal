import { describe, expect, it } from 'vitest';
import { initialPilotPackage } from './submissionPilot';
import { pilotReviewChecklist, pilotDecisionError } from './pilotReviewChecklist';

describe('unified processing review', () => {
  it('keeps existing checklist identifiers and maps file / N/A decisions', () => {
    const p = initialPilotPackage();
    p.items[0].review = 'APPROVED';
    p.items[1].review = 'APPROVED'; p.items[1].waiver = 'Not applicable';
    p.items[2].review = 'CHANGES'; p.items[2].feedback = 'Updated paystub needed';
    const { items } = pilotReviewChecklist(p);
    expect(items[0]).toMatchObject({ id: 'mortgage-documents', status: 'GREEN_CHECK', noteOption: 'CONFIRMED_IN_FILE' });
    expect(items[1].noteOption).toBe('NOT_APPLICABLE');
    expect(items[2]).toMatchObject({ status: 'RED_X', noteText: 'Updated paystub needed' });
    expect(items[3].status).toBe('YELLOW');
  });
  it('requires all document reviews for approval, including additional requests', () => {
    const p = initialPilotPackage(); p.state = 'REVIEW';
    expect(pilotDecisionError(p, 'APPROVE_INITIAL_DISCLOSURES')).toBeTruthy();
    p.items.forEach(i => { i.review = 'APPROVED'; });
    expect(pilotDecisionError(p, 'APPROVE_INITIAL_DISCLOSURES')).toBeNull();
    p.items.push({ id: 'extra', label: 'Bank statement', required: false, files: [], waiver: '', feedback: 'Upload bank statement', review: 'CHANGES' });
    expect(pilotDecisionError(p, 'APPROVE_INITIAL_DISCLOSURES')).toBeTruthy();
    expect(pilotDecisionError(p, 'MISSING_ITEMS')).toBeNull();
  });
  it('allows rejection of an incomplete review but prevents duplicate returned decisions', () => {
    const p = initialPilotPackage(); p.state = 'REVIEW';
    expect(pilotDecisionError(p, 'OTHER')).toBeNull();
    expect(pilotDecisionError(p, 'MISSING_ITEMS')).toBeTruthy();
    p.state = 'CHANGES';
    expect(pilotDecisionError(p, 'OTHER')).toBeTruthy();
  });
});
