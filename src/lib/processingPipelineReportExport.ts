import type {
  ProcessingLastTouchRow,
  ProcessingPipelineReport,
  ProcessingServicesReportRow,
  ProcessingStatusReportRow,
} from '@/app/actions/processingPipelineReportingActions';

type ReportRow =
  | ProcessingLastTouchRow
  | ProcessingStatusReportRow
  | ProcessingServicesReportRow;

type ReportCellValue = string | number | boolean | null | undefined;

type ReportColumn<Row extends ReportRow> = {
  label: string;
  width: number;
  value: (row: Row) => ReportCellValue;
  type?: 'String' | 'Number' | 'DateTime';
  style?: (row: Row) => string | undefined;
};

const STATUS_LABELS: Record<string, string> = {
  SUBBED_TO_UW: 'Subbed to UW',
  APPROVED_WITH_CONDITIONS: 'Approved with conditions',
  RE_SUB: 'Re-sub',
  CTC: 'CTC',
  DOCS_OUT: 'Docs out',
  FUNDED: 'Funded',
  SUSPENDED: 'Suspended',
  SUSPENDED_RESTRUCTURE: 'Suspended/Restructure',
  ADVERSE_PENDING: 'Adverse Pending',
  PENDING_APPROVAL: 'Pending Approval',
  NOT_STARTED: 'Not started',
  ORDERED: 'Ordered',
  RECEIVED: 'Received',
  NOT_APPLICABLE: 'N/A',
};

const COMMON_COLUMNS = {
  bucket: {
    label: 'Bucket',
    width: 105,
    value: (row: ReportRow) => row.bucket,
  },
  rateLock: {
    label: 'Rate Lock Requested',
    width: 105,
    value: (row: ReportRow) => row.rateLockRequested ? 'Yes' : 'No',
  },
  assignment: {
    label: 'Assignment Date',
    width: 95,
    value: (row: ReportRow) => row.assignmentDate,
    type: 'DateTime' as const,
  },
  loanNumber: {
    label: 'Arive #',
    width: 90,
    value: (row: ReportRow) => row.loanNumber,
  },
  borrower: {
    label: 'Borrower',
    width: 145,
    value: (row: ReportRow) => row.borrowerName,
  },
  loanOfficer: {
    label: 'Loan Officer',
    width: 125,
    value: (row: ReportRow) => row.loanOfficer,
  },
  junior: {
    label: 'Jr Processor',
    width: 115,
    value: (row: ReportRow) => row.juniorProcessor,
  },
  senior: {
    label: 'Sr Processor',
    width: 115,
    value: (row: ReportRow) => row.seniorProcessor,
  },
  state: {
    label: 'State',
    width: 55,
    value: (row: ReportRow) => row.state,
  },
  lender: {
    label: 'Lender',
    width: 110,
    value: (row: ReportRow) => row.lender,
  },
  loanType: {
    label: 'Loan Type',
    width: 95,
    value: (row: ReportRow) => row.loanType,
  },
  status: {
    label: 'Pipeline Status',
    width: 145,
    value: (row: ReportRow) =>
      STATUS_LABELS[row.pipelineStatus] || row.pipelineStatus,
    style: (row: ReportRow) => statusStyle(row.pipelineStatus),
  },
  statusChanged: {
    label: 'Status Changed',
    width: 110,
    value: (row: ReportRow) => row.statusChangedAt,
    type: 'DateTime' as const,
  },
  days: {
    label: 'Days in Status',
    width: 82,
    value: (row: ReportRow) => row.daysInStatus,
    type: 'Number' as const,
  },
  pending: {
    label: 'Pending Items',
    width: 210,
    value: (row: ReportRow) => row.pendingItems,
  },
};

function statusStyle(status: string) {
  if (['ADVERSE_PENDING', 'SUSPENDED_RESTRUCTURE'].includes(status)) {
    return 'StatusRed';
  }
  if (status === 'SUSPENDED') return 'StatusOrange';
  if (['CTC', 'DOCS_OUT'].includes(status)) return 'StatusGreen';
  if (status === 'APPROVED_WITH_CONDITIONS') return 'StatusBlue';
  return 'StatusPurple';
}

function serviceSlaStyle(value: string) {
  if (value === 'OVERDUE') return 'StatusRed';
  if (value === 'WARNING') return 'StatusOrange';
  return 'StatusGreen';
}

