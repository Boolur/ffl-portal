import type { PilotPackage } from './submissionPilot';

const checklistIds: Record<string, string> = {
  mortgage: 'mortgage-documents', insurance: 'homeowners-insurance', income: 'income-documents',
  identity: 'drivers-license', veteran: 'dd214-veteran', disclosures: 'signed-initial-disclosure-package',
};

// The document review is the Processing checklist for pilot submissions.
export function pilotReviewChecklist(p: PilotPackage) {
  return { items: p.items.map(item => ({
    id: checklistIds[item.id] || item.id, label: item.label,
    status: item.review === 'APPROVED' ? 'GREEN_CHECK' as const : item.review === 'CHANGES' ? 'RED_X' as const : 'YELLOW' as const,
    noteOption: item.review === 'APPROVED' ? item.waiver ? 'NOT_APPLICABLE' as const : 'CONFIRMED_IN_FILE' as const : item.review === 'CHANGES' ? 'MISSING_FROM_FILE' as const : 'OTHER' as const,
    noteText: item.feedback || item.waiver || '',
  })), summaryMessage: 'Document review checklist' };
}

export function pilotDecisionError(p: PilotPackage, decision: 'APPROVE_INITIAL_DISCLOSURES' | 'MISSING_ITEMS' | 'OTHER') {
  if (!['REVIEW', 'APPROVED'].includes(p.state)) return 'This package is not open for review.';
  if (decision === 'APPROVE_INITIAL_DISCLOSURES' && p.items.some(i => (i.required || i.files.length || i.waiver || i.review === 'CHANGES') && i.review !== 'APPROVED')) return 'Approve every document or not-applicable explanation first.';
  if (decision === 'MISSING_ITEMS' && !p.items.some(i => i.review === 'CHANGES')) return 'Flag an item or request an additional document first.';
  return null;
}
