import { describe, expect, it } from 'vitest';
import { formatAriveTrackerDate, normalizeAriveTrackers } from './ariveTrackers';

describe('Arive tracker summaries', () => {
  it('preserves a date-only milestone as its calendar date', () => {
    expect(formatAriveTrackerDate('2026-11-05')).toBe('11/5/2026');
  });
  it('preserves the actual status and supplied milestone date', () => {
    expect(normalizeAriveTrackers({ loanTrackers: [{ name: 'TITLE', displayName: 'Title', currentTrackerStatus: { name: 'RECEIVED', displayName: 'Received', date: '2026-11-05T21:00:00Z' }, unrelated: 'not exported' }] })).toEqual([{ name: 'TITLE', label: 'Title', status: 'RECEIVED', statusLabel: 'Received', date: '2026-11-05T21:00:00Z' }]);
  });
  it('does not invent dates or completed statuses when Arive omits them', () => {
    expect(normalizeAriveTrackers({ loanTrackers: [{ name: 'HOI', currentTrackerStatus: null }, { name: 'APPRAISAL', currentTrackerStatus: { name: 'RECEIVED', date: 'invalid' } }] })).toEqual([
      { name: 'HOI', label: 'HOI', status: '', statusLabel: 'Not supplied', date: null },
      { name: 'APPRAISAL', label: 'APPRAISAL', status: 'RECEIVED', statusLabel: 'RECEIVED', date: null },
    ]);
  });
  it('supports the current-status object and equivalent singleton-array API shapes', () => {
    const status = { name: 'ORDERED', displayName: 'Ordered', date: '2026-11-10' };
    const object = normalizeAriveTrackers({ loanTrackers: [{ name: 'TITLE', currentTrackerStatus: status }] });
    expect(normalizeAriveTrackers({ loanTrackers: [{ name: 'TITLE', currentTrackerStatus: [status] }] })).toEqual(object);
    expect(object[0]).toMatchObject({ status: 'ORDERED', date: '2026-11-10' });
    expect(normalizeAriveTrackers({ loanTrackers: [{ name: 'HOI', currentTrackerStatus: [] }] })[0]).toMatchObject({ status: '', statusLabel: 'Not supplied', date: null });
  });
  it.each([
    { currentTrackerStatus: [{ name: 'ORDERED' }, { name: 'RECEIVED' }] },
    { currentTrackerStatus: [null] }, { currentTrackerStatus: ['RECEIVED'] },
    { currentTrackerStatus: [[{ name: 'RECEIVED' }]] },
  ])('rejects ambiguous or malformed current-status arrays %j', ({ currentTrackerStatus }) => {
    expect(() => normalizeAriveTrackers({ loanTrackers: [{ name: 'TITLE', currentTrackerStatus }] })).toThrow();
  });
  it('rejects malformed responses instead of treating them as no trackers', () => {
    expect(() => normalizeAriveTrackers({})).toThrow();
    expect(() => normalizeAriveTrackers({ loanTrackers: [null] })).toThrow();
    expect(() => normalizeAriveTrackers({ loanTrackers: [{ name: 'TITLE', currentTrackerStatus: 'complete' }] })).toThrow();
    expect(normalizeAriveTrackers({ loanTrackers: [] })).toEqual([]);
  });
});
