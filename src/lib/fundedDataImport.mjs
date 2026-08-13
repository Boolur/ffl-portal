import readXlsxFile from 'read-excel-file/node';

export const FUNDED_IMPORT_SOURCE = 'Funded Data.xlsx';

const REQUIRED_HEADERS = [
  'loanofficer',
  'assigned',
  'arrive',
  'borrower',
  'leadsource',
  'state',
  'loantype',
  'lender',
  'senior',
  'fundeddate',
  'finalrevenue',
];

const OFFICER_ALIASES = new Map([
  ['arash agahi', 'Adam Agahi'],
  ['spencer simmons', 'Sarah Behl'],
  ['julian reisch', 'Nick Yebisu'],
  ['jay dearing', 'Nick Yebisu'],
  ['zoe gannam', 'Nick Yebisu'],
  ['zoe ganam', 'Nick Yebisu'],
  ['zo gannam', 'Nick Yebisu'],
  ['tarek gossein', 'Nick Yebisu'],
  ['tarek old file', 'Nick Yebisu'],
  ['sarun van rijsbergen', 'Nick Yebisu'],
  ['ryan hayward', 'Nick Yebisu'],
  ['ryan haward', 'Nick Yebisu'],
  ['ghadi dib', 'Nick Yebisu'],
  ['john heard', 'Nick Yebisu'],
]);

function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function aliasKey(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeHeader(value) {
  return aliasKey(value);
}

export function normalizeAriveNumber(value) {
  const text = cleanText(value).replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();
  return /^\d{8}$/.test(text) ? text : null;
}

export function resolveFundedOfficerName(value) {
  const cleaned = cleanText(value);
  return OFFICER_ALIASES.get(cleaned.toLowerCase()) || cleaned;
}

export function canonicalLender(value) {
  const cleaned = cleanText(value);
  const key = aliasKey(cleaned);
  if (key === 'figure') return 'FIGURE';
  if (key === 'kind') return 'KIND';
  if (key === 'uwm') return 'UWM';
  if (key === 'nfty' || key === 'nifty') return 'NFTY';
  if (key === 'nftyfigure') return 'NFTY/Figure';
  if (key === 'sunwest') return 'Sun West';
  return cleaned;
}

export function canonicalLeadSource(value) {
  const cleaned = cleanText(value);
  const key = aliasKey(cleaned);
  if (!key) return 'Other';
  if (['fru', 'freerate', 'freerateupdate'].includes(key)) return 'Lead Buy - FreeRateUpdate';
  if (['leadpoint', 'lp'].includes(key)) return 'Lead Buy - LeadPoint';
  if (['lendingtree', 'lt'].includes(key)) return 'Lead Buy - Lending Tree';
  if (key.includes('warmtransfer') || key.includes('warmxfer') || key === 'transfer') return 'Warm Transfer';
  if (key.includes('mail')) return 'Mailer';
  if (key.includes('referral') || key.includes('referall') || key.includes('refferal')) return 'Referral';
  if (key.includes('repeatclient') || key.includes('returnclient')) return 'Return Client';
  if (key.includes('selfgen') || key.includes('selfsourced')) return 'Self Generated';
  if (key === 'agg' || key === 'aggregate' || key === 'aggregatecallcenter') return 'Aggregate';
  if (key === 'leadbuy') return 'Lead Buy';
  return cleaned;
}

export function payrollLeadSourceFor(value) {
  const key = aliasKey(canonicalLeadSource(value));
  if (key.startsWith('leadbuy')) return 'LEAD_BUY';
  if (key === 'mailer') return 'MAILER';
  if (key === 'warmtransfer') return 'WARM_TRANSFER';
  if (key === 'referral') return 'REFERRAL';
  if (key === 'returnclient') return 'RETURN_CLIENT';
  return 'OTHER';
}

export function payrollLeadProvidedByFor(value) {
  const key = aliasKey(canonicalLeadSource(value));
  return key === 'referral' || key === 'returnclient' || key === 'selfgenerated'
    ? 'SELF_SOURCED'
    : 'COMPANY_PROVIDED';
}

function excelSerialToDate(serial) {
  if (!Number.isFinite(serial)) return null;
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
}

function utcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function parseDateParts(text) {
  const cleaned = text
    .replace(/^funded\s*/i, '')
    .replace(/\/+/g, '/')
    .replace(/\/220(\d{2})$/, '/20$1')
    .trim();
  let match = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return { month: Number(match[1]), day: Number(match[2]), year };
  }
  match = cleaned.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (match) return { month: Number(match[1]), day: Number(match[2]), year: null };
  match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) return { month: Number(match[2]), day: Number(match[3]), year: Number(match[1]) };
  return null;
}

export function parseFundedDate(value, anchorDate = null) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return utcDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') {
    const parsed = excelSerialToDate(value);
    return parsed ? utcDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate()) : null;
  }
  const parts = parseDateParts(cleanText(value));
  if (!parts) return null;
  let year = parts.year;
  if (!year) {
    year = anchorDate?.getUTCFullYear() || new Date().getUTCFullYear();
    let candidate = utcDate(year, parts.month, parts.day);
    if (
      candidate &&
      anchorDate &&
      candidate.getTime() < anchorDate.getTime() - 180 * 86_400_000
    ) {
      year += 1;
    }
  }
  return utcDate(year, parts.month, parts.day);
}

