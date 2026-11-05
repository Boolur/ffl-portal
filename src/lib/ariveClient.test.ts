import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: { ariveIntegrationConfig: { findUnique: vi.fn().mockResolvedValue({ encryptedCredentials: 'synthetic-encrypted-value' }) } } }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn(() => JSON.stringify({ clientId: 'client', secret: 'test-secret', apiKey: 'test-api' })) }));
import { ariveSession, ariveClassifications, readAriveNotes, validAriveUploadUrl } from './ariveClient';
const creds = { clientId: 'client', secret: 'test-secret', apiKey: 'test-api' };
afterEach(() => vi.unstubAllGlobals());
describe('Arive note schema diagnostics', () => {
  function notesResponse(note: unknown) {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(Response.json({ AccessToken: 'synthetic-token' }))
      .mockResolvedValueOnce(Response.json({ count: 1, loanNotes: [note] })));
  }
  it('reports only types and date formats for an incompatible note identifier', async () => {
    notesResponse({ id: 123, text: 'private user note with test-secret', createdByName: 'Private Name', createdAt: '2026-11-05T12:30:00Z', updatedAt: null, nestedNotes: [] });
    await expect(readAriveNotes('test-loan')).rejects.toThrow('Schema: depth=0; note=object; id=number; text=string; text keys=none; other text keys=0; createdAt=string/ISO-date-time; updatedAt=null; nestedNotes=array.');
  });
  it('does not disclose text values, arbitrary object keys, authors, or secrets', async () => {
    notesResponse({ id: 'note', text: { content: 'private note contents', value: 'test-api', 'Private borrower text': 'test-secret', 'opaquePrivateKeyToken': 'synthetic-token' }, createdByName: 'Private Name' });
    const error = await readAriveNotes('test-loan').catch(e => e);
    expect(error.message).toContain('text=object; text keys=content,value; other text keys=2');
    for (const forbidden of ['private note contents', 'test-api', 'test-secret', 'synthetic-token', 'Private borrower text', 'opaquePrivateKeyToken', 'Private Name']) expect(error.message).not.toContain(forbidden);
  });
  it.each([null, [], 'private-note-contents', 42])('rejects non-object notes without echoing them (%j)', async note => {
    notesResponse(note);
    await expect(readAriveNotes('test-loan')).rejects.toThrow('Arive returned an unexpected note format. Schema: depth=0;');
  });
  it('identifies a nested reply failure without changing the parser contract', async () => {
    notesResponse({ id: 'parent', text: 'synthetic parent', nestedNotes: [{ id: 456, text: 'private reply' }] });
    await expect(readAriveNotes('test-loan')).rejects.toThrow('Schema: depth=1; note=object; id=number; text=string;');
  });
  it('continues to import valid parent notes and replies unchanged', async () => {
    notesResponse({ id: 'parent', text: 'synthetic parent', createdByName: 'Synthetic author', nestedNotes: [{ id: 'reply', text: 'synthetic reply' }] });
    const notes = await readAriveNotes('test-loan');
    expect(notes[0].id).toBe('parent');
    expect(notes[0].text).toBe('synthetic parent');
    expect(notes[0].replies[0].id).toBe('reply');
  });
});
describe('Arive HTTP contract', () => {
  it('includes only recognized gateway diagnostics for support', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret upstream body', { status: 403, headers: { 'x-amzn-errortype': 'ForbiddenException', 'x-amzn-requestid': '12345678-abcd-4321-abcd-123456789012' } })));
    await expect(ariveSession(creds)).rejects.toThrow('Gateway code: ForbiddenException. Request ID: 12345678-abcd-4321-abcd-123456789012.');
  });
  it('omits unrecognized diagnostic header values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('test-secret', { status: 403, headers: { 'x-amzn-errortype': 'test-secret', 'x-amzn-requestid': 'sensitive=value' } })));
    await expect(ariveSession(creds)).rejects.toThrow(/^Arive authentication returned HTTP 403\. Check the credentials and Arive-provisioned permission for this operation\.$/);
  });
  it('distinguishes rejected credentials from missing company document access', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('private', { status: 403 }))
      .mockResolvedValueOnce(Response.json({ AccessToken: 'token' }))
      .mockResolvedValueOnce(new Response('private', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(ariveClassifications(creds)).rejects.toThrow('authentication returned HTTP 403');
    await expect(ariveClassifications(creds)).rejects.toThrow('document classification access check returned HTTP 403');
  });
  it('uses the documented auth casing and company headers', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ AccessToken: 'token', ExpiresIn: 300, TokenType: 'Bearer' })).mockResolvedValueOnce(Response.json({ classifications: [{ name: 'Income', subName: 'Paystub' }] }));
    vi.stubGlobal('fetch', fetcher);
    expect(await ariveClassifications(creds)).toEqual([{ name: 'Income', subName: 'Paystub' }]);
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(creds);
    expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer token');
    expect(fetcher.mock.calls[1][1].headers['X-API-KEY']).toBe('test-api');
    expect(fetcher.mock.calls[1][1].redirect).toBe('error');
  });
  it('does not echo upstream response bodies containing secrets', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('test-secret', { status: 401 })));
    await expect(ariveSession(creds)).rejects.toThrow('HTTP 401');
    await expect(ariveSession(creds)).rejects.not.toThrow('test-secret');
  });
  it('does not automatically replay an ambiguous write', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ AccessToken: 'token' })).mockRejectedValueOnce(new Error('timeout'));
    vi.stubGlobal('fetch', fetcher);
    const api = await ariveSession(creds);
    await expect(api('/loans/test/documents', { fileId: 'file', documentName: 'test.pdf' })).rejects.toThrow('did not finish');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('restricts signed-upload destinations and credentials in URLs', () => {
    expect(validAriveUploadUrl('https://bucket.s3.amazonaws.com/file?signature=test')).toContain('amazonaws.com');
    for (const url of ['http://bucket.s3.amazonaws.com/file', 'https://localhost/file', 'https://bucket.s3.amazonaws.com.evil.test/file', 'https://user:pass@bucket.s3.amazonaws.com/file', 'https://169.254.169.254/latest']) expect(() => validAriveUploadUrl(url)).toThrow();
  });
});
