import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ prisma: {} }));
vi.mock('@/lib/ariveCrypto', () => ({ decryptAriveCredentials: vi.fn() }));
import { ariveSession, ariveClassifications, validAriveUploadUrl } from './ariveClient';
const creds = { clientId: 'client', secret: 'test-secret', apiKey: 'test-api' };
afterEach(() => vi.unstubAllGlobals());
describe('Arive HTTP contract', () => {
  it('distinguishes rejected credentials from missing company document access', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response('private', { status: 403 }))
      .mockResolvedValueOnce(Response.json({ AccessToken: 'token' }))
      .mockResolvedValueOnce(new Response('private', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    await expect(ariveClassifications(creds)).rejects.toThrow('authentication returned HTTP 403');
    await expect(ariveClassifications(creds)).rejects.toThrow('company document access check returned HTTP 403');
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
