/**
 * Template engine for Integration Service URL / body / header templates.
 *
 * Admins write templates using merge fields pulled from the lead, its
 * assigned user, the campaign, vendor, and per-user credentials the admin
 * defined on the service. Two syntaxes are accepted so that payloads
 * copy-pasted from Lead Mailbox keep working unchanged:
 *
 *   - Lead Mailbox style single-brace tokens:      `{firstname}`
 *   - Handlebars-ish double-brace tokens:          `{{lead.firstName}}`
 *
 * Missing values resolve to empty strings (never "undefined") so a half-
 * filled lead won't produce garbage HTTP bodies. Callers that need to know
 * whether every token resolved can pass `{ track: true }` and inspect the
 * `unresolved` list on the returned object.
 */

import type { Lead, User, LeadCampaign, LeadVendor } from '@prisma/client';
import { coalesceMilitaryFlag } from '@/lib/militaryFlag';

// ---------------------------------------------------------------------------
// Context shapes
// ---------------------------------------------------------------------------

export type TemplateLead = Lead;

export type TemplateUser = Pick<
  User,
  'id' | 'name' | 'email'
> & {
  credentials?: Record<string, string | null | undefined>;
  // Any additional user-side profile fields we want to surface as merge
  // tokens live here (e.g. NMLS license id, phone, bonzo url). We read
  // these off UserLeadQuota for now; the dispatcher is free to supply
  // more keys later without the template engine changing.
  profile?: Record<string, string | null | undefined>;
};

export type TemplateCampaign = Pick<
  LeadCampaign,
  'id' | 'name' | 'routingTag'
>;

export type TemplateVendor = Pick<LeadVendor, 'id' | 'name' | 'slug'>;

export type TemplateContext = {
  lead: TemplateLead;
  user: TemplateUser | null;
  campaign: TemplateCampaign | null;
  vendor: TemplateVendor;
  now: Date;
};

export type RenderOptions = {
  /**
   * When true, record unresolved tokens in the result so the dispatcher can
   * warn admins about dead merge fields. Defaults to false (hot path).
   */
  track?: boolean;
};

export type RenderResult = {
  output: string;
  unresolved: string[];
};

// ---------------------------------------------------------------------------
// Lead Mailbox backward-compat aliases
//
// These are the placeholders baked into the 57-service Lead Mailbox reference
// doc (docs/lead-mailbox-service-setup.md, section 1). Admins who paste the
// existing JSON template into the portal shouldn't have to rewrite any
// tokens — the alias table maps the LMB token (case-insensitive) directly
// onto the portal's canonical path.
// ---------------------------------------------------------------------------

