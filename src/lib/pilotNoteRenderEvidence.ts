export type PilotNoteEvidence = { noteId: string; parentNoteId: string | null; createdAt: string };
export type PilotRenderSurface = 'GRID' | 'DETAIL' | 'NOTES';
export type PilotRenderEntry = { id: string; version: number; noteId?: string; parentNoteId?: string | null };

/** Accept only an exact provider timestamp. A date-only milestone cannot establish latency. */
export function readPilotNoteEvidence(snapshot: unknown, collectedAt: Date): PilotNoteEvidence[] {
  if (!snapshot || typeof snapshot !== 'object' || !('noteChangeEvidence' in snapshot)) return [];
  const evidence = snapshot.noteChangeEvidence;
  if (!Array.isArray(evidence)) return [];
  return evidence.flatMap((entry: unknown) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      !('noteId' in entry) ||
      typeof entry.noteId !== 'string' ||
      !('parentNoteId' in entry) ||
      (entry.parentNoteId !== null && typeof entry.parentNoteId !== 'string') ||
      !('createdAt' in entry) ||
      typeof entry.createdAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/i.test(entry.createdAt)
    )
      return [];
    const time = Date.parse(entry.createdAt);
    if (!Number.isFinite(time) || time > collectedAt.getTime()) return [];
    return [{ noteId: entry.noteId, parentNoteId: entry.parentNoteId, createdAt: new Date(time).toISOString() }];
  });
}

export function visibleSourceNoteTime(evidence: readonly PilotNoteEvidence[], visible: readonly PilotRenderEntry[]) {
  const times = evidence
    .filter((note) => visible.some((entry) => entry.noteId === note.noteId && entry.parentNoteId === note.parentNoteId))
    .map((note) => Date.parse(note.createdAt));
  return times.length ? new Date(Math.min(...times)) : null;
}
