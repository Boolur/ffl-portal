import type { AriveNote } from './ariveClient';
import { ariveNotePlainText } from './ariveNoteText';

export const ARIVE_STRUCTURED_NOTE_KEYS = [
  'pendingItems', 'scheduledSigning', 'payoffExpiry', 'conditionNeeded',
  'hoiExpiration', 'completion1004D', 'waterInspection', 'pestInspection',
] as const;
export type AriveStructuredNoteKey = typeof ARIVE_STRUCTURED_NOTE_KEYS[number];
export type AriveStructuredNoteIssueCode =
  | 'EMPTY_SECTION' | 'INVALID_DATE' | 'VALUE_TOO_LONG' | 'INVALID_SOURCE_TIMESTAMP'
  | 'SOURCE_REMOVED' | 'SOURCE_REGRESSED' | 'CONFLICTING_SOURCE';
export type AriveStructuredNoteRemovalReason = 'NOTE_DELETED' | 'HEADER_REMOVED';
export type AriveStructuredNoteSource = {
  noteId: string;
  parentNoteId: string | null;
  author: string;
  createdAt: string;
  updatedAt: string;
  effectiveAt: string | null;
  sectionIndex: number;
  /** Preserve in restricted storage/audit only, never diagnostic logs. */
  rawText: string;
  sectionText: string;
};
export type AriveStructuredNoteField = {
  /** KEEP means leave the existing portal value and its applied provenance untouched. */
  action: 'SET' | 'CLEAR' | 'KEEP';
  /** Date values are calendar-only YYYY-MM-DD; text values retain meaningful line breaks. */
  value: string | null;
  source: AriveStructuredNoteSource | null;
  issue: AriveStructuredNoteIssueCode | null;
  reason?: AriveStructuredNoteRemovalReason;
};
export type AriveStructuredNoteIssue = {
  field: AriveStructuredNoteKey;
  code: AriveStructuredNoteIssueCode;
  source: AriveStructuredNoteSource;
  reason?: AriveStructuredNoteRemovalReason;
};
export type AriveStructuredNoteResult = {
  fields: Record<AriveStructuredNoteKey, AriveStructuredNoteField>;
  issues: AriveStructuredNoteIssue[];
};

const MAX_SECTION_LENGTH = 10000;
const headers: Record<string, AriveStructuredNoteKey> = {
  'pending items': 'pendingItems', 'scheduled signing': 'scheduledSigning',
  'payoff expiry': 'payoffExpiry', 'condition needed': 'conditionNeeded',
  'hoi expiration': 'hoiExpiration', '1004d': 'completion1004D',
  'water inspection': 'waterInspection', 'pest inspection': 'pestInspection',
};
const sectionHeader = /^[\t ]*(pending[\t ]+items|scheduled[\t ]+signing|payoff[\t ]+expiry|condition[\t ]+needed|hoi[\t ]+expiration|1004d|water[\t ]+inspection|pest[\t ]+inspection)[\t ]*:[\t ]*(.*)$/i;
const dateFields = new Set<AriveStructuredNoteKey>(['scheduledSigning', 'payoffExpiry', 'hoiExpiration']);
type Candidate = { field: AriveStructuredNoteKey; source: AriveStructuredNoteSource; invalidTimestamp: boolean };
type TimestampRank = { effective: number; created: number; invalid: boolean };

function validCalendarDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/** Calendar validation intentionally does not let Date.parse normalize impossible dates. */
function normalizedDate(value: string): string | null {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const us = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!iso && !us) return null;
  const [year, month, day] = iso ? [Number(iso[1]), Number(iso[2]), Number(iso[3])] : [Number(us![3]), Number(us![1]), Number(us![2])];
  return validCalendarDate(year, month, day) ? `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}

function sourceTimestamp(raw: string): { value: number | null; invalid: boolean } {
  if (raw === '') return { value: null, invalid: false };
  if (typeof raw !== 'string') return { value: null, invalid: true };
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(raw);
  if (!match || !validCalendarDate(Number(match[1]), Number(match[2]), Number(match[3])) || Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59 || (match[8] !== undefined && (Number(match[8]) > 23 || Number(match[9]) > 59))) return { value: null, invalid: true };
  const value = Date.parse(raw);
  return Number.isFinite(value) ? { value, invalid: false } : { value: null, invalid: true };
}

function timestampRank(source: Pick<AriveStructuredNoteSource, 'createdAt' | 'updatedAt'>): TimestampRank {
  const created = sourceTimestamp(source.createdAt);
  const updated = sourceTimestamp(source.updatedAt);
  return {
    effective: updated.value ?? created.value ?? 0,
    created: created.value ?? 0,
    invalid: created.invalid || updated.invalid || (created.value === null && updated.value === null),
  };
}

function compareText(a: string, b: string): number { return a === b ? 0 : a > b ? 1 : -1; }
function compareIds(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const left = a.replace(/^0+(?=\d)/, '');
    const right = b.replace(/^0+(?=\d)/, '');
    return left.length - right.length || compareText(left, right) || compareText(a, b);
  }
  return compareText(a, b);
}
function compareSources(a: AriveStructuredNoteSource, b: AriveStructuredNoteSource, includeSection = true): number {
  const left = timestampRank(a);
  const right = timestampRank(b);
  return left.effective - right.effective || left.created - right.created || compareIds(a.noteId, b.noteId) || (includeSection ? a.sectionIndex - b.sectionIndex : 0);
}
function stableSourceTie(a: AriveStructuredNoteSource, b: AriveStructuredNoteSource): number {
  return compareText(a.sectionText, b.sectionText) || compareText(a.rawText, b.rawText) || compareText(a.author, b.author) || compareText(a.createdAt, b.createdAt) || compareText(a.updatedAt, b.updatedAt) || compareText(a.parentNoteId || '', b.parentNoteId || '');
}

function collectCandidates(notes: readonly AriveNote[]): { candidates: Candidate[]; noteIds: Set<string> } {
  const candidates: Candidate[] = [];
  const noteIds = new Set<string>();
  const pending = notes.map(note => ({ note, parentNoteId: null as string | null }));
  const seen = new Set<AriveNote>();
  while (pending.length) {
    const { note, parentNoteId } = pending.pop()!;
    if (seen.has(note)) continue;
    seen.add(note);
    noteIds.add(note.id);
    for (const reply of note.replies) pending.push({ note: reply, parentNoteId: note.id });
    const rank = timestampRank(note);
    let current: { field: AriveStructuredNoteKey; lines: string[]; index: number } | null = null;
    let sectionIndex = 0;
    function finishSection() {
      if (!current) return;
      candidates.push({
        field: current.field,
        invalidTimestamp: rank.invalid,
        source: {
          noteId: note.id, parentNoteId, author: note.author,
          createdAt: note.createdAt, updatedAt: note.updatedAt,
          effectiveAt: rank.invalid ? null : new Date(rank.effective).toISOString(),
          sectionIndex: current.index, rawText: note.text, sectionText: current.lines.join('\n').trim(),
        },
      });
    }
    for (const line of ariveNotePlainText(note.text).split('\n')) {
      const match = sectionHeader.exec(line);
      if (match) {
        finishSection();
        current = { field: headers[match[1].toLowerCase().replace(/[\t ]+/g, ' ')], lines: [match[2]], index: sectionIndex++ };
      } else if (current) current.lines.push(line);
    }
    finishSection();
  }
  return { candidates, noteIds };
}

/**
 * Parse a complete, successfully fetched note snapshot. Do not call with partial/error results.
 * `previous` must contain the last successfully applied SET/CLEAR source per field, never a
 * KEEP/error candidate. Removed or invalid instructions cannot clear values or revive older notes.
 */
export function parseAriveStructuredNotes(
  notes: readonly AriveNote[],
  previous: Partial<Record<AriveStructuredNoteKey, AriveStructuredNoteSource>> = {},
): AriveStructuredNoteResult {
  const { candidates, noteIds } = collectCandidates(notes);
  const fields = {} as Record<AriveStructuredNoteKey, AriveStructuredNoteField>;
  const issues: AriveStructuredNoteIssue[] = [];
  for (const field of ARIVE_STRUCTURED_NOTE_KEYS) {
    const relevant = candidates.filter(candidate => candidate.field === field);
    // Invalid source timestamps cannot be silently treated as old records and discarded.
    const invalid = relevant.filter(candidate => candidate.invalidTimestamp).sort((a, b) => compareIds(b.source.noteId, a.source.noteId) || b.source.sectionIndex - a.source.sectionIndex || stableSourceTie(a.source, b.source))[0];
    relevant.sort((a, b) => compareSources(b.source, a.source) || stableSourceTie(a.source, b.source));
    const newest = relevant[0];
    const prior = previous[field];
    const keep = (source: AriveStructuredNoteSource | null, issue: AriveStructuredNoteIssueCode | null = null, reason?: AriveStructuredNoteRemovalReason) => {
      fields[field] = { action: 'KEEP', value: null, source, issue, ...(reason ? { reason } : {}) };
      if (issue && source) issues.push({ field, code: issue, source, ...(reason ? { reason } : {}) });
    };
    if (invalid) { keep(invalid.source, 'INVALID_SOURCE_TIMESTAMP'); continue; }
    if (prior && timestampRank(prior).invalid) { keep(prior, 'INVALID_SOURCE_TIMESTAMP'); continue; }
    const priorSectionPresent = prior && relevant.some(candidate => candidate.source.noteId === prior.noteId);
    if (prior && !priorSectionPresent && (!newest || compareSources(newest.source, prior, false) <= 0)) {
      keep(prior, 'SOURCE_REMOVED', noteIds.has(prior.noteId) ? 'HEADER_REMOVED' : 'NOTE_DELETED'); continue;
    }
    if (!newest) { keep(null); continue; }
    if (prior && compareSources(newest.source, prior, false) < 0) { keep(prior, 'SOURCE_REGRESSED'); continue; }
    if (relevant.some(candidate => compareSources(candidate.source, newest.source) === 0 && candidate.source.sectionText !== newest.source.sectionText)) {
      keep(newest.source, 'CONFLICTING_SOURCE'); continue;
    }
    const value = newest.source.sectionText;
    if (!value) { keep(newest.source, 'EMPTY_SECTION'); continue; }
    if (value.length > MAX_SECTION_LENGTH) { keep(newest.source, 'VALUE_TOO_LONG'); continue; }
    if (/^(clear|none)$/i.test(value)) {
      fields[field] = { action: 'CLEAR', value: null, source: newest.source, issue: null }; continue;
    }
    if (dateFields.has(field)) {
      const date = normalizedDate(value);
      if (!date) { keep(newest.source, 'INVALID_DATE'); continue; }
      fields[field] = { action: 'SET', value: date, source: newest.source, issue: null };
    } else fields[field] = { action: 'SET', value, source: newest.source, issue: null };
  }
  return { fields, issues };
}
