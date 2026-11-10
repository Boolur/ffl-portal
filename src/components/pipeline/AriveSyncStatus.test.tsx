import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AriveSyncView } from '../../lib/ariveSyncTypes';
vi.mock('@/lib/ariveSyncPresentation', async () => import('../../lib/ariveSyncPresentation'));
vi.mock('@/app/actions/arivePipelineSyncActions', () => ({
  setArivePipelineSyncEnabled: vi.fn(), syncArivePipelineNow: vi.fn(), acknowledgeArivePipelineConflicts: vi.fn(),
}));
import { AriveSyncBadge, AriveSyncStatus, ariveSyncActionFeedback } from './AriveSyncStatus';
import { ariveNoteHeaderGuide } from './AriveNoteHeaderGuide';
import { parseAriveStructuredNotes } from '../../lib/ariveStructuredNotes';

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
  it('offers the collapsed note guide even before the first imported note', () => {
    const html = render(view({ structuredFields: [] }));
    expect(html).toContain('How to write Arive updates');
    expect(html).toContain('Updates pipeline fields');
    expect(html).toContain('Shown in workspace processor updates');
    for (const item of ariveNoteHeaderGuide) expect(html).toContain(item.header);
    expect(html).toContain('Estimated Signing');
    expect(html).toContain('Payoff Expiration');
    expect(html).toContain('MM/DD/YYYY');
    expect(html).toContain('YYYY-MM-DD');
    expect(html).toContain('<code>Clear</code>');
    expect(html).toContain('<code>None</code>');
    expect(html).toContain('Edit notes in Arive.');
    expect(html).toContain('Portal task conversations do not update these fields.');
    expect(html).not.toContain('open=""');
  });
  it('shows the exact synchronized appraisal status beside the other three service trackers', () => {
    const html = render(view({ serviceTrackers: [
      { name: 'TITLE', label: 'Title', status: 'RECEIVED', statusLabel: 'Received', date: '2026-11-10', availability: 'current' },
      { name: 'HOI', label: 'Homeowners insurance', status: 'ORDERED', statusLabel: 'Ordered', date: '2026-11-10', availability: 'current' },
      { name: 'APPRAISAL', label: 'Appraisal', status: 'INSPECTED', statusLabel: 'Inspected', date: '2026-11-09', availability: 'current' },
      { name: 'PAYOFFS', label: 'Payoffs', status: 'NOT_ORDERED', statusLabel: 'Not ordered', date: null, availability: 'current' },
    ] }));
    expect(html).toContain('Last synchronized service progress');
    expect(html).toContain('Inspected');
    expect(html).toContain('2026-11-10');
    expect(html).toContain('2026-11-09');
    expect(html).toContain('Date not supplied');
    expect(html.indexOf('Homeowners insurance')).toBeGreaterThan(html.indexOf('>Title<'));
    expect(html.indexOf('>Appraisal<')).toBeGreaterThan(html.indexOf('Homeowners insurance'));
    expect(html.indexOf('>Payoffs<')).toBeGreaterThan(html.indexOf('>Appraisal<'));
  });
  it('shows unavailable tracker readings as warnings without inventing a service state', () => {
    const html = render(view({ serviceTrackers: [
      { name: 'TITLE', label: 'Title', status: '', statusLabel: 'Status not supplied', date: null, availability: 'missing' },
      { name: 'APPRAISAL', label: 'Appraisal', status: '', statusLabel: 'Multiple current statuses — review in Arive', date: null, availability: 'ambiguous' },
    ] }));
    expect(html).toContain('Status not supplied');
    expect(html).toContain('Multiple current statuses');
    expect(html).toContain('border-amber-200 bg-amber-50');
    expect(html).not.toContain('Not ordered');
    expect(html).not.toContain('Received');
  });
  it('keeps all eight displayed headers compatible with the actual note parser', () => {
    const notes = [{ id: 'guide-note', text: ariveNoteHeaderGuide.map(item => `${item.header} ${item.date ? '11/18/2026' : 'Updated information'}`).join('\n'), author: 'Processor', createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-10T12:00:00Z', replies: [] }];
    const parsed = parseAriveStructuredNotes(notes);
    expect(ariveNoteHeaderGuide).toHaveLength(8);
    expect(ariveNoteHeaderGuide.filter(item => item.group === 'pipeline')).toHaveLength(3);
    expect(ariveNoteHeaderGuide.filter(item => item.group === 'workspace')).toHaveLength(5);
    expect(parsed.issues).toEqual([]);
    for (const item of ariveNoteHeaderGuide) {
      expect(parsed.fields[item.key].action).toBe('SET');
      expect(parsed.fields[item.key].value).toBe(item.date ? '2026-11-18' : 'Updated information');
    }
  });
  it('keeps sync controls visible in the compact bar without duplicating service cards or the notes guide', () => {
    const html = renderToStaticMarkup(createElement(AriveSyncStatus, {
      view: view({ canManage: true, serviceTrackers: [{ name: 'APPRAISAL', label: 'Appraisal', status: 'INSPECTED', statusLabel: 'Inspected', date: null, availability: 'current' }] }),
      pipelineLoanId: 'test-pipeline', compact: true, onChanged: async () => {},
    }));
    expect(html).toContain('Sync now');
    expect(html).toContain('Last successful sync:');
    expect(html).toContain('Sync details');
    expect(html).not.toContain('How to write Arive updates');
    expect(html).not.toContain('Inspected');
    expect(html).not.toContain('open=""');
  });
  it('opens compact details for a conflict and keeps a sync error outside the collapsed content', () => {
    const html = renderToStaticMarkup(createElement(AriveSyncStatus, {
      view: view({ error: 'Arive could not be reached.', conflicts: [{ field: 'titleStatus', label: 'Title', portalValue: 'ORDERED', ariveValue: 'RECEIVED', detectedAt: '2026-11-10T12:00:00Z' }] }),
      pipelineLoanId: 'test-pipeline', compact: true, onChanged: async () => {},
    }));
    expect(html).toContain('Sync details · Review needed');
    expect(html).toContain('open=""');
    expect(html.indexOf('Arive could not be reached.')).toBeLessThan(html.indexOf('<details'));
    expect(html).toContain('Arive values were retained.');
  });
});

