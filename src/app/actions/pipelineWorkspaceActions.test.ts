import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ layouts: vi.fn(), metadata: vi.fn(), rows: vi.fn() }));
vi.mock('./processingPipelineActions', () => ({ getProcessingPipeline: mocks.rows, getProcessingPipelineMetadata: mocks.metadata }));
vi.mock('./processingPipelineLayoutActions', () => ({ getProcessingPipelineLayouts: mocks.layouts }));
import { getProcessingPipelineWorkspace } from './pipelineWorkspaceActions';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.layouts.mockResolvedValue({
    success: true,
    layouts: [{ isActive: true, config: { scope: 'ASSIGNED', buckets: { PIPELINE: { filters: { lenders: ['Chosen lender'] } } } } }],
  });
  mocks.metadata.mockResolvedValue({ success: true, teams: [], juniorProcessorOptions: [], seniorProcessorOptions: [] });
  mocks.rows.mockResolvedValue({ success: true, rows: [], total: 0, remainingIds: [] });
});

describe('processing workspace bootstrap', () => {
  it('applies saved scope and filters to the first batch before exposing any rows', async () => {
    expect(await getProcessingPipelineWorkspace()).toMatchObject({ success: true, data: { rows: [], teams: [] } });
    expect(mocks.rows).toHaveBeenCalledExactlyOnceWith({ sheet: 'PIPELINE', sortBy: 'pipelineStatus', sortDirection: 'asc', viewScope: 'ASSIGNED', filters: { lenders: ['Chosen lender'] } });
  });

  it('does not load rows when metadata authorization fails', async () => {
    mocks.metadata.mockResolvedValue({ success: false, error: 'Not authorized.' });
    expect(await getProcessingPipelineWorkspace()).toEqual({ success: false, error: 'Not authorized.' });
    expect(mocks.rows).not.toHaveBeenCalled();
  });
});
