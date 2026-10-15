import 'server-only';
import { randomUUID } from 'crypto';
import { getSupabaseAdmin, getTaskAttachmentsBucket } from '@/lib/supabaseAdmin';
import { initialPilotPackage, pilotSubmissionError, validatePilotFile, type PilotPackage } from './submissionPilot';

// Rebuild the package from the fixed checklist; never trust client review states or paths.
export async function verifyProcessingSubmissionDocuments(input: unknown, userId: string): Promise<PilotPackage> {
  if (!Array.isArray(input) || input.length > 30) throw new Error('Complete the document upload step before submitting.');
  const p = initialPilotPackage();
  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string' || ids.has(raw.id)) throw new Error('Invalid document category.');
    ids.add(raw.id);
    let item = p.items.find(i => i.id === raw.id);
    if (!item) {
      if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 150) throw new Error('Enter an additional document label.');
      item = { id: randomUUID(), label: raw.label.trim(), required: false, files: [], waiver: '', review: 'PENDING', feedback: '' };
      p.items.push(item);
    }
    if (typeof raw.waiver !== 'string' || raw.waiver.length > 2000 || !Array.isArray(raw.files) || raw.files.length > 10) throw new Error('Invalid document details.');
    item.waiver = raw.waiver.trim();
    for (const file of raw.files) {
      if (!file || typeof file.name !== 'string' || typeof file.type !== 'string' || typeof file.path !== 'string') throw new Error('Invalid upload.');
      validatePilotFile(file.name, file.size, file.type);
      const prefix = `processing-submission/${userId}/`;
      if (!file.path.startsWith(prefix) || !/^[0-9a-f-]{36}\.(pdf|jpg|jpeg|png)$/.test(file.path.slice(prefix.length)) || paths.has(file.path)) throw new Error('This upload does not belong to your submission.');
      paths.add(file.path);
      const { data, error } = await getSupabaseAdmin().storage.from(getTaskAttachmentsBucket()).info(file.path);
      if (error || !data || Number(data.metadata?.size) !== file.size || data.metadata?.mimetype !== file.type) throw new Error(`Upload could not be verified: ${file.name}. Please upload it again.`);
      item.files.push({ id: randomUUID(), path: file.path, name: file.name, size: file.size, type: file.type, uploadedAt: new Date().toISOString() });
    }
    if (item.files.length) item.waiver = '';
  }
  const error = pilotSubmissionError(p);
  if (error) throw new Error(error);
  p.state = 'REVIEW';
  return p;
}
