import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AriveSyncServiceTracker } from '../../lib/ariveSyncTypes';
vi.mock('@/lib/ariveSyncPresentation', async () => import('../../lib/ariveSyncPresentation'));
import { AriveServiceStatusCards } from './AriveServiceStatusCards';

const tracker = (patch: Partial<AriveSyncServiceTracker> = {}): AriveSyncServiceTracker => ({ name: 'APPRAISAL', label: 'Appraisal', status: 'INSPECTED', statusLabel: 'Inspected', date: '2026-11-10', availability: 'current', ...patch });
const render = (props: Parameters<typeof AriveServiceStatusCards>[0]) => renderToStaticMarkup(createElement(AriveServiceStatusCards, props));

describe('service status cards', () => {
  it('shows the actual appraisal stage and calendar date without inferring receipt or requirement', () => {
    const html = render({ trackers: [tracker()] });
    expect(html).toContain('Inspected');
    expect(html).toContain('2026-11-10');
    expect(html).toContain('bg-blue-100 text-blue-700');
    expect(html).not.toContain('Received');
    expect(html).not.toContain('Appraisal needed');
    expect(html).toContain('grid-cols-1');
    expect(html).toContain('sm:grid-cols-2');
    expect(html).toContain('lg:grid-cols-4');
  });
  it('distinguishes received, unknown, and unavailable source values', () => {
    expect(render({ trackers: [tracker({ status: 'RECEIVED', statusLabel: 'Received' })] })).toContain('border-emerald-200 bg-emerald-50');
    const unknown = render({ trackers: [tracker({ status: 'CUSTOM_REVIEW', statusLabel: 'Custom review', date: null })] });
    expect(unknown).toContain('Custom review');
    expect(unknown).toContain('Date not supplied');
    expect(unknown).not.toContain('bg-emerald-50');
    const missing = render({ trackers: [tracker({ status: '', statusLabel: 'Not supplied by Arive', availability: 'missing', date: null })] });
    expect(missing).toContain('Not supplied by Arive');
    expect(missing).toContain('border-amber-200 bg-amber-50');
    expect(missing).not.toContain('Inspected');
  });
  it('marks unstarted service progress red while waived and not-needed states remain neutral', () => {
    for (const status of ['NOT_ORDERED', 'NOT_REQUESTED', 'NOT_STARTED']) {
      expect(render({ trackers: [tracker({ status, statusLabel: status })] })).toContain('border-rose-200 bg-rose-50');
    }
    for (const status of ['WAIVED', 'NOT_NEEDED', 'NOT_APPLICABLE']) {
      const html = render({ trackers: [tracker({ status, statusLabel: status })] });
      expect(html).toContain('border-slate-200 bg-white');
      expect(html).not.toContain('bg-rose-50');
    }
  });
  it('labels portal data with its actual source and keeps the compact variant concise', () => {
    const portal = render({ trackers: [tracker()], sourceLabel: 'Portal' });
    expect(portal).toContain('Portal service progress');
    expect(portal).toContain('>Portal<');
    expect(portal).not.toContain('Arive');
    const compact = render({ trackers: [tracker()], variant: 'compact' });
    expect(compact).toContain('Inspected');
    expect(compact).not.toContain('>Arive<');
    expect(render({ trackers: [] })).toBe('');
    expect(render({ trackers: null })).toBe('');
  });
});
