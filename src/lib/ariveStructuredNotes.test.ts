import { describe, expect, it } from 'vitest';
import type { AriveNote } from './ariveClient';
import { ARIVE_STRUCTURED_NOTE_KEYS, parseAriveStructuredNotes, type AriveStructuredNoteKey } from './ariveStructuredNotes';

const timestamp = '2026-11-05T12:00:00.000Z';
function note(id: string, text: string, overrides: Partial<AriveNote> = {}): AriveNote {
  return { id, text, author: 'Synthetic processor', createdAt: timestamp, updatedAt: timestamp, replies: [], ...overrides };
}
function previousFor(source: AriveNote, field: AriveStructuredNoteKey) {
  return { [field]: parseAriveStructuredNotes([source]).fields[field].source! };
}

describe('Arive structured-note instructions', () => {
  it('recognizes all supported headers case-insensitively with anchored section boundaries', () => {
    const result = parseAriveStructuredNotes([note('1', '  pEnDiNg   iTeMs : paystubs\nInsurance declarations\nSCHEDULED SIGNING: 11/08/2026\nPayoff Expiry: 2026-11-30\nCondition needed: income explanation\nHOI expiration: 12/31/2026\n1004d: final inspection\nWater inspection: schedule vendor\nPest inspection: received')]);
    expect(Object.fromEntries(ARIVE_STRUCTURED_NOTE_KEYS.map(key => [key, result.fields[key].value]))).toEqual({
      pendingItems: 'paystubs\nInsurance declarations', scheduledSigning: '2026-11-08', payoffExpiry: '2026-11-30',
      conditionNeeded: 'income explanation', hoiExpiration: '2026-12-31', completion1004D: 'final inspection',
      waterInspection: 'schedule vendor', pestInspection: 'received',
    });
    expect(result.issues).toEqual([]);
  });
  it('does not match quoted, inline, or unrelated prose as instructions', () => {
    const result = parseAriveStructuredNotes([note('1', 'Please discuss Pending Items: paystubs\n> Scheduled Signing: 11/08/2026\nOrdinary notes: nothing structured')]);
    expect(result.issues).toEqual([]);
    for (const field of Object.values(result.fields)) expect(field).toEqual({ action: 'KEEP', value: null, source: null, issue: null });
  });
  it('extracts Froala sections without mutating raw source content', () => {
    const raw = '<p>Pending Items:</p><ul><li>A&amp;B statements</li><li>Paystubs</li></ul><p>Scheduled Signing: 2026-11-10</p>';
    const input = note('123', raw);
    const before = JSON.stringify(input);
    const result = parseAriveStructuredNotes([input]);
    expect(result.fields.pendingItems.value).toBe('• A&B statements\n• Paystubs');
    expect(result.fields.pendingItems.source).toMatchObject({ noteId: '123', parentNoteId: null, author: input.author, createdAt: timestamp, updatedAt: timestamp, effectiveAt: timestamp, rawText: raw, sectionIndex: 0 });
    expect(result.fields.scheduledSigning.value).toBe('2026-11-10');
    expect(JSON.stringify(input)).toBe(before);
  });
  it('uses an edited note updatedAt ahead of a more recently created unedited note', () => {
    const edited = note('1', 'Pending Items: updated request', { createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-06T12:00:00Z' });
    const newerCreated = note('2', 'Pending Items: older request');
    expect(parseAriveStructuredNotes([edited, newerCreated]).fields.pendingItems.value).toBe('updated request');
  });
  it('includes replies with their own timestamps and parent provenance', () => {
    const parent = note('1', 'Pending Items: parent request', { replies: [note('2', 'Pending Items: reply correction', { updatedAt: '2026-11-05T13:00:00Z' })] });
    const field = parseAriveStructuredNotes([parent]).fields.pendingItems;
    expect(field.value).toBe('reply correction');
    expect(field.source).toMatchObject({ noteId: '2', parentNoteId: '1' });
  });
  it('falls back from an absent updatedAt to a valid createdAt', () => {
    const field = parseAriveStructuredNotes([note('1', 'Pending Items: review', { updatedAt: '' })]).fields.pendingItems;
    expect(field.action).toBe('SET');
    expect(field.source?.effectiveAt).toBe(timestamp);
  });
  it('resolves exact timestamp ties deterministically by ID and then section position', () => {
    const older = note('2', 'Pending Items: earlier');
    const later = note('10', 'Pending Items: superseded within note\nScheduled Signing: 2026-11-08\nPending Items: final instruction');
    const first = parseAriveStructuredNotes([older, later]);
    expect(first).toEqual(parseAriveStructuredNotes([later, older]));
    expect(first.fields.pendingItems.value).toBe('final instruction');
    expect(first.fields.pendingItems.source?.sectionIndex).toBe(2);
  });
  it('uses createdAt as a secondary timestamp tie breaker', () => {
    const a = note('99', 'Pending Items: older creation', { createdAt: '2026-11-01T12:00:00Z' });
    const b = note('1', 'Pending Items: newer creation', { createdAt: '2026-11-02T12:00:00Z' });
    expect(parseAriveStructuredNotes([a, b]).fields.pendingItems.value).toBe('newer creation');
  });
  it.each(['2028-02-29', '02/29/2028', '2000-02-29', '12/31/2026'])('accepts explicit valid calendar date %s', value => {
    expect(parseAriveStructuredNotes([note('1', `Scheduled Signing: ${value}`)]).fields.scheduledSigning.action).toBe('SET');
  });
  it.each(['2026-02-29', '1900-02-29', '2026-04-31', '13/01/2026', '00/10/2026', '01/00/2026', '0000-01-01', 'tomorrow', 'next Friday', '11/05/26', '1/5/2026', '2026-11-05T14:00:00Z', '2026-11-05 at 2pm'])('rejects ambiguous or impossible date %s without using an older instruction', value => {
    const older = note('1', 'Scheduled Signing: 2026-11-08');
    const latest = note('2', `Scheduled Signing: ${value}`, { updatedAt: '2026-11-06T12:00:00Z' });
    const result = parseAriveStructuredNotes([older, latest], previousFor(older, 'scheduledSigning'));
    expect(result.fields.scheduledSigning).toMatchObject({ action: 'KEEP', value: null, issue: 'INVALID_DATE', source: { noteId: '2' } });
  });
  it.each(['clear', 'NONE', '  Clear  '])('clears text and dates only with the explicit whole-section instruction %s', value => {
    const result = parseAriveStructuredNotes([note('1', `Pending Items: ${value}\nScheduled Signing: ${value}`)]);
    expect(result.fields.pendingItems.action).toBe('CLEAR');
    expect(result.fields.scheduledSigning).toMatchObject({ action: 'CLEAR', value: null, issue: null });
  });
  it('does not interpret empty sections or explanatory text as an implicit clear', () => {
    const result = parseAriveStructuredNotes([note('1', 'Pending Items: none required except insurance\nScheduled Signing:\n\nPayoff Expiry: clear after approval')]);
    expect(result.fields.pendingItems).toMatchObject({ action: 'SET', value: 'none required except insurance' });
    expect(result.fields.scheduledSigning).toMatchObject({ action: 'KEEP', issue: 'EMPTY_SECTION' });
    expect(result.fields.payoffExpiry).toMatchObject({ action: 'KEEP', issue: 'INVALID_DATE' });
  });
  it('does not fall back when the latest repeated header is blank', () => {
    const result = parseAriveStructuredNotes([note('1', 'Pending Items: old text\nPending Items:')]);
    expect(result.fields.pendingItems).toMatchObject({ action: 'KEEP', issue: 'EMPTY_SECTION', source: { sectionIndex: 1 } });
  });
  it.each([
    { updatedAt: 'not a timestamp' }, { updatedAt: '2026-11-05T12:00:00' },
    { updatedAt: '2026-02-30T12:00:00Z' }, { updatedAt: '2026-11-05T24:00:00Z' },
    { createdAt: 'invalid', updatedAt: timestamp }, { createdAt: '', updatedAt: '' },
  ])('flags malformed source timestamps instead of silently choosing a valid older note (%j)', overrides => {
    const result = parseAriveStructuredNotes([note('1', 'Pending Items: previous'), note('2', 'Pending Items: unknown date', overrides)]);
    expect(result.fields.pendingItems).toMatchObject({ action: 'KEEP', issue: 'INVALID_SOURCE_TIMESTAMP', source: { noteId: '2', effectiveAt: null } });
  });
  it('compares source offsets by actual time without depending on local timezone', () => {
    const result = parseAriveStructuredNotes([note('1', 'Pending Items: UTC', { updatedAt: '2026-11-05T12:00:00Z' }), note('2', 'Pending Items: offset', { updatedAt: '2026-11-05T05:00:01-07:00' })]);
    expect(result.fields.pendingItems.value).toBe('offset');
    expect(result.fields.pendingItems.source?.effectiveAt).toBe('2026-11-05T12:00:01.000Z');
  });
  it('preserves the applied value after its source note is deleted, even when older instructions remain', () => {
    const older = note('1', 'Pending Items: old');
    const applied = note('2', 'Pending Items: current', { updatedAt: '2026-11-06T12:00:00Z' });
    const result = parseAriveStructuredNotes([older], previousFor(applied, 'pendingItems'));
    expect(result.fields.pendingItems).toMatchObject({ action: 'KEEP', issue: 'SOURCE_REMOVED', reason: 'NOTE_DELETED', source: { noteId: '2', sectionText: 'current' } });
  });
  it('distinguishes an edited-away header from a deleted note', () => {
    const applied = note('2', 'Pending Items: current');
    const edited = note('2', 'General commentary only', { updatedAt: '2026-11-06T12:00:00Z' });
    expect(parseAriveStructuredNotes([edited], previousFor(applied, 'pendingItems')).fields.pendingItems).toMatchObject({ action: 'KEEP', issue: 'SOURCE_REMOVED', reason: 'HEADER_REMOVED' });
  });
  it('handles a header replaced with a different supported header independently', () => {
    const applied = note('2', 'Pending Items: current');
    const edited = note('2', 'Condition needed: revised condition', { updatedAt: '2026-11-06T12:00:00Z' });
    const result = parseAriveStructuredNotes([edited], previousFor(applied, 'pendingItems'));
    expect(result.fields.pendingItems.issue).toBe('SOURCE_REMOVED');
    expect(result.fields.conditionNeeded).toMatchObject({ action: 'SET', value: 'revised condition' });
  });
  it('accepts a genuinely newer replacement after the previously applied source is removed', () => {
    const applied = note('1', 'Scheduled Signing: 2026-11-08');
    const replacement = note('2', 'Scheduled Signing: 2026-11-09', { updatedAt: '2026-11-06T12:00:00Z' });
    expect(parseAriveStructuredNotes([replacement], previousFor(applied, 'scheduledSigning')).fields.scheduledSigning).toMatchObject({ action: 'SET', value: '2026-11-09', source: { noteId: '2' } });
  });
  it('applies edits to a surviving source and ignores section-position changes for its previous rank', () => {
    const applied = note('1', 'Scheduled Signing: 2026-11-08\nPending Items: previous');
    const edited = note('1', 'Pending Items: changed\nScheduled Signing: 2026-11-08');
    expect(parseAriveStructuredNotes([edited], previousFor(applied, 'pendingItems')).fields.pendingItems).toMatchObject({ action: 'SET', value: 'changed' });
  });
  it('does not roll an applied source backward to an older timestamp', () => {
    const applied = note('1', 'Pending Items: current', { updatedAt: '2026-11-06T12:00:00Z' });
    expect(parseAriveStructuredNotes([note('1', 'Pending Items: stale')], previousFor(applied, 'pendingItems')).fields.pendingItems).toMatchObject({ action: 'KEEP', issue: 'SOURCE_REGRESSED' });
  });
  it('keeps no-header fields unchanged without an issue when they have no applied source', () => {
    const result = parseAriveStructuredNotes([]);
    expect(result.issues).toEqual([]);
    expect(Object.values(result.fields).every(field => field.action === 'KEEP' && field.issue === null && field.source === null)).toBe(true);
  });
  it('limits meaningful section values and does not silently truncate', () => {
    expect(parseAriveStructuredNotes([note('1', `Pending Items: ${'x'.repeat(10000)}`)]).fields.pendingItems.action).toBe('SET');
    const result = parseAriveStructuredNotes([note('1', `Pending Items: ${'x'.repeat(10001)}`)]);
    expect(result.fields.pendingItems).toMatchObject({ action: 'KEEP', value: null, issue: 'VALUE_TOO_LONG' });
    expect(result.fields.pendingItems.source?.sectionText.length).toBe(10001);
  });
  it('flags conflicting copies with the same ID and timestamps instead of relying on input order', () => {
    const first = note('1', 'Pending Items: first');
    const second = note('1', 'Pending Items: second');
    const result = parseAriveStructuredNotes([first, second]);
    expect(result).toEqual(parseAriveStructuredNotes([second, first]));
    expect(result.fields.pendingItems).toMatchObject({ action: 'KEEP', issue: 'CONFLICTING_SOURCE' });
  });
  it('also chooses deterministic provenance for equivalent duplicate representations', () => {
    const plain = note('1', 'Pending Items: paystubs');
    const formatted = note('1', '<p>Pending Items: paystubs</p>');
    expect(parseAriveStructuredNotes([plain, formatted])).toEqual(parseAriveStructuredNotes([formatted, plain]));
  });
  it('never reads instructions from script or style content', () => {
    const result = parseAriveStructuredNotes([note('1', '<script>Pending Items: hidden</script><style>Scheduled Signing: 2026-11-08</style><p>Visible general note</p>')]);
    expect(result.issues).toEqual([]);
    expect(result.fields.pendingItems.source).toBeNull();
    expect(result.fields.scheduledSigning.source).toBeNull();
  });
});
