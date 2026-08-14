import readXlsxFile from 'read-excel-file/node';

const REQUIRED_HEADERS = [
  'loanofficer',
  'dateassigned',
  'arrive',
  'borrower',
  'lender',
  'loantype',
  'state',
  'jrprocessor',
  'processor',
  'pipelinestatus',
  'pendingitems',
  'title',
  'payoff',
  'hoi',
  'appraisal',
  'appraisalnotes',
  'appraisalordereddate',
  'appraisalback',
  'cdsent',
  'extranotes',
  'ratelock',
];

export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeHeader(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function normalizeAriveNumber(value) {
  const normalized = cleanText(value).replace(/\.0+$/, '').replace(/\s+/g, '');
  return /^\d{8}$/.test(normalized) ? normalized : null;
}

function token(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[✅🟡]/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

function utcDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? date
    : null;
}

export function parsePipelineDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return utcDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const parsed = new Date(Date.UTC(1899, 11, 30) + value * 86_400_000);
    return utcDate(parsed.getUTCFullYear(), parsed.getUTCMonth() + 1, parsed.getUTCDate());
  }
  const text = cleanText(value);
  let match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (match) {
    let year = Number(match[3]);
    if (year < 100) year += 2000;
    return utcDate(year, Number(match[1]), Number(match[2]));
  }
  match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return match ? utcDate(Number(match[1]), Number(match[2]), Number(match[3])) : null;
}

export function normalizePipelineStatus(value) {
  const key = token(value);
  if (key === 'approvedwithconditions') return 'APPROVED_WITH_CONDITIONS';
  if (key === 'ctc' || key === 'cleartoclose') return 'CTC';
  if (key === 'subbedtouw' || key === 'submittedtouw') return 'SUBBED_TO_UW';
  if (key === 'resub' || key === 'resubmitted') return 'RE_SUB';
  if (key === 'docsout') return 'DOCS_OUT';
  if (key === 'funded') return 'FUNDED';
  if (key === 'suspendedrestructure' || key === 'restructure') {
    return 'SUSPENDED_RESTRUCTURE';
  }
  if (key === 'suspended') return 'SUSPENDED';
  if (key === 'adversepending') return 'ADVERSE_PENDING';
  if (key === 'pendingapproval') return 'PENDING_APPROVAL';
  return null;
}

export function normalizeItemStatus(value) {
  const key = token(value);
  if (['received', 'recieved', 'receveid', 'receieved'].includes(key)) return 'RECEIVED';
  if (key === 'ordered') return 'ORDERED';
  if (key === 'notstarted') return 'NOT_STARTED';
  if (key === 'na' || key === 'notapplicable') return 'NOT_APPLICABLE';
  return null;
}

export function normalizeYesNo(value) {
  const key = token(value);
  if (key === 'y' || key === 'yes' || key === 'true') return true;
  if (key === 'n' || key === 'no' || key === 'false') return false;
  return null;
}

export function normalizeAppraisal(value) {
  const key = token(value);
  if (key === 'tbd' || key === 'junior') return 'TBD';
  const parsed = normalizeYesNo(value);
  return parsed === null ? null : parsed;
}

export function canonicalLender(value) {
  const text = cleanText(value);
  const key = token(text);
  if (key === 'sunwest') return 'Sun West';
  if (key === 'kind') return 'KIND';
  if (key === 'uwm') return 'UWM';
  if (key === 'epm') return 'EPM';
  if (key === 'amwest') return 'AMWEST';
  if (key === 'button') return 'Button';
  if (key === 'spring') return 'Spring';
  return text;
}

export function canonicalLoanType(value) {
  const text = cleanText(value);
  const key = token(text);
  if (key === 'conv' || key === 'conventional') return 'Conventional';
  if (key === 'heloan') return 'HELOAN';
  if (key === 'heloc') return 'HELOC';
  if (key === 'va') return 'VA';
  if (key === 'vacashout') return 'VA Cashout';
  if (key === 'irr' || key === 'irrrl') return 'IRRRL';
  if (key === 'nonqm') return 'Non QM';
  if (key === 'cashoutnonqm') return 'Cashout Non QM';
  if (key === 'fha') return 'FHA';
  return text || null;
}

function addUtcDays(value, days) {
  if (!value) return null;
  return new Date(value.getTime() + days * 86_400_000);
}

function appraisalBackValue(value) {
  const parsed = parsePipelineDate(value);
  if (parsed) return { date: parsed, note: null };
  const text = cleanText(value);
  if (!text || token(text) === 'na') return { date: null, note: null };
  return { date: null, note: text };
}

