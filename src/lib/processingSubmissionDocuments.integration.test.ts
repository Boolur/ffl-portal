import { randomUUID } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } }),
  getTaskAttachmentsBucket: () => process.env.SUPABASE_STORAGE_BUCKET_TASK_ATTACHMENTS || 'task-attachments',
}));
import { verifyProcessingSubmissionDocuments } from './processingSubmissionDocuments';
import { initialPilotPackage, SUBMISSION_PILOT_LO_ID } from './submissionPilot';

// Opt-in: uploads one synthetic PDF to configured private storage, then removes only that object.
it.skipIf(process.env.RUN_STORAGE_UPLOAD_SMOKE !== '1')('uploads a PDF and verifies it using the final submission validator', async () => {
  loadEnvFile('.env');
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('Storage test configuration is missing.');
  const storage = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }).storage.from(process.env.SUPABASE_STORAGE_BUCKET_TASK_ATTACHMENTS || 'task-attachments');
  const path = `processing-submission/${SUBMISSION_PILOT_LO_ID}/${randomUUID()}.pdf`;
  const stream = 'BT /F1 12 Tf 40 100 Td (Synthetic BISU upload verification - no borrower data) Tj ET';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(Buffer.byteLength(pdf)); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n => `${String(n).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = Buffer.from(pdf);
  try {
    const signed = await storage.createSignedUploadUrl(path);
    if (signed.error || !signed.data) throw new Error('Could not create test upload URL.');
    const response = await fetch(signed.data.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf' }, body: bytes, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Synthetic upload failed with HTTP ${response.status}.`);
    const p = initialPilotPackage();
    p.items.forEach(i => { i.waiver = 'Not applicable to synthetic verification'; });
    p.items[0].files = [{ id: randomUUID(), name: 'BISU verification test.pdf', path, size: bytes.length, type: 'application/pdf', uploadedAt: new Date().toISOString() }];
    const verified = await verifyProcessingSubmissionDocuments(p.items, SUBMISSION_PILOT_LO_ID);
    expect(verified.state).toBe('REVIEW');
    expect(verified.items[0].files[0].size).toBe(bytes.length);
    expect(verified.items[0].files[0].path).toBe(path);
  } finally {
    const cleanup = await storage.remove([path]);
    if (cleanup.error) throw new Error('Synthetic test object cleanup failed.');
  }
}, 60000);