describe('Arive sync action feedback', () => {
  it.each(['sync', 'enable'] as const)('does not claim a completed refresh when %s was skipped', action => {
    const feedback = ariveSyncActionFeedback(action, { success: true, skipped: true });
    expect(feedback.tone).toBe('pending');
    expect(feedback.message).toContain('No new sync completed.');
    expect(feedback.message).toContain('last successful sync time');
    expect(feedback.message).not.toContain('have been applied');
    expect(feedback.message).not.toContain('updates enabled');
  });
  it('reports a successful no-change read separately from applying changes', () => {
    expect(ariveSyncActionFeedback('sync', { success: true, skipped: false, changed: false, issues: 0 })).toEqual({ tone: 'success', message: 'Arive checked. Pipeline values were already up to date.' });
    expect(ariveSyncActionFeedback('sync', { success: true, skipped: false, changed: true, issues: 0 }).message).toContain('have been applied');
  });
  it('shows source warnings even when the read made no pipeline changes', () => {
    const feedback = ariveSyncActionFeedback('sync', { success: true, skipped: false, changed: false, issues: 2 });
    expect(feedback.tone).toBe('warning');
    expect(feedback.message).toContain('source warnings');
    expect(feedback.message).not.toContain('already up to date');
  });
  it('does not describe pausing or acknowledging differences as a data refresh', () => {
    expect(ariveSyncActionFeedback('pause', { success: true }).message).toBe('Automatic Arive updates paused.');
    expect(ariveSyncActionFeedback('acknowledge', { success: true }).message).toContain('recorded history is retained');
  });
});
