import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ access: vi.fn(), fetch: vi.fn() }));
vi.mock('@/app/actions/practiceDocumentActions', () => ({ getPracticeFileAccess: m.access }));
vi.mock('@/lib/documentDelivery', async () => import('../../../../../../../lib/documentDelivery'));
import { GET } from './route';

const context = { params: Promise.resolve({ taskId: 'practice-task', fileId: 'practice-file' }) };
beforeEach(() => {
  vi.resetAllMocks(); vi.stubGlobal('fetch', m.fetch);
  m.access.mockResolvedValue({ success: true, data: { name: 'Mortgage Statement.pdf', type: 'application/pdf', size: 8, url: 'https://storage.test/private?token=secret' } });
  m.fetch.mockResolvedValue(new Response('%PDF-1.7', { headers: { 'Content-Type': 'application/pdf', 'Content-Length': '8' } }));
});
afterEach(() => vi.unstubAllGlobals());
describe('private practice file delivery', () => {
  it('denies expired/unauthorized access as JSON, without a login redirect or file headers', async () => {
    m.access.mockResolvedValue({ success: false, error: 'Sign in with an account that can access this practice workspace.' });
    const response = await GET(new Request('https://bisuportal.com/api/pilot/practice/task/files/file?download=1'), context);
    expect(response.status).toBe(403); expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store'); expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.has('Location')).toBe(false); expect(response.headers.has('Content-Disposition')).toBe(false); expect(m.fetch).not.toHaveBeenCalled();
  });
  it('prepares only safe metadata and does not expose a source storage URL', async () => {
    const response = await GET(new Request('https://bisuportal.com/api/pilot/practice/task/files/file?prepare=1'), context);
    expect(await response.json()).toEqual({ success: true, data: { name: 'Mortgage Statement.pdf', type: 'application/pdf', size: 8 } });
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it('streams the actual bytes with the original filename and private headers', async () => {
    const response = await GET(new Request('https://bisuportal.com/api/pilot/practice/task/files/file?download=1'), context);
    expect(response.status).toBe(200); expect(await response.text()).toBe('%PDF-1.7');
    expect(response.headers.get('Content-Disposition')).toContain('attachment;'); expect(response.headers.get('Content-Disposition')).toContain('Mortgage');
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(m.fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store', redirect: 'error' });
  });
  it('supports PDF ranges while keeping inline viewing separate from download', async () => {
    m.fetch.mockResolvedValue(new Response('PDF', { status: 206, headers: { 'Content-Type': 'application/pdf', 'Content-Range': 'bytes 1-3/8' } }));
    const response = await GET(new Request('https://bisuportal.com/api/pilot/practice/task/files/file', { headers: { Range: 'bytes=1-3' } }), context);
    expect(response.status).toBe(206); expect(response.headers.get('Content-Range')).toBe('bytes 1-3/8'); expect(response.headers.get('Content-Disposition')).toContain('inline;');
    expect(m.fetch.mock.calls[0][1].headers).toEqual({ Range: 'bytes=1-3' });
  });
  it.each(['text/html', 'application/json', 'image/png'])('does not return %s error content as a PDF', async contentType => {
    m.fetch.mockResolvedValue(new Response('error body', { headers: { 'Content-Type': contentType } }));
    const response = await GET(new Request('https://bisuportal.com/api/pilot/practice/task/files/file?download=1'), context);
    expect(response.status).toBe(502); expect(response.headers.has('Content-Disposition')).toBe(false);
    expect(await response.text()).not.toContain('error body');
  });
  it('does not expose storage failures or tokens', async () => {
    m.fetch.mockRejectedValue(new Error('https://storage.test/private?token=secret'));
    const response = await GET(new Request('https://bisuportal.com/api/pilot/practice/task/files/file'), context);
    expect(response.status).toBe(502); expect(await response.text()).not.toContain('secret');
  });
});