const LMB_ALIASES: Record<string, string> = {
  // Identity
  leadid: 'lead.id',
  lead_id: 'lead.id',
  user_002: 'lead.vendorUserId',

  // Borrower contact
  firstname: 'lead.firstName',
  lastname: 'lead.lastName',
  email: 'lead.email',
  phone: 'lead.phone',
  phonenumeric: 'lead.phone',
  homephone: 'lead.homePhone',
  workphone: 'lead.workPhone',
  dob: 'lead.dob',
  social: 'lead.ssn',
  ssn: 'lead.ssn',

  // Mailing address
  mail_address: 'lead.mailingAddress',
  mail_city: 'lead.mailingCity',
  mail_state: 'lead.mailingState',
  mail_zip: 'lead.mailingZip',

  // Property address
  phys_address: 'lead.propertyAddress',
  phys_city: 'lead.propertyCity',
  phys_state: 'lead.propertyState',
  phys_zip: 'lead.propertyZip',
  phys_county: 'lead.propertyCounty',
  'property address': 'lead.propertyAddress',
  'property city': 'lead.propertyCity',
  'property state': 'lead.propertyState',
  'property zip': 'lead.propertyZip',
  'property county': 'lead.propertyCounty',

  // Property details (LMB used space-separated names)
  'property value': 'lead.propertyValue',
  'property type': 'lead.propertyType',
  'property use': 'lead.propertyUse',
  'purchase price': 'lead.purchasePrice',
  field_011: 'lead.propertyLtv',
  field_037: 'lead.loanRate',

  // Loan
  'loan purpose': 'lead.loanPurpose',
  'loan amount': 'lead.loanAmount',
  'loan term': 'lead.loanTerm',
  'loan type': 'lead.loanType',
  'down payment': 'lead.downPayment',
  'cash out': 'lead.cashOut',
  'credit rating': 'lead.creditRating',
  'current balance': 'lead.currentBalance',
  'current payment': 'lead.currentPayment',
  'current rate': 'lead.currentRate',

  // Employment / flags
  employer: 'lead.employer',
  bankruptcy: 'lead.bankruptcy',
  foreclosure: 'lead.foreclosure',
  ismilitary: 'lead.isMilitary',
  veteran: 'lead.vaStatus',

  // Co-borrower
  cofirstname: 'lead.coFirstName',
  colastname: 'lead.coLastName',
  coemail: 'lead.coEmail',
  cophone: 'lead.coPhone',
  cohomephone: 'lead.coHomePhone',
  coworkphone: 'lead.coWorkPhone',
  codob: 'lead.coDob',

  // Metadata / dates
  createddash: 'now.date',
  createdat: 'lead.createdAt',
  receivedat: 'lead.receivedAt',

  // Campaign / vendor breadcrumbs
  campaign_name: 'campaign.name',
  routing_tag: 'campaign.routingTag',
  vendor_name: 'vendor.name',

  // Assigned LO breadcrumbs (LMB calls these `User_*`)
  user_name: 'user.name',
  user_email: 'user.email',
  user_phone: 'user.profile.phone',
  user_license: 'user.profile.license',
  lastnote: 'lead.lastNote',
};

// ---------------------------------------------------------------------------
// Available-tokens registry (for the admin "Insert merge field" menu)
// ---------------------------------------------------------------------------

export type TokenSpec = {
  token: string;
  group: 'Lead' | 'User' | 'Campaign' | 'Vendor' | 'Date' | 'Credentials';
  description: string;
};

const LEAD_FIELD_TOKENS: ReadonlyArray<{ key: keyof Lead; desc: string }> = [
  { key: 'id', desc: 'Portal lead ID' },
  { key: 'vendorLeadId', desc: 'Upstream vendor lead ID (e.g. LMB LeadID)' },
  { key: 'vendorUserId', desc: 'Upstream vendor user ID' },
  { key: 'firstName', desc: 'Borrower first name' },
  { key: 'lastName', desc: 'Borrower last name' },
  { key: 'email', desc: 'Borrower email' },
  { key: 'phone', desc: 'Borrower phone' },
  { key: 'homePhone', desc: 'Borrower home phone' },
  { key: 'workPhone', desc: 'Borrower work phone' },
  { key: 'dob', desc: 'Borrower date of birth' },
  { key: 'ssn', desc: 'Borrower SSN' },
  { key: 'coFirstName', desc: 'Co-borrower first name' },
  { key: 'coLastName', desc: 'Co-borrower last name' },
  { key: 'coEmail', desc: 'Co-borrower email' },
  { key: 'coPhone', desc: 'Co-borrower phone' },
  { key: 'coDob', desc: 'Co-borrower date of birth' },
  { key: 'mailingAddress', desc: 'Mailing street' },
  { key: 'mailingCity', desc: 'Mailing city' },
  { key: 'mailingState', desc: 'Mailing state' },
  { key: 'mailingZip', desc: 'Mailing zip' },
  { key: 'propertyAddress', desc: 'Subject property street' },
  { key: 'propertyCity', desc: 'Subject property city' },
  { key: 'propertyState', desc: 'Subject property state' },
  { key: 'propertyZip', desc: 'Subject property zip' },
  { key: 'propertyCounty', desc: 'Subject property county' },
  { key: 'propertyValue', desc: 'Estimated property value' },
  { key: 'propertyType', desc: 'Property type' },
  { key: 'propertyUse', desc: 'Property use' },
  { key: 'propertyLtv', desc: 'LTV %' },
  { key: 'purchasePrice', desc: 'Purchase price' },
  { key: 'loanPurpose', desc: 'Loan purpose' },
  { key: 'loanAmount', desc: 'Requested loan amount' },
  { key: 'loanType', desc: 'Loan type' },
  { key: 'loanTerm', desc: 'Loan term / program' },
  { key: 'loanRate', desc: 'Quoted rate' },
  { key: 'downPayment', desc: 'Down payment' },
  { key: 'cashOut', desc: 'Cash-out amount' },
  { key: 'creditRating', desc: 'Self-reported credit rating' },
  { key: 'currentBalance', desc: 'Current mortgage balance' },
  { key: 'currentRate', desc: 'Current interest rate' },
  { key: 'currentPayment', desc: 'Current mortgage payment' },
  { key: 'employer', desc: 'Borrower employer' },
  { key: 'jobTitle', desc: 'Borrower job title' },
  { key: 'income', desc: 'Borrower income' },
  { key: 'bankruptcy', desc: 'Bankruptcy flag / details' },
  { key: 'foreclosure', desc: 'Foreclosure flag / details' },
  { key: 'isMilitary', desc: 'Military yes/no (normalized: "Yes" / "No")' },
  { key: 'vaStatus', desc: 'VA / veteran status' },
  { key: 'status', desc: 'Portal lead status (NEW, CONTACTED, ...)' },
  { key: 'assignedUserId', desc: 'Assigned LO user id (internal)' },
  { key: 'receivedAt', desc: 'Timestamp portal received the lead (ISO)' },
];

