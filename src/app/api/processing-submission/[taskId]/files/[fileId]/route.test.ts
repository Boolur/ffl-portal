import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ access: vi.fn(), download: vi.fn() }));
vi.mock('@/app/actions/submissionPilotActions', () => ({ getPilotFileAccess: mocks.access, downloadPilotFile: mocks.download }));
vi.mock('@/lib/documentDelivery', async () => import('../../../../../../lib/documentDelivery'));
import { GET } from './route';
const context = { params: Promise.resolve({ taskId: 'task', fileId: 'file' }) };
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe('named private document response', () => {
  it('streams the original filename and bytes without exposing the storage path', async () => {
    mocks.access.mockResolvedValue({ success: true, data: { url: 'https://storage.example.test/random', name: 'Mortgage Statement.pdf', type: 'application/pdf', size: 3 } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('PDF', { headers: { 'Content-Length': '3' } })));
    const response = await GET(new Request('https://portal.example.test/file'), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Disposition')).toContain('inline; filename="Mortgage Statement.pdf"');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('Location')).toBeNull();
    expect(await response.text()).toBe('PDF');
  });
  it('preserves PDF range requests and original names for explicit downloads', async () => {
    mocks.access.mockResolvedValue({ success: true, data: { url: 'https://storage.example.test/random', name: 'Original.pdf', type: 'application/pdf', size: 9 } });
    const fetcher = vi.fn().mockResolvedValue(new Response('PDF', { status: 206, headers: { 'Content-Range': 'bytes 0-2/9', 'Content-Length': '3' } }));
    vi.stubGlobal('fetch', fetcher);
    const response = await GET(new Request('https://portal.example.test/file?download=1', { headers: { Range: 'bytes=0-2' } }), context);
    expect(response.status).toBe(206);
    expect(response.headers.get('Content-Range')).toBe('bytes 0-2/9');
    expect(response.headers.get('Content-Disposition')).toContain('attachment; filename="Original.pdf"');
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ headers: { Range: 'bytes=0-2' } }));
  });
  it('never fetches storage when access is denied', async () => {
    mocks.access.mockResolvedValue({ success: false, error: 'Access denied' });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    expect((await GET(new Request('https://portal.example.test/file'), context)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('reports upstream failures instead of serving an error page as a PDF', async () => {
    mocks.access.mockResolvedValue({ success: true, data: { url: 'https://storage.example.test/random', name: 'Document.pdf', type: 'application/pdf', size: 3 } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
    expect((await GET(new Request('https://portal.example.test/file'), context)).status).toBe(502);
  });
});
