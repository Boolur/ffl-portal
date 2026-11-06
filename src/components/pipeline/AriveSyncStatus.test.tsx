import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AriveSyncView } from '../../lib/ariveSyncTypes';
vi.mock('@/lib/ariveSyncPresentation', async () => import('../../lib/ariveSyncPresentation'));
vi.mock('@/app/actions/arivePipelineSyncActions', () => ({
  setArivePipelineSyncEnabled: vi.fn(), syncArivePipelineNow: vi.fn(), acknowledgeArivePipelineConflicts: vi.fn(),
}));
import { AriveSyncBadge, AriveSyncStatus } from './AriveSyncStatus';

function view(patch: Partial<AriveSyncView> = {}): AriveSyncView {
  return { enabled: true, lastSuccessAt: new Date().toISOString(), lastAttemptAt: null, nextAttemptAt: null,
    error: null, stage: 'APPLICATION_INTAKE', stageLabel: 'Application intake', stageDate: '2026-11-05T00:00:00.000Z',
    conflicts: [], missingFields: [], issues: [], managedFields: [], canManage: false, ...patch };
}
const render = (value: AriveSyncView | null, editing = false) => renderToStaticMarkup(createElement(AriveSyncStatus, { view: value, pipelineLoanId: 'test-pipeline', editing, onChanged: async () => {} }));

describe('Arive sync visibility', () => {
  it('renders no controls or badge for an ordinary loan', () => {
    expect(render(null)).toBe('');
    expect(renderToStaticMarkup(createElement(AriveSyncBadge, { view: null }))).toBe('');
  });
  it('shows status but no sync management actions without management permission', () => {
    const html = render(view());
    expect(html).toContain('Application intake');
    expect(html).toContain('11/05/26');
    expect(html).not.toContain('Sync now');
    expect(html).not.toContain('Pause sync');
  });
  it('only offers enable for a paused test file and disables actions while editing', () => {
    const html = render(view({ enabled: false, canManage: true }), true);
    expect(html).toContain('Enable test-file sync');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('Sync now');
  });
  it('offers sync and pause only for a managed enabled test file', () => {
    const html = render(view({ canManage: true }));
    expect(html).toContain('Sync now');
    expect(html).toContain('Pause sync');
    expect(html).not.toContain('Enable test-file sync');
  });
  it('explains that existing data is retained after a sync error', () => {
    expect(render(view({ error: 'Arive permission denied' }))).toContain('Previously synced information is still displayed.');
  });
  it('shows missing information as an accessible warning with readable field names', () => {
    const html = render(view({ missingFields: ['estimatedSigningAt'] }));
    expect(html).toContain('Missing or invalid source information');
    expect(html).toContain('Scheduled signing');
    expect(html).toContain('role="status"');
  });
  it('escapes imported text and lets only managers acknowledge differences', () => {
    const conflicts = [{ field: 'missingItemsCurrentStatus', label: 'Pending items', portalValue: '<script>unsafe()</script>', ariveValue: 'Confirmed', detectedAt: '2026-11-05T00:00:00Z' }];
    const html = render(view({ conflicts }));
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('Arive values were retained.');
    expect(html).not.toContain('Acknowledge differences');
    expect(render(view({ conflicts, canManage: true }))).toContain('Acknowledge differences');
  });
  it('keeps additional processor notes in an expandable section', () => {
    const html = render(view({ structuredFields: [{ key: 'water', label: 'Water inspection', value: 'Requested', author: 'Processor', updatedAt: null }] }));
    expect(html).toContain('Processor updates from Arive notes');
    expect(html).toContain('Water inspection');
    expect(html).toContain('<details ');
    expect(html).not.toContain('open=""');
  });
});
