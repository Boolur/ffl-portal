import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn(), encryptAriveCredentials: vi.fn() }));
import { readAriveNotes } from './ariveClient';

describe('Arive note pagination completeness', () => {
  const page = (start: number, length: number) => Array.from({ length }, (_, index) => ({ id: `note-${start + index}`, text: 'Synthetic note' }));
  const read = (responses: { count: number; loanNotes: unknown[] }[]) => {
    const api = vi.fn();
    for (const response of responses) api.mockResolvedValueOnce(response);
    return { api, result: readAriveNotes('test-guid', api) };
  };

  it('reads every complete page and accepts a shorter final page', async () => {
    const { api, result } = read([{ count: 125, loanNotes: page(0, 100) }, { count: 125, loanNotes: page(100, 25) }]);
    expect(await result).toHaveLength(125);
    expect(api.mock.calls.map(call => call[0])).toEqual(['/loans/test-guid/notes?limit=100&offset=0', '/loans/test-guid/notes?limit=100&offset=100']);
  });
  it('accepts a complete empty listing and an exact final page', async () => {
    expect(await read([{ count: 0, loanNotes: [] }]).result).toEqual([]);
    expect(await read([{ count: 100, loanNotes: page(0, 100) }]).result).toHaveLength(100);
  });
  it.each([0, 50, 99, 101])('rejects a nonfinal page of %i rows before skipping any notes', async length => {
    const { api, result } = read([{ count: 200, loanNotes: page(0, length) }]);
    await expect(result).rejects.toThrow('pagination was incomplete');
    expect(api).toHaveBeenCalledTimes(1);
  });
  it('rejects a final page that exceeds the advertised count', async () => {
    await expect(read([{ count: 125, loanNotes: page(0, 100) }, { count: 125, loanNotes: page(100, 26) }]).result).rejects.toThrow('pagination was incomplete');
  });
  it.each([100, 126, 200])('rejects a count changed to %i between pages', async count => {
    await expect(read([{ count: 125, loanNotes: page(0, 100) }, { count, loanNotes: page(100, 25) }]).result).rejects.toThrow('changed during pagination');
  });
  it('rejects overlapping pages rather than silently deduplicating away missing notes', async () => {
    await expect(read([{ count: 200, loanNotes: page(0, 100) }, { count: 200, loanNotes: page(99, 100) }]).result).rejects.toThrow('pages overlapped');
  });
  it('retains the complete-snapshot ceiling instead of returning the first 5000 notes', async () => {
    const responses = Array.from({ length: 50 }, (_, index) => ({ count: 5001, loanNotes: page(index * 100, 100) }));
    const { api, result } = read(responses);
    await expect(result).rejects.toThrow('note limit');
    expect(api).toHaveBeenCalledTimes(50);
  });
});
