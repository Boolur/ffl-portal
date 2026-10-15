import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { info } = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({ storage: { from: () => ({ info }) } }), getTaskAttachmentsBucket: () => 'private' }));
import { verifyProcessingSubmissionDocuments } from './processingSubmissionDocuments';
import { initialPilotPackage } from './submissionPilot';
function fixture() {
  const items = initialPilotPackage().items;
  for (const item of items) item.waiver = 'Not applicable to this test loan';
  items[0].files.push({ id: 'untrusted', name: 'mortgage.pdf', path: 'processing-submission/matt/11111111-1111-4111-8111-111111111111.pdf', size: 123, type: 'application/pdf', uploadedAt: '' });
  return items;
}
beforeEach(() => { info.mockReset(); info.mockResolvedValue({ data: { metadata: { size: 123, mimetype: 'application/pdf' } } }); });
describe('Processing popup documents', () => {
  it('requires the complete checklist and at least one real upload', async () => {
    await expect(verifyProcessingSubmissionDocuments(undefined, 'matt')).rejects.toThrow('document upload step');
    await expect(verifyProcessingSubmissionDocuments([], 'matt')).rejects.toThrow('required item');
    const items = fixture(); items[0].files = [];
    await expect(verifyProcessingSubmissionDocuments(items, 'matt')).rejects.toThrow('at least one');
  });
  it('does not let omitted required categories or forged approvals bypass review', async () => {
    const items = fixture();
    await expect(verifyProcessingSubmissionDocuments(items.slice(0, 1), 'matt')).rejects.toThrow('required item');
    items[0].review = 'APPROVED';
    const p = await verifyProcessingSubmissionDocuments(items, 'matt');
    expect(p.state).toBe('REVIEW');
    expect(p.items.every(i => i.review === 'PENDING')).toBe(true);
    expect(p.items[0].files[0].id).not.toBe('untrusted');
    expect(p.items[0].waiver).toBe('');
  });
  it('rejects another user’s upload and duplicate files', async () => {
    await expect(verifyProcessingSubmissionDocuments(fixture(), 'someone-else')).rejects.toThrow('does not belong');
    expect(info).not.toHaveBeenCalled();
    const items = fixture(); items[1].files = [...items[0].files];
    await expect(verifyProcessingSubmissionDocuments(items, 'matt')).rejects.toThrow('does not belong');
  });
  it('rejects missing or incomplete uploads before a request can be created', async () => {
    info.mockResolvedValue({ data: { metadata: { size: 12, mimetype: 'application/pdf' } } });
    await expect(verifyProcessingSubmissionDocuments(fixture(), 'matt')).rejects.toThrow('could not be verified');
  });
});