const USER_TOKENS: ReadonlyArray<{ path: string; desc: string }> = [
  { path: 'user.name', desc: 'Assigned LO full name' },
  { path: 'user.email', desc: 'Assigned LO email' },
  { path: 'user.id', desc: 'Assigned LO user id' },
];

const DATE_TOKENS: ReadonlyArray<{ path: string; desc: string }> = [
  { path: 'now.date', desc: 'Today (YYYY-MM-DD, UTC)' },
  { path: 'now.iso', desc: 'Right now (ISO 8601, UTC)' },
  { path: 'now.unix', desc: 'Right now (Unix epoch seconds)' },
];

/**
 * Lists every merge field the admin editor should expose in the "Insert
 * merge field" picker. Credential fields are appended by the caller once
 * the service's IntegrationServiceCredentialField rows are known.
 */
// Computed virtual lead fields (resolved in readFromLead above, not present
// on the Prisma Lead model). Surfaced separately from the generated list so
// admins can see them in the merge-field picker without us having to widen
// the `keyof Lead` constraint.
const LEAD_COMPUTED_TOKENS: ReadonlyArray<{ key: string; desc: string }> = [
  { key: 'fullName', desc: 'Borrower full name ("First Last")' },
  {
    key: 'veteranBool',
    desc:
      'Veteran as a JSON literal (true/false/null) — use UNQUOTED in a JSON body, e.g. "veteran": {{lead.veteranBool}}',
  },
  {
    key: 'veteranYesNo',
    desc:
      'Veteran as a "Yes"/"No" string (falls back to vaStatus, empty if unknown)',
  },
];

export function listAvailableTokens(
  extras: { credentialKeys?: string[] } = {}
): TokenSpec[] {
  const leadTokens: TokenSpec[] = LEAD_FIELD_TOKENS.map((f) => ({
    token: `{{lead.${String(f.key)}}}`,
    group: 'Lead',
    description: f.desc,
  }));
  const leadComputedTokens: TokenSpec[] = LEAD_COMPUTED_TOKENS.map((f) => ({
    token: `{{lead.${f.key}}}`,
    group: 'Lead',
    description: f.desc,
  }));
  const userTokens: TokenSpec[] = USER_TOKENS.map((u) => ({
    token: `{{${u.path}}}`,
    group: 'User',
    description: u.desc,
  }));
  const campaignTokens: TokenSpec[] = [
    { token: '{{campaign.name}}', group: 'Campaign', description: 'Campaign name' },
    { token: '{{campaign.routingTag}}', group: 'Campaign', description: 'Campaign routing tag' },
  ];
  const vendorTokens: TokenSpec[] = [
    { token: '{{vendor.name}}', group: 'Vendor', description: 'Vendor name' },
    { token: '{{vendor.slug}}', group: 'Vendor', description: 'Vendor slug' },
  ];
  const dateTokens: TokenSpec[] = DATE_TOKENS.map((d) => ({
    token: `{{${d.path}}}`,
    group: 'Date',
    description: d.desc,
  }));
  const credentialTokens: TokenSpec[] =
    extras.credentialKeys?.map((k) => ({
      token: `{{user.credentials.${k}}}`,
      group: 'Credentials',
      description: `Per-user credential "${k}"`,
    })) ?? [];

  return [
    ...leadTokens,
    ...leadComputedTokens,
    ...userTokens,
    ...credentialTokens,
    ...campaignTokens,
    ...vendorTokens,
    ...dateTokens,
  ];
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Case-insensitive path lookup for the LMB aliases. Returns the canonical
 * dotted path or the input unchanged if it doesn't match an alias.
 */
function normalizePath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  // Already a canonical dotted path: keep as-is.
  if (/^[a-z][a-zA-Z0-9_]*\./.test(trimmed)) {
    return trimmed;
  }
  const key = trimmed.toLowerCase();
  return LMB_ALIASES[key] ?? trimmed;
}

