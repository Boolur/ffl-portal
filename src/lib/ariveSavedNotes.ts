import { ariveNotePlainText } from './ariveNoteText';
import { jsonRecord } from './ariveSyncState';

export type SavedAriveNote = { id: string; text: string; author: string; createdAt: string | null; updatedAt: string | null; replies: SavedAriveNote[] };

/** Explicit display projection. Never render stored Arive HTML or its metadata. */
export function savedAriveNotes(value: unknown, depth = 0): SavedAriveNote[] {
  if (!Array.isArray(value) || depth > 3) return [];
  const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
  return value.slice(0, 5000).flatMap(raw => {
    const n = jsonRecord(raw);
    if (typeof n.id !== 'string' || typeof n.text !== 'string') return [];
    return [{ id: n.id, text: ariveNotePlainText(n.text), author: typeof n.author === 'string' ? n.author : 'Arive user',
      createdAt: date(n.createdAt), updatedAt: date(n.updatedAt), replies: savedAriveNotes(n.replies, depth + 1) }];
  }).sort((a, b) => Date.parse(b.updatedAt || b.createdAt || '1970-01-01') - Date.parse(a.updatedAt || a.createdAt || '1970-01-01') || a.id.localeCompare(b.id));
}
