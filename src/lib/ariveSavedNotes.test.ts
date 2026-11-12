import { describe, expect, it } from 'vitest';
import { savedAriveNotes } from './ariveSavedNotes';

describe('saved loan-scoped note history', () => {
  it('keeps prior notes and replies, sorts newest first, and emits plain text only', () => {
    const notes = savedAriveNotes([
      { id: 'old', text: '<p>Earlier note</p>', author: 'Processor', createdAt: '2026-01-01', privateAccount: 'PRIVATE' },
      { id: 'new', text: '<script>PRIVATE</script><p>Pending Items: Paystub</p>', createdAt: '2026-02-01', replies: [{ id: 'reply', text: 'Received', updatedAt: '2026-02-02' }] },
    ]);
    expect(notes.map(note => note.id)).toEqual(['new', 'old']);
    expect(notes[0].text).toBe('Pending Items: Paystub');
    expect(notes[0].replies[0].text).toBe('Received');
    expect(JSON.stringify(notes)).not.toContain('PRIVATE');
    expect(savedAriveNotes([{ id: 'bad', text: 4 }, null])).toEqual([]);
  });
});
