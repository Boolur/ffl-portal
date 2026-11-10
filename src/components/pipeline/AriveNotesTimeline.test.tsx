import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
vi.mock('@/app/actions/submissionPilotActions', () => ({ getAriveTestWorkspace: vi.fn() }));
import { AriveNotesTimeline, buildAriveNotesTimeline, filterAriveNotesTimeline, type AriveTimelineNote } from './AriveNotesTimeline';

function note(id: string, patch: Partial<AriveTimelineNote> = {}): AriveTimelineNote {
  return { id, text: `Note ${id}`, author: 'Processor', createdAt: '2026-11-10T18:00:00Z', updatedAt: '', replies: [], ...patch };
}
const render = (notes: AriveTimelineNote[], syncedAt: string | null = '2026-11-10T20:00:00Z') => renderToStaticMarkup(<AriveNotesTimeline notes={notes} syncedAt={syncedAt} />);

describe('complete imported Arive notes history', () => {
  it('retains earlier notes with the same header and ordinary notes, newest first', () => {
    const notes = [note('older', { text: 'Pending Items: Original request', createdAt: '2026-11-09T18:00:00Z' }), note('latest', { text: 'Pending Items: Updated request', createdAt: '2026-11-10T19:00:00Z' }), note('other', { text: 'Spoke with the borrower.' })];
    const before = JSON.stringify(notes);
    expect(buildAriveNotesTimeline(notes).map(entry => entry.note.id)).toEqual(['latest', 'other', 'older']);
    const html = render(notes);
    expect(html.indexOf('Updated request')).toBeLessThan(html.indexOf('Spoke with the borrower.'));
    expect(html.indexOf('Spoke with the borrower.')).toBeLessThan(html.indexOf('Original request'));
    expect(html).toContain('3 notes'); expect(html).toContain('Newest entries first');
    expect(html).toContain('Current processor fields use the latest matching note');
    expect(JSON.stringify(notes)).toBe(before);
  });

  it('orders every reply chronologically with its own author, timestamp, and parent context', () => {
    const notes = [note('parent', { author: 'Senior processor', text: 'Original question', createdAt: '2026-11-08T18:00:00Z', replies: [
      note('reply', { author: 'Junior processor', text: 'The first answer', createdAt: '2026-11-09T18:00:00Z', replies: [
        note('nested', { author: 'Loan officer', text: 'The latest follow-up', createdAt: '2026-11-10T19:00:00Z' }),
      ] }),
    ] })];
    const entries = buildAriveNotesTimeline(notes);
    expect(entries.map(entry => entry.note.id)).toEqual(['nested', 'reply', 'parent']);
    expect(entries[0].parent).toEqual({ author: 'Junior processor', text: 'The first answer' });
    const html = render(notes);
    expect(html).toContain('1 note'); expect(html).toContain('2 replies');
    expect(html).toContain('Loan officer'); expect(html).toContain('Junior processor'); expect(html).toContain('Senior processor');
    expect(html).toContain('Reply to Junior processor'); expect(html).toContain('Reply to Senior processor');
    expect(html).toContain('Nov 10, 2026'); expect(html).toContain('11:00 AM PST');
  });

  it('shows edit times without moving an old posted note ahead of newer entries', () => {
    const notes = [note('edited', { text: 'Older edited note', createdAt: '2026-11-08T18:00:00Z', updatedAt: '2026-11-10T20:00:00Z' }), note('posted', { text: 'Newer posted note', createdAt: '2026-11-09T18:00:00Z' })];
    expect(buildAriveNotesTimeline(notes).map(entry => entry.note.id)).toEqual(['posted', 'edited']);
    expect(render(notes)).toContain('Edited Nov 10, 2026');
  });

  it('uses a valid update date only when creation is unavailable and puts undated entries last', () => {
    const notes = [note('undated', { createdAt: 'invalid', updatedAt: '' }), note('updated', { createdAt: '', updatedAt: '2026-11-10T19:00:00Z' }), note('created')];
    expect(buildAriveNotesTimeline(notes).map(entry => entry.note.id)).toEqual(['updated', 'created', 'undated']);
    expect(render(notes)).toContain('Date not supplied');
  });

  it('orders equal timestamps deterministically without modifying the input', () => {
    expect(buildAriveNotesTimeline([note('a'), note('b')]).map(entry => entry.key)).toEqual(buildAriveNotesTimeline([note('b'), note('a')]).map(entry => entry.key));
  });

  it('renders HTML notes as safe readable text and escapes author/context content', () => {
    const notes = [note('parent', { author: '<img src=x onerror=evil()>', text: '<script>privateBadScript()</script><style>badStyle</style><p>Pending Items: A&amp;B</p><p>Income &lt; 5</p>', replies: [note('reply', { text: '<p><a href="javascript:evil()">Safe reply text</a><br>Second line</p>' })] })];
    const html = render(notes);
    expect(html).toContain('Pending Items: A&amp;B'); expect(html).toContain('Income &lt; 5');
    expect(html).toContain('Safe reply text\nSecond line');
    expect(html).not.toContain('<script'); expect(html).not.toContain('privateBadScript'); expect(html).not.toContain('badStyle');
    expect(html).not.toContain('href="javascript:'); expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    expect(notes[0].text).toContain('<script>');
  });

  it('searches the entire imported set by author or readable text, including replies', () => {
    const entries = buildAriveNotesTimeline([note('mortgage', { author: 'Alice Processor', text: '<p>Pending Items: insurance &amp; title</p>', replies: [note('reply', { author: 'Bob Loan Officer', text: 'Uploaded the policy.' })] }), note('other', { text: 'Appraisal scheduled.' })]);
    expect(filterAriveNotesTimeline(entries, ' BOB ').map(entry => entry.note.id)).toEqual(['reply']);
    expect(filterAriveNotesTimeline(entries, 'insurance & title').map(entry => entry.note.id).sort()).toEqual(['mortgage', 'reply']);
    expect(filterAriveNotesTimeline(entries, 'unmatched')).toEqual([]);
    expect(filterAriveNotesTimeline(entries, '')).toBe(entries);
  });

  it('keeps every imported entry available while limiting the initial rendered list', () => {
    const notes = Array.from({ length: 51 }, (_, index) => note(String(index), { text: `Synthetic history entry ${index}`, createdAt: new Date(Date.UTC(2026, 10, 10, 0, index)).toISOString() }));
    const entries = buildAriveNotesTimeline(notes);
    expect(entries).toHaveLength(51);
    expect(filterAriveNotesTimeline(entries, 'Synthetic history entry 0')).toHaveLength(1);
    const html = render(notes);
    expect(html).toContain('Showing 50 of 51 entries'); expect(html).toContain('Show 1 more');
    expect(html).toContain('Synthetic history entry 50'); expect(html).not.toContain('Synthetic history entry 0</p>');
  });

  it('distinguishes an empty successful import from notes that have never been imported', () => {
    expect(render([])).toContain('No Arive notes were returned in the latest successful import.');
    expect(render([], null)).toContain('Use Sync now to import the Arive notes');
    expect(render([])).toContain('Deleted notes and previous versions of edited notes are not included.');
  });
});
