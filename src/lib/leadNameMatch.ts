/**
 * Shared helpers for matching a free-text "User Name" field (as it appears
 * in a Lead Mailbox CSV export) to a portal user. Runs on both client (CSV
 * upload review step) and server (bulkCreateLeadsBatch) so the match logic
 * must be deterministic and not touch any browser-only APIs.
 */

/**
 * Canonicalizes a raw name so two strings that should match — e.g.
 * "John  Smith  ", "john smith", "Smith, John" — all collapse to the same
 * key. Rules:
 *  - trim + collapse internal whitespace to single spaces
 *  - lowercase
 *  - swap `Last, First` into `First Last` (commonly exported by CRMs)
 *  - strip punctuation other than letters/digits/space
 */
export function normalizeUserName(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw).trim();
  if (!s) return '';

  // "Smith, John" -> "John Smith"
  const comma = s.indexOf(',');
  if (comma > 0 && comma < s.length - 1) {
    const last = s.slice(0, comma).trim();
    const first = s.slice(comma + 1).trim();
    if (last && first && !first.includes(',')) {
      s = `${first} ${last}`;
    }
  }

  s = s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return s;
}

export type NameIndexUser = {
  id: string;
  name: string;
  email: string;
};

export type NameMatchKind = 'exact_name' | 'exact_email' | 'none' | 'ambiguous';

export type NameMatch = {
  kind: NameMatchKind;
  userId: string | null;
  candidateIds?: string[];
};

/**
 * Build a lookup index from a user list. Maps normalized names to user ids
 * (one-to-many because two portal users can share the same display name)
 * plus a normalized email map for fallback matching.
 */
export function buildNameIndex(users: NameIndexUser[]) {
  const byName = new Map<string, string[]>();
  const byEmail = new Map<string, string>();

  for (const u of users) {
    const nk = normalizeUserName(u.name);
    if (nk) {
      const bucket = byName.get(nk);
      if (bucket) bucket.push(u.id);
      else byName.set(nk, [u.id]);
    }
    const ek = u.email?.trim().toLowerCase();
    if (ek) byEmail.set(ek, u.id);
  }

  return { byName, byEmail };
}

/**
 * Attempt to resolve a CSV "User Name" value (and optionally an email) to a
 * single user id. Returns `ambiguous` when multiple portal users share the
 * same normalized name so the UI can force the admin to disambiguate.
 */
export function matchUser(
  index: ReturnType<typeof buildNameIndex>,
  rawName: string | null | undefined,
  rawEmail?: string | null | undefined
): NameMatch {
  const email = rawEmail?.trim().toLowerCase();
  if (email) {
    const id = index.byEmail.get(email);
    if (id) return { kind: 'exact_email', userId: id };
  }
  const nk = normalizeUserName(rawName);
  if (!nk) return { kind: 'none', userId: null };
  const ids = index.byName.get(nk);
  if (!ids || ids.length === 0) return { kind: 'none', userId: null };
  if (ids.length === 1) return { kind: 'exact_name', userId: ids[0] };
  return { kind: 'ambiguous', userId: null, candidateIds: ids };
}
