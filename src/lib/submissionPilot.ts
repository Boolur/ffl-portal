// Exact active LO account; the similarly named onboarding account is excluded.
export const SUBMISSION_PILOT_LO_ID = '2e28c6a5-67c0-442d-94bd-59897ad8d8cd';
export const PILOT_DOCUMENT_TYPES = [
  ['mortgage', 'Mortgage statement / mortgage documents'],
  ['insurance', 'Homeowners insurance'],
  ['income', 'Income documents / paystubs'],
  ['identity', 'Identification'],
  ['veteran', 'Veteran documentation / COE'],
  ['disclosures', 'Signed initial disclosures'],
] as const;
export type PilotFile = { id: string; name: string; path: string; size: number; type: string; uploadedAt: string };
export type PilotItem = {
  id: string; label: string; required: boolean; files: PilotFile[]; waiver: string;
  review: 'PENDING' | 'APPROVED' | 'CHANGES'; feedback: string;
  pending?: { path: string; name: string; size: number; type: string };
};
export type PilotPackage = {
  version: 1; revision: number; state: 'DRAFT' | 'REVIEW' | 'CHANGES' | 'APPROVED';
  reviewerId: string | null; items: PilotItem[];
  retiredFiles?: PilotFile[];
  history: { at: string; actor: string; message: string }[];
};
export function initialPilotPackage(): PilotPackage {
  return { version: 1, revision: 0, state: 'DRAFT', reviewerId: null,
    items: PILOT_DOCUMENT_TYPES.map(([id, label]) => ({ id, label, required: true, files: [], waiver: '', review: 'PENDING', feedback: '' })), history: [] };
}
export function readPilotPackage(value: unknown): PilotPackage | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const p = (value as { submissionPilot?: PilotPackage }).submissionPilot;
  return p?.version === 1 && Array.isArray(p.items) ? p : null;
}
export function pilotSubmissionError(p: PilotPackage): string | null {
  if (!['DRAFT', 'CHANGES'].includes(p.state)) return 'This package is not open for submission.';
  if (p.items.some(i => i.pending)) return 'Finish or cancel pending uploads first.';
  if (p.items.some(i => i.required && !i.files.length && !i.waiver.trim())) return 'Upload each required item or explain why it is not applicable.';
  if (p.items.some(i => i.review === 'CHANGES')) return 'Resolve each requested correction before resubmitting.';
  if (!p.items.some(i => i.files.length)) return 'Upload at least one document.';
  return null;
}
export function pilotApprovalError(p: PilotPackage): string | null {
  if (p.state !== 'REVIEW') return 'Submit the package for review first.';
  if (p.items.some(i => (i.required || i.files.length || i.waiver) && i.review !== 'APPROVED')) return 'Approve every document category and not-applicable explanation first.';
  return null;
}
export function validatePilotFile(name: string, size: number, type: string) {
  const types: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
  if (!types[name.split('.').pop()?.toLowerCase() || ''] || types[name.split('.').pop()!.toLowerCase()] !== type) throw new Error('Use PDF, JPG, or PNG files.');
  if (!Number.isInteger(size) || size <= 0 || size > 20 * 1024 * 1024) throw new Error('Files must be nonempty and no larger than 20 MB.');
}
