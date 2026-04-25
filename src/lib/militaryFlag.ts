/**
 * Normalization helpers for the portal's `Lead.isMilitary` column.
 *
 * Vendors (and Lead Mailbox passthroughs) post the military/veteran flag in
 * a frustrating variety of shapes — `"True"`, `"true"`, `"Yes"`, `"yes"`,
 * `"Y"`, `"1"`, `"No"`, `"False"`, `"N"`, `"0"`, `""`, `null`, `undefined`,
 * sometimes even numeric `1`/`0` or boolean `true`/`false`. Downstream
 * Bonzo campaign triggers break silently when the comparator expects a
 * specific form, so we collapse every input to a canonical `"Yes"`/`"No"`
 * (or `null` when truly absent) at ingest time and again at push time.
 *
 * Keep this file free of React / Prisma imports so it can run in:
 *   - the vendor webhook route (Node runtime)
 *   - the Lead Mailbox bridge route
 *   - the CSV import server actions
 *   - the Bonzo forwarder + dispatcher
 *   - the template engine (computed virtual fields)
 */

export type MilitaryFlag = 'Yes' | 'No';

const YES_TOKENS = new Set([
  'yes',
  'y',
  'true',
  't',
  '1',
  'military',
  'veteran',
  'active',
  'retired',
  'reserves',
  'reserve',
  'guard',
]);

const NO_TOKENS = new Set([
  'no',
  'n',
  'false',
  'f',
  '0',
  'none',
  'civilian',
  'not military',
  'non-military',
  'nonmilitary',
]);

/**
 * Canonicalize a free-form military/veteran value to `"Yes"`, `"No"`, or
 * `null`. Unknown strings (e.g. a typo or a vendor using "maybe") fall
 * through to `null` so we don't guess on ambiguous input — `null` leaves
 * `lead.isMilitary` unchanged upstream, which is safer than flipping a
 * VA campaign's trigger based on a junk value.
 */
export function normalizeMilitaryFlag(value: unknown): MilitaryFlag | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value === 0 ? 'No' : 'Yes';
  }
  const str = String(value).trim().toLowerCase();
  if (str.length === 0) return null;
  if (YES_TOKENS.has(str)) return 'Yes';
  if (NO_TOKENS.has(str)) return 'No';
  return null;
}

/**
 * Collapses `normalizeMilitaryFlag` output to a real JS boolean or `null`.
 * Used by the Bonzo forwarder so Bonzo's native `veteran` field gets a
 * proper boolean instead of a string.
 */
export function normalizeMilitaryFlagToBool(value: unknown): boolean | null {
  const flag = normalizeMilitaryFlag(value);
  if (flag === 'Yes') return true;
  if (flag === 'No') return false;
  return null;
}

/**
 * Resolves a "Yes"/"No"/null value from two candidate fields (primary,
 * fallback). Empty strings count as absent — JS's `??` alone wouldn't
 * fall through on `""`, which is the exact bug Lead Mailbox triggered
 * when its `{Ismilitary}` token substituted to an empty string.
 */
export function coalesceMilitaryFlag(
  primary: unknown,
  fallback: unknown
): MilitaryFlag | null {
  const a = normalizeMilitaryFlag(primary);
  if (a !== null) return a;
  return normalizeMilitaryFlag(fallback);
}
