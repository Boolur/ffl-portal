import { describe, expect, it, vi } from 'vitest';
import { documentDisposition, populateDocumentDrag } from './documentDelivery';

describe('document delivery', () => {
  it('preserves original PDF names for inline previews and downloads', () => {
    expect(documentDisposition('Mortgage Statement.pdf', false)).toBe(`inline; filename="Mortgage Statement.pdf"; filename*=UTF-8''Mortgage%20Statement.pdf`);
    expect(documentDisposition('Mortgage Statement.pdf', true)).toContain('attachment;');
    expect(documentDisposition('Résumé.pdf', false)).toContain('R%C3%A9sum%C3%A9.pdf');
  });
  it('sanitizes header control characters and encodes punctuation', () => {
    expect(documentDisposition('bad\r\nname".pdf', false)).not.toMatch(/[\r\n]/);
    expect(documentDisposition("Borrower's (copy).pdf", false)).toContain('%27s%20%28copy%29');
  });
  it('provides actual file bytes and a download descriptor without a text or preview-link fallback', async () => {
    const file = new File(['PDF bytes'], 'Original.pdf', { type: 'application/pdf' });
    const add = vi.fn(); const setData = vi.fn(); const clearData = vi.fn();
    const transfer = { items: { add }, setData, clearData, effectAllowed: '' } as unknown as DataTransfer;
    populateDocumentDrag(transfer, file, 'https://storage.example.test/signed');
    expect(add).toHaveBeenCalledWith(file);
    expect(await file.text()).toBe('PDF bytes');
    expect(clearData).toHaveBeenCalledOnce();
    expect(setData).toHaveBeenCalledExactlyOnceWith('DownloadURL', 'application/pdf:Original.pdf:https://storage.example.test/signed');
    expect(transfer.effectAllowed).toBe('copy');
  });
});
