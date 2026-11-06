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
  it('offers only a folder download descriptor, never a synthetic File or filename-text fallback', () => {
    const file = new File(['PDF bytes'], 'Original.pdf', { type: 'application/pdf' });
    const add = vi.fn().mockReturnValue({ kind: 'file', getAsFile: () => file }); const setData = vi.fn(); const clearData = vi.fn();
    const transfer = { items: { add }, setData, clearData, effectAllowed: '' } as unknown as DataTransfer;
    populateDocumentDrag(transfer, file, 'https://storage.example.test/signed');
    expect(add).not.toHaveBeenCalled();
    expect(clearData).toHaveBeenCalledOnce();
    expect(setData).toHaveBeenCalledExactlyOnceWith('DownloadURL', 'application/pdf:Original.pdf:https://storage.example.test/signed');
    expect(transfer.effectAllowed).toBe('copy');
  });
  it('cancels unsupported folder drags rather than falling back to Files, text, or links', () => {
    const file = { name: 'Original.pdf', type: 'application/pdf' };
    const add = vi.fn();
    const setData = vi.fn(() => { throw new Error('Unsupported drag format'); });
    const transfer = { items: { add }, setData, clearData: vi.fn(), effectAllowed: '' } as unknown as DataTransfer;
    expect(() => populateDocumentDrag(transfer, file, 'https://storage.example.test/signed')).toThrow('Use the download icon, then attach the saved file.');
    expect(add).not.toHaveBeenCalled();
    expect(setData).toHaveBeenCalledExactlyOnceWith('DownloadURL', 'application/pdf:Original.pdf:https://storage.example.test/signed');
  });
  it('keeps descriptor separators out of filenames and clears browser-provided text', () => {
    const data = new Map([['text/plain', 'selected filename']]);
    const transfer = { clearData: () => data.clear(), setData: (type: string, value: string) => data.set(type, value), effectAllowed: '' } as unknown as DataTransfer;
    populateDocumentDrag(transfer, { name: 'File:\r\nOriginal.pdf', type: 'application/pdf' }, 'https://storage.example.test/signed');
    expect([...data]).toEqual([['DownloadURL', 'application/pdf:File___Original.pdf:https://storage.example.test/signed']]);
  });
});