export function parseRevenue(value) {
  if (value === null || value === undefined || cleanText(value) === '') return null;
  const parsed = typeof value === 'number'
    ? value
    : Number(cleanText(value).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1'));
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) / 100 : null;
}

function rowSignature(row) {
  return JSON.stringify({
    loanOfficer: row.loanOfficer,
    assignedAt: row.assignedAt?.toISOString() || null,
    ariveNumber: row.ariveNumber,
    borrowerName: row.borrowerName,
    leadSource: row.leadSource,
    propertyState: row.propertyState,
    loanType: row.loanType,
    lender: row.lender,
    senior: row.senior,
    fundedAt: row.fundedAt?.toISOString() || null,
    finalRevenue: row.finalRevenue,
  });
}

export function chooseCanonicalFundedRows(parsedRows) {
  const invalid = [];
  const groups = new Map();
  for (const row of parsedRows) {
    const reasons = [];
    if (!row.ariveNumber) reasons.push('ARIVE must be an eight-digit number');
    if (!row.borrowerName) reasons.push('Borrower is required');
    if (!row.loanOfficer) reasons.push('Loan Officer is required');
    if (!row.assignedAt) reasons.push('Assigned date is invalid');
    if (!row.fundedAt) reasons.push('Funded date is invalid');
    if (row.finalRevenue === null) reasons.push('Final Revenue is missing or invalid');
    if (reasons.length > 0) {
      invalid.push({ ...row, reasons });
      continue;
    }
    const group = groups.get(row.ariveNumber) || [];
    group.push(row);
    groups.set(row.ariveNumber, group);
  }

  const rows = [];
  const discardedDuplicates = [];
  for (const [ariveNumber, group] of groups) {
    const signatures = new Set(group.map(rowSignature));
    const sorted = [...group].sort(
      (a, b) =>
        a.fundedAt.getTime() - b.fundedAt.getTime() ||
        a.sourceOrder - b.sourceOrder,
    );
    const winner = sorted[sorted.length - 1];
    rows.push(winner);
    for (const discarded of sorted.slice(0, -1)) {
      discardedDuplicates.push({
        ariveNumber,
        winner: { sheet: winner.sourceSheet, row: winner.sourceRow },
        discarded: { sheet: discarded.sourceSheet, row: discarded.sourceRow },
        conflict: signatures.size > 1,
      });
    }
  }

  return {
    rows: rows.sort((a, b) => a.ariveNumber.localeCompare(b.ariveNumber)),
    invalid,
    discardedDuplicates,
  };
}

export async function parseFundedWorkbook(path) {
  const parsedRows = [];
  const sheetSummaries = [];
  let sourceOrder = 0;
  const sheets = await readXlsxFile(path);

  for (const sheet of sheets) {
    const worksheetRows = sheet.data;
    const headerRow = worksheetRows[0] || [];
    const headers = new Map();
    headerRow.forEach((value, columnIndex) => {
      headers.set(normalizeHeader(value), columnIndex);
    });
    const missingHeaders = REQUIRED_HEADERS.filter((header) => !headers.has(header));
    if (missingHeaders.length > 0) {
      throw new Error(`${sheet.sheet} is missing required headers: ${missingHeaders.join(', ')}`);
    }

    let count = 0;
    worksheetRows.slice(1).forEach((excelRow, rowIndex) => {
      count += 1;
      sourceOrder += 1;
      const rowNumber = rowIndex + 2;
      const get = (header) => excelRow[headers.get(header)];
      const assignedAt = parseFundedDate(get('assigned'));
      const rawAriveNumber = cleanText(get('arrive'));
      const rawLeadSource = cleanText(get('leadsource'));
      parsedRows.push({
        sourceSheet: sheet.sheet,
        sourceRow: rowNumber,
        sourceOrder,
        rawAriveNumber,
        ariveNumber: normalizeAriveNumber(rawAriveNumber),
        loanOfficer: resolveFundedOfficerName(get('loanofficer')),
        assignedAt,
        borrowerName: cleanText(get('borrower')),
        leadSource: canonicalLeadSource(rawLeadSource),
        rawLeadSource,
        propertyState: cleanText(get('state')).toUpperCase(),
        loanType: cleanText(get('loantype')),
        lender: canonicalLender(get('lender')),
        senior: cleanText(get('senior')) || null,
        fundedAt: parseFundedDate(get('fundeddate'), assignedAt),
        finalRevenue: parseRevenue(get('finalrevenue')),
      });
    });
    sheetSummaries.push({ sheet: sheet.sheet, rows: count });
  }

  return {
    path,
    sheets: sheetSummaries,
    parsedRowCount: parsedRows.length,
    ...chooseCanonicalFundedRows(parsedRows),
  };
}

export function addMonthsClampedUtc(value, months) {
  const date = new Date(value);
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0, 12)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

export function getMortgageFirstPaymentDateUtc(value) {
  const fundedAt = new Date(value);
  return new Date(
    Date.UTC(
      fundedAt.getUTCFullYear(),
      fundedAt.getUTCMonth() + 2,
      1,
      12,
    ),
  );
}