function nowFragment(d: Date, leaf: string | undefined): string {
  switch ((leaf ?? '').toLowerCase()) {
    case 'iso':
    case '':
      return d.toISOString();
    case 'unix':
      return Math.floor(d.getTime() / 1000).toString();
    case 'date': {
      const y = d.getUTCFullYear();
      const m = String(d.getUTCMonth() + 1).padStart(2, '0');
      const day = String(d.getUTCDate()).padStart(2, '0');
      return `${y}-${m}-${day}`;
    }
    default:
      return '';
  }
}

/**
 * Walks the dotted path against the context. Missing paths resolve to
 * an empty string. `null`/`undefined` field values also resolve to '' so
 * admins never see the string "null" in an outbound payload.
 */
function resolvePath(path: string, ctx: TemplateContext): string {
  if (!path) return '';
  const segments = path.split('.').map((s) => s.trim()).filter(Boolean);
  if (segments.length === 0) return '';

  const [head, ...rest] = segments;
  switch (head) {
    case 'lead':
      return stringifyLeaf(readFromLead(rest, ctx.lead));
    case 'user':
      return stringifyLeaf(readFromUser(rest, ctx.user));
    case 'campaign':
      return stringifyLeaf(readFromCampaign(rest, ctx.campaign));
    case 'vendor':
      return stringifyLeaf(readFromVendor(rest, ctx.vendor));
    case 'now':
      return nowFragment(ctx.now, rest[0]);
    default:
      return '';
  }
}

function readFromLead(path: string[], lead: TemplateLead): unknown {
  if (path.length === 0) return '';
  const [key] = path;
  if (key === 'fullName') {
    return [lead.firstName, lead.lastName].filter(Boolean).join(' ');
  }
  if (key === 'ageDays') {
    const ms = Date.now() - lead.receivedAt.getTime();
    return Math.max(0, Math.floor(ms / 86_400_000)).toString();
  }
  if (key === 'lastNote') {
    return '';
  }
  // Computed veteran/military tokens. These let Bonzo body templates emit
  // a real JSON literal (`true`/`false`/`null`) instead of a string, which
  // is required for Bonzo-native veteran campaign triggers that check
  // `veteran == true`. Stored `lead.isMilitary` is already normalized at
  // ingest, but we defer to `coalesceMilitaryFlag` here so the fallback to
  // `vaStatus` also fires when the lead only has VA eligibility set.
  //
  // Usage in an admin's body template (note the *missing* quotes so the
  // rendered value becomes a JSON literal):
  //     "veteran": {{lead.veteranBool}},        // -> true / false / null
  //     "custom_veteran": "{{lead.veteranYesNo}}"   // -> "Yes" / "No" / ""
  if (key === 'veteranBool') {
    const flag = coalesceMilitaryFlag(lead.isMilitary, lead.vaStatus);
    if (flag === 'Yes') return 'true';
    if (flag === 'No') return 'false';
    return 'null';
  }
  if (key === 'veteranYesNo') {
    const flag = coalesceMilitaryFlag(lead.isMilitary, lead.vaStatus);
    return flag ?? '';
  }
  if (key === 'receivedAt' || key === 'createdAt' || key === 'updatedAt' || key === 'assignedAt') {
    const val = (lead as unknown as Record<string, unknown>)[key];
    return val instanceof Date ? val.toISOString() : val;
  }
  return (lead as unknown as Record<string, unknown>)[key];
}

