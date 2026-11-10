import { beforeEach, describe, expect, it, vi } from 'vitest';
const actions = vi.hoisted(() => ({ getAriveTestWorkspace: vi.fn(), getPilotAriveTrackers: vi.fn() }));
vi.mock('@/app/actions/submissionPilotActions', () => actions);
vi.mock('@/lib/ariveTrackers', async () => import('../../lib/ariveTrackers'));
import { resolveAriveTrackerPackageTask } from './AriveTrackerPanel';

beforeEach(() => vi.clearAllMocks());
describe('tracker package resolution from a processing request', () => {
  it('resolves the authorized package ID rather than using the processing request ID', async () => {
    actions.getAriveTestWorkspace.mockResolvedValue({ success: true, data: { packages: [{ id: 'document-package-id' }] } });
    await expect(resolveAriveTrackerPackageTask('processing-request-id')).resolves.toBe('document-package-id');
    expect(actions.getAriveTestWorkspace).toHaveBeenCalledExactlyOnceWith('processing-request-id');
    expect(actions.getPilotAriveTrackers).not.toHaveBeenCalled();
  });
  it('preserves the authorized workspace scope failure without falling back to a raw ID', async () => {
    actions.getAriveTestWorkspace.mockResolvedValue({ success: false, error: 'This processing request is not accessible.' });
    await expect(resolveAriveTrackerPackageTask('other-request')).rejects.toThrow('not accessible');
    expect(actions.getPilotAriveTrackers).not.toHaveBeenCalled();
  });
  it.each([{ packages: [] }, { packages: [{ id: '' }] }, { packages: undefined }])('rejects a missing package instead of treating the request as one', async ({ packages }) => {
    actions.getAriveTestWorkspace.mockResolvedValue({ success: true, data: { packages } });
    await expect(resolveAriveTrackerPackageTask('processing-request-id')).rejects.toThrow('document package is unavailable');
    expect(actions.getPilotAriveTrackers).not.toHaveBeenCalled();
  });
});
