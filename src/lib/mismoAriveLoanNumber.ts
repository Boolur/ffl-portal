export type MismoLoanIdentifier = {
  type: string;
  otherDescription?: string;
  value: string;
};

type MismoAriveLoanNumberInput = {
  identifiers: readonly MismoLoanIdentifier[];
  losIdentifiers?: readonly string[];
  sourceFilename?: string;
};

const normalizedType = (value: string) => value.trim().replace(/[\s_-]+/g, '').toLowerCase();

function explicitlyIdentifiesLos(identifier: MismoLoanIdentifier): boolean {
  const type = normalizedType(identifier.type);
  if (type === 'loanoriginationsystem' || type === 'loanoriginationsystemloanidentifier' || type === 'los') return true;
  if (type !== 'other') return false;
  // UniversalLoan and LenderLoan identify different numbering systems. Only
  // an explicit LOS/Arive description makes an Other identifier trustworthy.
  return /(?:^|[^a-z0-9])(?:arive|arrive|lwloan|los)(?=$|[^a-z0-9]|loan|id|number)|loan\s*origination\s*system/i.test(identifier.otherDescription || '');
}

function isTimestamp(value: string): boolean {
  if (!/^\d{13}$/.test(value)) return false;
  const milliseconds = Number(value);
  // Timestamp-shaped values need manual confirmation. Do not infer a loan
  // number from dates close to an upload or import operation.
  return milliseconds >= Date.UTC(2000, 0, 1) && milliseconds < Date.UTC(2100, 0, 1);
}

function validXmlNumber(value: string): boolean {
  return /^\d{1,15}$/.test(value) && !isTimestamp(value);
}

export function validMismoFilenameNumber(value: string): boolean {
  if (!/^\d{6,9}$/.test(value) || isTimestamp(value)) return false;
  // A plain date in a filename is not enough evidence of an Arive ID.
  const validDate = (year: number, month: number, day: number) => {
    if (year < 1900 || year > 2099) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  };
  if (value.length === 8) {
    const first = Number(value.slice(0, 2)); const second = Number(value.slice(2, 4)); const trailingYear = Number(value.slice(4));
    if (validDate(Number(value.slice(0, 4)), Number(value.slice(4, 6)), Number(value.slice(6)))
      || validDate(trailingYear, first, second) || validDate(trailingYear, second, first)) return false;
  }
  return true;
}

/** Select an import suggestion, not a verified API match. An empty result
 * leaves the existing required Arive field for the Loan Officer to complete. */
export function selectMismoAriveLoanNumber(input: MismoAriveLoanNumberInput): string {
  const typed = [
    ...input.identifiers.filter(explicitlyIdentifiesLos).map(identifier => identifier.value.trim()),
    ...(input.losIdentifiers || []).map(value => value.trim()),
  ].filter(Boolean);
  if (typed.length) {
    // Neither a filename nor another valid candidate may hide conflicting or
    // malformed explicit XML identity. Preserve string IDs, including zeros.
    if (typed.some(value => !validXmlNumber(value))) return '';
    const distinct = new Set(typed);
    return distinct.size === 1 ? typed[0] : '';
  }

  const blocked = new Set(input.identifiers
    .filter(identifier => ['universalloan', 'lenderloan'].includes(normalizedType(identifier.type)))
    .map(identifier => identifier.value.trim()).filter(Boolean));
  const filename = input.sourceFilename?.split(/[\\/]/).at(-1) || '';
  const stem = filename.replace(/\.[^/.]+$/, '');
  if (!stem) return '';

  const labeled = [...stem.matchAll(/(?:^|[^a-z0-9])(?:arive|arrive)[\s._-]*(?:loan[\s._-]*)?(?:(?:number|no|id)[\s._#:-]*)?[\s._#:-]*(\d+)(?=$|[^a-z0-9])/gi)]
    .map(match => match[1]);
  if (labeled.length) {
    if (labeled.some(value => !validMismoFilenameNumber(value) || blocked.has(value))) return '';
    return new Set(labeled).size === 1 ? labeled[0] : '';
  }

  // Unlabelled fallback is deliberately narrow: a single plausible number in
  // a simple MISMO/export filename. Borrower names, lender labels, dates,
  // multiple number tokens and opaque numeric strings require manual input.
  const numericRuns = stem.match(/\d+/g) || [];
  if (numericRuns.length !== 1) return '';
  const value = numericRuns[0];
  const labels = stem.replace(value, '').replace(/[\s._()-]+/g, ' ').trim().split(/\s+/)
    .filter(label => !['', 'mismo', 'export', 'xml', 'loan'].includes(label.toLowerCase())).join('');
  return !labels && validMismoFilenameNumber(value) && !blocked.has(value) ? value : '';
}