function readFromUser(path: string[], user: TemplateUser | null): unknown {
  if (!user) return '';
  if (path.length === 0) return '';
  const [head, ...rest] = path;
  if (head === 'credentials') {
    const credKey = rest[0];
    if (!credKey) return '';
    return user.credentials?.[credKey];
  }
  if (head === 'profile') {
    const profKey = rest[0];
    if (!profKey) return '';
    return user.profile?.[profKey];
  }
  return (user as unknown as Record<string, unknown>)[head];
}

function readFromCampaign(path: string[], campaign: TemplateCampaign | null): unknown {
  if (!campaign) return '';
  const [key] = path;
  if (!key) return '';
  return (campaign as unknown as Record<string, unknown>)[key];
}

function readFromVendor(path: string[], vendor: TemplateVendor): unknown {
  const [key] = path;
  if (!key) return '';
  return (vendor as unknown as Record<string, unknown>)[key];
}

function stringifyLeaf(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') {
    return String(v);
  }
  if (v instanceof Date) return v.toISOString();
  try {
    return JSON.stringify(v);
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Match `{{ foo.bar }}` (greedy-safe because we disallow `{` in the body) OR
// a single-brace `{ foo_bar }` token. Single-brace is kept permissive to
// match LMB's own token style but ignores JSON-looking content by requiring
// the contents to look like a token (letters/digits/underscore/dot/space).
//
// Order matters: match the double-brace form first so `{{foo}}` doesn't get
// chewed up as two `{...}` tokens with a stray pair of braces.
const DOUBLE_BRACE_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const SINGLE_BRACE_RE = /\{\s*([a-zA-Z_][a-zA-Z0-9_\. ]*)\s*\}/g;

/**
 * Resolves every `{token}` and `{{token}}` in `template` against `ctx`.
 * Unknown tokens render as empty strings.
 *
 * Exposed as the main entry point for the dispatcher (URLs, headers, body,
 * success-string comparisons).
 */
export function render(
  template: string,
  ctx: TemplateContext,
  opts: RenderOptions = {}
): RenderResult {
  const unresolved: string[] = [];
  const seen = new Set<string>();

  const replaceOne = (rawToken: string): string => {
    const path = normalizePath(rawToken);
    const value = resolvePath(path, ctx);
    if (opts.track && value === '' && !seen.has(rawToken)) {
      seen.add(rawToken);
      // Best-effort heuristic: the token is "unresolved" if the *path* had
      // no root the resolver knows about OR the leaf was absent. We don't
      // try to distinguish "real empty" from "missing" here — admins just
      // want the list of suspicious tokens, not an exact type signal.
      const rootOk =
        /^lead\./.test(path) ||
        /^user\./.test(path) ||
        /^campaign\./.test(path) ||
        /^vendor\./.test(path) ||
        /^now\b/.test(path);
      if (!rootOk) unresolved.push(rawToken);
    }
    return value;
  };

  const step1 = template.replace(DOUBLE_BRACE_RE, (_m, inner: string) =>
    replaceOne(inner)
  );
  const output = step1.replace(SINGLE_BRACE_RE, (match, inner: string) => {
    // Don't touch JSON object literals like `{}`  — the inner must be a
    // plausible token (contain a letter and no invalid chars). The regex
    // already guarantees this, but we also guard against accidentally
    // substituting the empty string into what was originally a literal
    // brace pair.
    const replaced = replaceOne(inner);
    return replaced !== '' ? replaced : match === `{${inner.trim()}}` ? '' : match;
  });

  return { output, unresolved };
}

/**
 * Convenience wrapper that returns just the rendered string; used by
 * callers that don't care about tracking.
 */
export function renderString(template: string, ctx: TemplateContext): string {
  return render(template, ctx).output;
}