export function chooseCanonicalPipelineRows(parsedRows) {
  const invalid = [];
  const groups = new Map();
  for (const row of parsedRows) {
    const reasons = [];
    if (!row.ariveNumber) reasons.push('ARIVE must be an eight-digit number');
    if (!row.borrowerName) reasons.push('Borrower is required');
    if (!row.assignedAt) reasons.push('Date Assigned is invalid');
    if (!row.pipelineStatus) reasons.push('Pipeline Status is unsupported');
    if (!row.titleStatus) reasons.push('Title status is unsupported');
    if (!row.payoffStatus) reasons.push('Payoff status is unsupported');
    if (!row.hoiStatus) reasons.push('HOI status is unsupported');
    if (row.appraisalNeeded === null && !row.appraisalTbd) {
      reasons.push('Appraisal must be Yes, No, or TBD');
    }
    if (reasons.length > 0) {
      invalid.push({ ...row, reasons });
      continue;
    }
    const group = groups.get(row.ariveNumber) || [];
    group.push(row);
    groups.set(row.ariveNumber, group);
  }

  const rows = [];
  const duplicates = [];
  for (const [ariveNumber, group] of groups) {
    if (group.length > 1) {
      duplicates.push({
        ariveNumber,
        rows: group.map((row) => ({
          sheet: row.sourceSheet,
          row: row.sourceRow,
          borrowerName: row.borrowerName,
        })),
      });
      invalid.push(
        ...group.map((row) => ({
          ...row,
          reasons: ['Duplicate ARIVE appears on multiple workbook rows'],
        })),
      );
      continue;
    }
    rows.push(group[0]);
  }

  return {
    rows: rows.sort((left, right) => left.ariveNumber.localeCompare(right.ariveNumber)),
    invalid,
    duplicates,
  };
}

export async function parseProcessingPipelineWorkbook(path) {
  const parsedRows = [];
  const ignoredRows = [];
  const sheets = await readXlsxFile(path);
  let sourceOrder = 0;

  for (const sheet of sheets) {
    const worksheetRows = sheet.data;
    const headerRow = worksheetRows[0] || [];
    const headers = new Map();
    headerRow.forEach((value, columnIndex) => {
      const key = normalizeHeader(value);
      if (key) headers.set(key, columnIndex);
    });
    const missing = REQUIRED_HEADERS.filter((header) => !headers.has(header));
    if (missing.length > 0) {
      throw new Error(`${sheet.sheet} is missing required headers: ${missing.join(', ')}`);
    }

    worksheetRows.slice(1).forEach((excelRow, rowIndex) => {
      const sourceRow = rowIndex + 2;
      const get = (header) => excelRow[headers.get(header)];
      const rawAriveNumber = cleanText(get('arrive'));
      if (!rawAriveNumber) {
        if (excelRow.some((cell) => cleanText(cell))) {
          ignoredRows.push({
            sourceSheet: sheet.sheet,
            sourceRow,
            reason: 'Populated row has no ARIVE number',
          });
        }
        return;
      }

      sourceOrder += 1;
      const assignedAt = parsePipelineDate(get('dateassigned'));
      const appraisal = normalizeAppraisal(get('appraisal'));
      const appraisalBack = appraisalBackValue(get('appraisalback'));
      const rawAppraisalNotes = cleanText(get('appraisalnotes'));
      const appraisalNotes =
        rawAppraisalNotes && token(rawAppraisalNotes) !== 'tbd'
          ? rawAppraisalNotes
          : null;
      parsedRows.push({
        sourceSheet: sheet.sheet,
        sourceRow,
        sourceOrder,
        rawAriveNumber,
        ariveNumber: normalizeAriveNumber(rawAriveNumber),
        loanOfficer: cleanText(get('loanofficer')),
        assignedAt,
        borrowerName: cleanText(get('borrower')),
        lender: canonicalLender(get('lender')),
        loanType: canonicalLoanType(get('loantype')),
        propertyState: cleanText(get('state')).toUpperCase() || null,
        juniorProcessor: cleanText(get('jrprocessor')),
        seniorProcessor: cleanText(get('processor')),
        pipelineStatus: normalizePipelineStatus(get('pipelinestatus')),
        missingItemsCurrentStatus: cleanText(get('pendingitems')) || null,
        titleStatus: normalizeItemStatus(get('title')),
        payoffStatus: normalizeItemStatus(get('payoff')),
        hoiStatus: normalizeItemStatus(get('hoi')),
        appraisalNeeded: typeof appraisal === 'boolean' ? appraisal : null,
        appraisalTbd: appraisal === 'TBD',
        appraisalNotes,
        appraisalOrderedAt:
          parsePipelineDate(get('appraisalordereddate')) ||
          (appraisal === true ? addUtcDays(assignedAt, 3) : null),
        appraisalOrderedDerived:
          appraisal === true && !parsePipelineDate(get('appraisalordereddate')),
        appraisalBackAt: appraisalBack.date,
        appraisalBackNote: appraisalBack.note,
        cdSent: normalizeYesNo(get('cdsent')),
        extraNotes: cleanText(get('extranotes')) || null,
        rateLock: normalizeYesNo(get('ratelock')),
      });
    });
  }

  return {
    path,
    sheets: sheets.map((sheet) => ({ sheet: sheet.sheet, rows: sheet.data.length - 1 })),
    parsedRowCount: parsedRows.length,
    ignoredRows,
    ...chooseCanonicalPipelineRows(parsedRows),
  };
}