function xmlEscape(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function lastTouchColumns(): ReportColumn<ProcessingLastTouchRow>[] {
  return [
    COMMON_COLUMNS.bucket,
    COMMON_COLUMNS.rateLock,
    COMMON_COLUMNS.assignment,
    COMMON_COLUMNS.loanNumber,
    COMMON_COLUMNS.borrower,
    COMMON_COLUMNS.loanOfficer,
    COMMON_COLUMNS.junior,
    COMMON_COLUMNS.senior,
    COMMON_COLUMNS.state,
    COMMON_COLUMNS.lender,
    COMMON_COLUMNS.loanType,
    COMMON_COLUMNS.status,
    COMMON_COLUMNS.pending,
    {
      label: 'Last Changed Item / Action',
      width: 245,
      value: (row) => row.lastChangedItem,
    },
    {
      label: 'Last Changed By',
      width: 125,
      value: (row) => row.lastChangedBy,
    },
    {
      label: 'Last Touched At',
      width: 120,
      value: (row) => row.lastTouchedAt,
      type: 'DateTime',
    },
    {
      label: 'Time Since Last Touch',
      width: 115,
      value: (row) => row.lastTouchedAge,
    },
  ];
}

function statusColumns(): ReportColumn<ProcessingStatusReportRow>[] {
  return [
    COMMON_COLUMNS.assignment,
    COMMON_COLUMNS.loanNumber,
    COMMON_COLUMNS.borrower,
    COMMON_COLUMNS.loanOfficer,
    COMMON_COLUMNS.bucket,
    COMMON_COLUMNS.status,
    COMMON_COLUMNS.statusChanged,
    COMMON_COLUMNS.days,
    COMMON_COLUMNS.junior,
    COMMON_COLUMNS.senior,
    COMMON_COLUMNS.state,
    COMMON_COLUMNS.lender,
    COMMON_COLUMNS.loanType,
    COMMON_COLUMNS.pending,
    COMMON_COLUMNS.rateLock,
  ];
}

function servicesColumns(): ReportColumn<ProcessingServicesReportRow>[] {
  const serviceStatus = (
    label: string,
    key: 'titleStatus' | 'hoiStatus' | 'payoffStatus',
  ): ReportColumn<ProcessingServicesReportRow> => ({
    label,
    width: 95,
    value: (row) => STATUS_LABELS[row[key]] || row[key],
  });
  const dateColumn = (
    label: string,
    key: keyof ProcessingServicesReportRow,
    width = 105,
  ): ReportColumn<ProcessingServicesReportRow> => ({
    label,
    width,
    value: (row) => row[key] as ReportCellValue,
    type: 'DateTime',
  });
  const activityColumns = (
    prefix: string,
    atKey: keyof ProcessingServicesReportRow,
    ageKey: keyof ProcessingServicesReportRow,
    sourceKey: keyof ProcessingServicesReportRow,
    slaKey: keyof ProcessingServicesReportRow,
  ): ReportColumn<ProcessingServicesReportRow>[] => [
    dateColumn(`${prefix} Last Updated`, atKey, 115),
    {
      label: `${prefix} Age`,
      width: 90,
      value: (row) => row[ageKey] as ReportCellValue,
    },
    {
      label: `${prefix} Date Source`,
      width: 130,
      value: (row) =>
        row[sourceKey] === 'INITIAL'
          ? 'Initial/default fallback'
          : 'Audited field change',
    },
    {
      label: `${prefix} SLA`,
      width: 75,
      value: (row) => row[slaKey] as ReportCellValue,
      style: (row) => serviceSlaStyle(String(row[slaKey])),
    },
  ];
  return [
    COMMON_COLUMNS.assignment,
    COMMON_COLUMNS.loanNumber,
    COMMON_COLUMNS.borrower,
    COMMON_COLUMNS.loanOfficer,
    COMMON_COLUMNS.bucket,
    COMMON_COLUMNS.status,
    COMMON_COLUMNS.junior,
    COMMON_COLUMNS.senior,
    COMMON_COLUMNS.state,
    COMMON_COLUMNS.lender,
    COMMON_COLUMNS.loanType,
    serviceStatus('Title Status', 'titleStatus'),
    ...activityColumns(
      'Title',
      'titleLastUpdatedAt',
      'titleAge',
      'titleUpdateSource',
      'titleSla',
    ),
    serviceStatus('HOI Status', 'hoiStatus'),
    dateColumn('HOI Ordered', 'hoiOrderedAt'),
    ...activityColumns(
      'HOI',
      'hoiLastUpdatedAt',
      'hoiAge',
      'hoiUpdateSource',
      'hoiSla',
    ),
    {
      label: 'Appraisal Needed',
      width: 95,
      value: (row) => row.appraisalNeeded,
    },
    dateColumn('Appraisal Ordered', 'appraisalOrderedAt'),
    dateColumn('Appraisal Scheduled', 'appraisalScheduledAt'),
    dateColumn('Appraisal Back', 'appraisalBackAt'),
    ...activityColumns(
      'Appraisal',
      'appraisalLastUpdatedAt',
      'appraisalAge',
      'appraisalUpdateSource',
      'appraisalSla',
    ),
    serviceStatus('Payoff Status', 'payoffStatus'),
    dateColumn('Payoff Ordered', 'payoffOrderedAt'),
    dateColumn('Payoff Expiration', 'payoffExpiresAt'),
    ...activityColumns(
      'Payoff',
      'payoffLastUpdatedAt',
      'payoffAge',
      'payoffUpdateSource',
      'payoffSla',
    ),
    {
      label: 'Remaining Services',
      width: 185,
      value: (row) => row.remainingServices,
      style: (row) =>
        row.remainingServices === 'Complete' ? 'StatusGreen' : 'StatusOrange',
    },
  ];
}

function reportMetadata(report: ProcessingPipelineReport) {
  if (report.type === 'LAST_TOUCH') {
    return {
      title: 'Processing Pipeline — Last Touch Report',
      subtitle:
        'Active Pipeline and Restructure loans, sorted from longest untouched to most recently touched.',
      file: 'processing-last-touch',
      columns: lastTouchColumns(),
    };
  }
  if (report.type === 'PIPELINE_STATUS') {
    const statuses = report.selectedStatuses
      .map((status) => STATUS_LABELS[status] || status)
      .join(', ');
    return {
      title: 'Processing Pipeline — Pipeline Status Report',
      subtitle: `Active loans matching: ${statuses}`,
      file: 'processing-pipeline-status',
      columns: statusColumns(),
    };
  }
  return {
    title: 'Processing Pipeline — Services Report',
    subtitle:
      'Title, HOI, Appraisal, and Payoff completion, audited age, SLA state, and remaining work.',
    file: 'processing-services',
    columns: servicesColumns(),
  };
}

function cellXml<Row extends ReportRow>(
  column: ReportColumn<Row>,
  row: Row,
  rowIndex: number,
) {
  const value = column.value(row);
  const type = column.type || (typeof value === 'number' ? 'Number' : 'String');
  const defaultStyle = rowIndex % 2 === 0 ? 'DataEven' : 'DataOdd';
  const style = column.style?.(row) || (
    type === 'DateTime' ? `${defaultStyle}Date` : defaultStyle
  );
  if (value === null || value === undefined || value === '') {
    return `<Cell ss:StyleID="${style}"><Data ss:Type="String"></Data></Cell>`;
  }
  const normalized =
    type === 'DateTime'
      ? new Date(String(value)).toISOString()
      : type === 'Number'
        ? Number(value)
        : value;
  return `<Cell ss:StyleID="${style}"><Data ss:Type="${type}">${xmlEscape(normalized)}</Data></Cell>`;
}

export function processingReportFilename(report: ProcessingPipelineReport) {
  const metadata = reportMetadata(report);
  const date = report.generatedAt.slice(0, 10);
  return `${metadata.file}-${date}.xls`;
}

export function buildProcessingReportWorkbook(
  report: ProcessingPipelineReport,
  options: { scopeLabel?: string } = {},
) {
  const metadata = reportMetadata(report);
  const columns = metadata.columns as ReportColumn<ReportRow>[];
  const scopeLabel = options.scopeLabel || 'All role-authorized active loans';
  const lastColumn = columns.length;
  const lastRow = report.rows.length + 5;
  const generated = new Date(report.generatedAt).toISOString();
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Aptos" ss:Size="10"/></Style>
  <Style ss:ID="Title"><Font ss:FontName="Aptos Display" ss:Size="18" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#0F172A" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="Subtitle"><Font ss:FontName="Aptos" ss:Size="10" ss:Color="#334155"/><Interior ss:Color="#E2E8F0" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Generated"><Font ss:FontName="Aptos" ss:Size="9" ss:Color="#64748B"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Header"><Font ss:FontName="Aptos" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#2563EB" ss:Pattern="Solid"/><Alignment ss:WrapText="1" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#1D4ED8"/></Borders></Style>
  <Style ss:ID="DataEven"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Vertical="Top" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders></Style>
  <Style ss:ID="DataOdd"><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Vertical="Top" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders></Style>
  <Style ss:ID="DataEvenDate" ss:Parent="DataEven"><NumberFormat ss:Format="mmm d, yyyy h:mm AM/PM"/></Style>
  <Style ss:ID="DataOddDate" ss:Parent="DataOdd"><NumberFormat ss:Format="mmm d, yyyy h:mm AM/PM"/></Style>
  <Style ss:ID="StatusRed" ss:Parent="DataEven"><Font ss:Bold="1" ss:Color="#991B1B"/><Interior ss:Color="#FEE2E2" ss:Pattern="Solid"/></Style>
  <Style ss:ID="StatusOrange" ss:Parent="DataEven"><Font ss:Bold="1" ss:Color="#9A3412"/><Interior ss:Color="#FFEDD5" ss:Pattern="Solid"/></Style>
  <Style ss:ID="StatusGreen" ss:Parent="DataEven"><Font ss:Bold="1" ss:Color="#166534"/><Interior ss:Color="#DCFCE7" ss:Pattern="Solid"/></Style>
  <Style ss:ID="StatusBlue" ss:Parent="DataEven"><Font ss:Bold="1" ss:Color="#1E40AF"/><Interior ss:Color="#DBEAFE" ss:Pattern="Solid"/></Style>
  <Style ss:ID="StatusPurple" ss:Parent="DataEven"><Font ss:Bold="1" ss:Color="#6B21A8"/><Interior ss:Color="#F3E8FF" ss:Pattern="Solid"/></Style>
 </Styles>
 <Worksheet ss:Name="Report">
  <Table>
   ${columns.map((column) => `<Column ss:AutoFitWidth="0" ss:Width="${column.width}"/>`).join('')}
   <Row ss:Height="28"><Cell ss:StyleID="Title" ss:MergeAcross="${lastColumn - 1}"><Data ss:Type="String">${xmlEscape(metadata.title)}</Data></Cell></Row>
   <Row ss:Height="22"><Cell ss:StyleID="Subtitle" ss:MergeAcross="${lastColumn - 1}"><Data ss:Type="String">${xmlEscape(metadata.subtitle)}</Data></Cell></Row>
   <Row ss:Height="20"><Cell ss:StyleID="Generated" ss:MergeAcross="${lastColumn - 1}"><Data ss:Type="String">${xmlEscape(`Generated ${generated} • Scope: ${scopeLabel} • ${report.rows.length} loan${report.rows.length === 1 ? '' : 's'} • Fundings excluded`)}</Data></Cell></Row>
   <Row ss:Height="8">${columns.map(() => '<Cell/>').join('')}</Row>
   <Row ss:Height="32">${columns.map((column) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(column.label)}</Data></Cell>`).join('')}</Row>
   ${report.rows.map((row, index) => `<Row>${columns.map((column) => cellXml(column, row as ReportRow, index)).join('')}</Row>`).join('')}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/><FrozenNoSplit/><SplitHorizontal>5</SplitHorizontal><TopRowBottomPane>5</TopRowBottomPane><ActivePane>2</ActivePane>
   <ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
  <AutoFilter x:Range="R5C1:R${lastRow}C${lastColumn}" xmlns="urn:schemas-microsoft-com:office:excel"/>
 </Worksheet>
</Workbook>`;
  return {
    content: xml,
    filename: processingReportFilename(report),
    mimeType: 'application/vnd.ms-excel;charset=utf-8',
  };
}

export function downloadProcessingReport(
  report: ProcessingPipelineReport,
  options: { scopeLabel?: string } = {},
) {
  const workbook = buildProcessingReportWorkbook(report, options);
  const blob = new Blob([workbook.content], { type: workbook.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = workbook.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
