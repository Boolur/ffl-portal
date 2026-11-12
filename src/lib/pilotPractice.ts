import { PILOT_DOCUMENT_TYPES, validatePilotFile } from './submissionPilot';

export type PracticePersona = 'LO' | 'JR';
export type PracticeState = 'DRAFT' | 'REVIEW' | 'STARTED' | 'CHANGES' | 'APPROVED' | 'REJECTED';
export type PracticeItem = { id: string; label: string; required: boolean; waiver: string; review: 'PENDING' | 'APPROVED' | 'CHANGES'; feedback: string };
export type PracticeFile = { id: string; itemId: string; name: string; type: string; size: number; uploaded: boolean; retired: boolean };
export const PRACTICE_DRAFT_FIELDS = ['preApproved', 'borrowerFirstName', 'borrowerLastName', 'borrowerPhone', 'borrowerEmail', 'coBorrowerFirstName', 'coBorrowerLastName', 'coBorrowerPhone', 'coBorrowerEmail', 'arriveLoanNumber', 'channel', 'investor', 'leadSource', 'leadVendor', 'processingMethod', 'loanType', 'loanProgram', 'loanAmount', 'propertyStreet', 'propertyUnit', 'propertyCity', 'propertyState', 'propertyZip', 'propertyOccupancy', 'homeValue', 'yearBuiltProperty', 'yearAquired', 'mannerInWhichTitleWillBeHeld', 'cashBack', 'projectedRevenue', 'aus', 'creditReportType', 'uwmFreeCreditUsed', 'communityPropertyState', 'creditReportNotesExp', 'creditReportNotesEqf', 'creditReportNotesTui', 'titleCompany', 'appraisalWaiver', 'appraisalNeeded', 'appraisalNotes', 'notesGoals'] as const;
export type PracticeDraft = Partial<Record<typeof PRACTICE_DRAFT_FIELDS[number], string>>;
/** Simulation data only. IDs, assignments, storage paths and credentials cannot enter a draft. */
export function validatePracticeDraft(value: unknown): PracticeDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Enter valid practice submission details.');
  const entries = Object.entries(value);
  if (entries.length > PRACTICE_DRAFT_FIELDS.length) throw new Error('The practice draft contains too many fields.');
  const result: PracticeDraft = {};
  for (const [key, field] of entries) {
    if (!(PRACTICE_DRAFT_FIELDS as readonly string[]).includes(key) || typeof field !== 'string' || field.length > (/notes/i.test(key) ? 4000 : 200) || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(field)) throw new Error('The practice draft contains an unsupported field or value.');
    result[key as keyof PracticeDraft] = field.trim();
  }
  if (JSON.stringify(result).length > 32000) throw new Error('Keep the practice draft under 32,000 characters.');
  return result;
}
export type PracticeCommand = { persona: PracticePersona; action: 'SUBMIT' | 'START' | 'REVIEW' | 'REQUEST_DOCUMENT' | 'ADD_DOCUMENT' | 'WAIVER' | 'CLEAR_WAIVER' | 'RETURN' | 'APPROVE' | 'REJECT' | 'NOTE' | 'RETIRE_FILE'; itemId?: string; fileId?: string; approved?: boolean; text?: string };
export const practiceInitialItems = (): PracticeItem[] => PILOT_DOCUMENT_TYPES.map(([id, label]) => ({ id, label, required: true, waiver: '', review: 'PENDING', feedback: '' }));
export function readPracticeItems(value: unknown): PracticeItem[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('Practice checklist is unavailable.');
  const ids = new Set<string>();
  return value.map(raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || ids.has(raw.id) || typeof raw.label !== 'string' || typeof raw.required !== 'boolean' || typeof raw.waiver !== 'string' || typeof raw.feedback !== 'string' || !['PENDING', 'APPROVED', 'CHANGES'].includes(raw.review)) throw new Error('Practice checklist is unavailable.');
    ids.add(raw.id);
    return { id: raw.id, label: raw.label, required: raw.required, waiver: raw.waiver, review: raw.review, feedback: raw.feedback };
  });
}
export function assertPracticeUploadPath(path: string, ownerId: string, taskId: string, file: { name: string; type: string; size: number }) {
  validatePilotFile(file.name, file.size, file.type);
  const prefix = `pilot-practice/${ownerId}/${taskId}/`;
  if (!path.startsWith(prefix) || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\.(pdf|jpg|jpeg|png)$/.test(path.slice(prefix.length))) throw new Error('This file does not belong to this practice workspace.');
  const ext = path.split('.').pop();
  if ((ext === 'pdf' ? 'application/pdf' : ext === 'png' ? 'image/png' : 'image/jpeg') !== file.type) throw new Error('Practice file type does not match.');
}
export function applyPracticeCommand(state: string, original: PracticeItem[], files: PracticeFile[], command: PracticeCommand, newItemId: string) {
  const items = structuredClone(original);
  const item = items.find(value => value.id === command.itemId);
  if (command.text !== undefined && typeof command.text !== 'string') throw new Error('Invalid practice response.');
  const text = command.text?.trim() || '';
  if (text.length > 4000 || !['LO', 'JR'].includes(command.persona)) throw new Error('Invalid practice response.');
  const requireRole = (persona: PracticePersona, states: string[]) => {
    if (command.persona !== persona || !states.includes(state)) throw new Error(persona === 'JR' ? 'Start this practice task before reviewing it.' : 'This practice task is not open for Loan Officer changes.');
  };
  const active = files.filter(file => !file.retired && file.uploaded);
  const hasFile = (id: string) => active.some(file => file.itemId === id);
  let nextState = state as PracticeState;
  let retiredFileId: string | undefined;
  let simulatedRecipient: PracticePersona | undefined;
  let message = '';
  switch (command.action) {
    case 'SUBMIT':
      requireRole('LO', ['DRAFT', 'CHANGES']);
      if (files.some(file => !file.uploaded && !file.retired)) throw new Error('Finish or cancel pending practice uploads first.');
      if (items.some(value => value.review === 'CHANGES' || (value.required && !hasFile(value.id) && !value.waiver))) throw new Error('Resolve each required document or explain why it is not applicable.');
      if (!active.length) throw new Error('Upload at least one practice document.');
      nextState = 'REVIEW'; simulatedRecipient = 'JR'; message = 'Submitted practice documents for Jr Processor review.'; break;
    case 'START':
      requireRole('JR', ['REVIEW']); nextState = 'STARTED'; message = 'Started practice review.'; break;
    case 'REVIEW':
      requireRole('JR', ['STARTED']);
      if (!item || typeof command.approved !== 'boolean' || (command.approved && !hasFile(item.id) && !item.waiver) || (!command.approved && !text)) throw new Error('Approve an available document or explain the requested correction.');
      item.review = command.approved ? 'APPROVED' : 'CHANGES'; item.feedback = text;
      if (!command.approved) item.required = true;
      message = `${command.approved ? 'Approved' : 'Requested correction for'} ${item.label}.${text ? `\n${text}` : ''}`; break;
    case 'REQUEST_DOCUMENT':
      requireRole('JR', ['STARTED']);
      if (!text || text.length > 150 || items.length >= 30) throw new Error('Enter a document label under 150 characters (maximum 30 categories).');
      items.push({ id: newItemId, label: text, required: true, waiver: '', review: 'CHANGES', feedback: `Please upload: ${text}` });
      message = `Requested ${text}.`; break;
    case 'ADD_DOCUMENT':
      requireRole('LO', ['DRAFT', 'CHANGES']);
      if (!text || text.length > 150 || items.length >= 30) throw new Error('Enter a document label under 150 characters (maximum 30 categories).');
      items.push({ id: newItemId, label: text, required: false, waiver: '', review: 'PENDING', feedback: '' });
      message = `Added ${text} to the practice checklist.`; break;
    case 'WAIVER':
      requireRole('LO', ['DRAFT', 'CHANGES']);
      if (!item || !text || text.length > 2000 || hasFile(item.id) || files.some(file => file.itemId === item.id && !file.retired)) throw new Error('Remove this category’s files before adding a not-applicable explanation.');
      item.waiver = text; item.review = 'PENDING'; message = `Explained why ${item.label} is not applicable.\n${text}`; break;
    case 'CLEAR_WAIVER':
      requireRole('LO', ['DRAFT', 'CHANGES']);
      if (!item || !item.waiver) throw new Error('There is no not-applicable explanation to remove.');
      item.waiver = ''; item.review = 'PENDING'; message = `Removed the not-applicable explanation for ${item.label}.`; break;
    case 'RETURN':
      requireRole('JR', ['STARTED']);
      if (!items.some(value => value.review === 'CHANGES')) throw new Error('Request at least one correction before returning the practice task.');
      nextState = 'CHANGES'; simulatedRecipient = 'LO'; message = text || 'Returned practice task for document corrections.'; break;
    case 'APPROVE':
      requireRole('JR', ['STARTED']);
      if (items.some(value => (value.required || hasFile(value.id) || value.waiver || value.review === 'CHANGES') && value.review !== 'APPROVED') || files.some(file => !file.uploaded && !file.retired)) throw new Error('Approve every document and not-applicable explanation first.');
      nextState = 'APPROVED'; simulatedRecipient = 'LO'; message = 'Completed practice review. No live loan or task was changed.'; break;
    case 'REJECT':
      requireRole('JR', ['STARTED']);
      if (!text) throw new Error('Explain why the practice request is rejected.');
      nextState = 'REJECTED'; simulatedRecipient = 'LO'; message = text; break;
    case 'RETIRE_FILE': {
      requireRole('LO', ['DRAFT', 'CHANGES']);
      const file = files.find(value => value.id === command.fileId && !value.retired);
      const category = file && items.find(value => value.id === file.itemId);
      if (!file || !category) throw new Error('Practice file not found.');
      retiredFileId = file.id; category.review = 'PENDING'; message = `Removed ${file.name} from practice review.`; break;
    }
    case 'NOTE':
      if (!text) throw new Error('Enter a practice note.');
      message = text; break;
    default: throw new Error('Unknown practice action.');
  }
  return { state: nextState, items, retiredFileId, simulatedRecipient, message };
}
