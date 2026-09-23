import type { PayrollRequestRow } from '@/app/actions/payrollActions';

type CellValue = string | number | null | undefined;
type CellType = 'String' | 'Number' | 'DateTime';
type CellFormat = 'text' | 'currency' | 'number' | 'percent' | 'date' | 'dateTime';

type Column = {
  label: string;
  width: number;
  value: (row: PayrollRequestRow) => CellValue;
  type?: CellType;
  format?: CellFormat;
};

export type PayrollExportReport = {
  rows: PayrollRequestRow[];
  startDate: string;
  endDate: string;
  generatedAt?: string;
};

function enumLabel(value: string | null | undefined) {
  if (!value) return '';
  return value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function xmlEscape(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const columns: Column[] = [
  { label: 'Loan Number', width: 90, value: (row) => row.loanNumber },
  { label: 'Borrower Name', width: 145, value: (row) => row.borrowerName },
  { label: 'Loan Officer', width: 135, value: (row) => row.loanOfficerName },
  { label: 'Loan Officer Email', width: 175, value: (row) => row.loanOfficerEmail },
  { label: 'Loan Type', width: 90, value: (row) => row.loanType },
  { label: 'Lender', width: 120, value: (row) => row.lender },
  { label: 'Channel', width: 95, value: (row) => row.loanChannel === 'BROKER' ? 'Broker' : 'Non-Del' },
  { label: 'Processing Type', width: 105, value: (row) => enumLabel(row.processingType) },
  { label: 'Lead Source', width: 110, value: (row) => enumLabel(row.leadSource) },
  { label: 'Lead Source Detail', width: 145, value: (row) => row.leadSourceDetail },
  { label: 'Mailer Campaign', width: 145, value: (row) => row.mailerCampaign },
  { label: 'Lead Provided By', width: 120, value: (row) => enumLabel(row.leadProvidedBy) },
  { label: 'Submitter Notes', width: 220, value: (row) => row.submitterNotes },
  { label: 'Expected Revenue', width: 105, value: (row) => row.expectedRevenue, type: 'Number', format: 'currency' },
  { label: 'Estimated Compensation', width: 115, value: (row) => row.estimatedCompAmount, type: 'Number', format: 'currency' },
  { label: 'Broker Compensation', width: 115, value: (row) => row.brokerComp, type: 'Number', format: 'currency' },
  { label: 'Section A Compensation', width: 125, value: (row) => row.sectionAComp, type: 'Number', format: 'currency' },
  { label: 'YSP Amount', width: 95, value: (row) => row.yspAmount, type: 'Number', format: 'currency' },
  { label: 'Tolerance Cure', width: 95, value: (row) => row.toleranceCure, type: 'Number', format: 'currency' },
  { label: 'One Day Interest', width: 100, value: (row) => row.oneDayInterest, type: 'Number', format: 'currency' },
  { label: 'Wire Fee', width: 85, value: (row) => row.wireFee, type: 'Number', format: 'currency' },
  { label: 'Underwriting Fee', width: 105, value: (row) => row.underwritingFee, type: 'Number', format: 'currency' },
  { label: 'Lender Credit', width: 95, value: (row) => row.lenderCredit, type: 'Number', format: 'currency' },
  { label: 'Origination Fee', width: 100, value: (row) => row.originationFee, type: 'Number', format: 'currency' },
  { label: 'Processing Fee', width: 100, value: (row) => row.processingFee, type: 'Number', format: 'currency' },
  { label: 'Appraisal Add-Back', width: 110, value: (row) => row.appraisalAddBack, type: 'Number', format: 'currency' },
  { label: 'Credit Add-Back', width: 100, value: (row) => row.creditAddBack, type: 'Number', format: 'currency' },
  { label: 'VOE Add-Back', width: 95, value: (row) => row.voeAddBack, type: 'Number', format: 'currency' },
  { label: 'Termite Add-Back', width: 105, value: (row) => row.termiteAddBack, type: 'Number', format: 'currency' },
  { label: 'Appraisal Reinspection Add-Back', width: 155, value: (row) => row.appraisalReinspectionAddBack, type: 'Number', format: 'currency' },
  { label: 'Water Test Add-Back', width: 115, value: (row) => row.waterTestAddBack, type: 'Number', format: 'currency' },
  { label: 'Loan Amount Prior to Fees', width: 135, value: (row) => row.loanAmountPriorToFees, type: 'Number', format: 'currency' },
  { label: 'Recession Date', width: 95, value: (row) => row.recessionDate, type: 'DateTime', format: 'date' },
  { label: 'Figure/NFTY Attachment Name', width: 170, value: (row) => row.figureNftyAttachmentName },
  { label: 'Figure/NFTY Attachment URL', width: 240, value: (row) => row.figureNftyAttachmentUrl },
  { label: 'Property Address', width: 180, value: (row) => row.mismoDetails?.propertyAddress },
  { label: 'Property City', width: 110, value: (row) => row.mismoDetails?.propertyCity },
  { label: 'Property State', width: 70, value: (row) => row.mismoDetails?.propertyState },
  { label: 'Property ZIP', width: 75, value: (row) => row.mismoDetails?.propertyZip },
  { label: 'MISMO Loan Amount', width: 110, value: (row) => row.mismoDetails?.loanAmount, type: 'Number', format: 'currency' },
  { label: 'Home Value', width: 100, value: (row) => row.mismoDetails?.homeValue, type: 'Number', format: 'currency' },
  { label: 'Purchase Price', width: 100, value: (row) => row.mismoDetails?.purchasePrice, type: 'Number', format: 'currency' },
  { label: 'Appraised Value', width: 105, value: (row) => row.mismoDetails?.appraisedValue, type: 'Number', format: 'currency' },
  { label: 'Occupancy', width: 95, value: (row) => row.mismoDetails?.occupancy },
  { label: 'Loan Purpose', width: 100, value: (row) => row.mismoDetails?.loanPurpose },
  { label: 'Lien Position', width: 90, value: (row) => row.mismoDetails?.lienPosition },
  { label: 'Note Rate', width: 80, value: (row) => row.mismoDetails?.noteRate, type: 'Number', format: 'percent' },
  { label: 'Monthly Payment', width: 105, value: (row) => row.mismoDetails?.monthlyPayment, type: 'Number', format: 'currency' },
  { label: 'Borrower Credit Score', width: 115, value: (row) => row.mismoDetails?.borrowerCreditScore, type: 'Number', format: 'number' },
  { label: 'Reimbursement Target', width: 125, value: (row) => enumLabel(row.reimbursementTarget) },
  { label: 'Applied Plan Type', width: 110, value: (row) => enumLabel(row.appliedPlanType) },
  { label: 'Status', width: 105, value: (row) => enumLabel(row.status) },
  { label: 'Submitted At', width: 120, value: (row) => row.submittedAt, type: 'DateTime', format: 'dateTime' },
  { label: 'Funded At', width: 120, value: (row) => row.fundedAt, type: 'DateTime', format: 'dateTime' },
  { label: 'Reviewed At', width: 120, value: (row) => row.reviewedAt, type: 'DateTime', format: 'dateTime' },
  { label: 'Paid At', width: 120, value: (row) => row.paidAt, type: 'DateTime', format: 'dateTime' },
  { label: 'Admin Notes', width: 220, value: (row) => row.adminNotes },
  { label: 'Rejection Reason', width: 180, value: (row) => row.rejectionReason },
  { label: 'LO Split Override', width: 105, value: (row) => row.loanOfficerSplitPercentOverride, type: 'Number', format: 'percent' },
  { label: 'Gross Compensation', width: 115, value: (row) => row.grossCompAmount, type: 'Number', format: 'currency' },
  { label: 'Pre-Split Add-Back Total', width: 130, value: (row) => row.preSplitAddBackTotal, type: 'Number', format: 'currency' },
  { label: 'Pre-Split Deduction Total', width: 135, value: (row) => row.preSplitDeductionTotal, type: 'Number', format: 'currency' },
  { label: 'Split Basis Amount', width: 110, value: (row) => row.splitBasisAmount, type: 'Number', format: 'currency' },
  { label: 'Post-Split Add-Back Total', width: 135, value: (row) => row.postSplitAddBackTotal, type: 'Number', format: 'currency' },
  { label: 'Net Compensation', width: 110, value: (row) => row.netCompAmount, type: 'Number', format: 'currency' },
  { label: 'Manager Calculation Required', width: 145, value: (row) => row.managerCalculationRequired ? 'Yes' : 'No' },
  { label: 'Manager Calculation Completed At', width: 160, value: (row) => row.managerCalculationCompletedAt, type: 'DateTime', format: 'dateTime' },
  { label: 'Manager Calculation Completed By', width: 160, value: (row) => row.managerCalculationCompletedByName },
];

function styleId(column: Column, rowIndex: number) {
  const base = rowIndex % 2 === 0 ? 'Even' : 'Odd';
  const suffix = {
    currency: 'Currency',
    number: 'Number',
    percent: 'Percent',
    date: 'Date',
    dateTime: 'DateTime',
    text: '',
  }[column.format ?? 'text'];
  return `Data${base}${suffix}`;
}

function cellXml(column: Column, row: PayrollRequestRow, rowIndex: number) {
  const value = column.value(row);
  const style = styleId(column, rowIndex);
  if (value === null || value === undefined || value === '') {
    return `<Cell ss:StyleID="${style}"><Data ss:Type="String"></Data></Cell>`;
  }
  const type = column.type ?? (typeof value === 'number' ? 'Number' : 'String');
  const normalized = type === 'DateTime'
    ? new Date(String(value)).toISOString()
    : type === 'Number'
      ? Number(value)
      : value;
  return `<Cell ss:StyleID="${style}"><Data ss:Type="${type}">${xmlEscape(normalized)}</Data></Cell>`;
}

function worksheetXml(
  name: 'Broker' | 'Non-Del',
  rows: PayrollRequestRow[],
  report: PayrollExportReport,
  generatedAt: string,
) {
  const columnCount = columns.length;
  const lastRow = Math.max(rows.length + 5, 6);
  const period = `${report.startDate} through ${report.endDate}`;
  const dataRows = rows.length > 0
    ? rows.map((row, index) => `<Row>${columns.map((column) => cellXml(column, row, index)).join('')}</Row>`).join('')
    : `<Row><Cell ss:StyleID="Empty" ss:MergeAcross="${columnCount - 1}"><Data ss:Type="String">No ${name} payroll requests were submitted in this date range.</Data></Cell></Row>`;

  return `<Worksheet ss:Name="${name}">
  <Table>
   ${columns.map((column) => `<Column ss:AutoFitWidth="0" ss:Width="${column.width}"/>`).join('')}
   <Row ss:Height="30"><Cell ss:StyleID="Title" ss:MergeAcross="${columnCount - 1}"><Data ss:Type="String">Payroll Export Report — ${name}</Data></Cell></Row>
   <Row ss:Height="22"><Cell ss:StyleID="Subtitle" ss:MergeAcross="${columnCount - 1}"><Data ss:Type="String">Active reporting date range: ${xmlEscape(period)}</Data></Cell></Row>
   <Row ss:Height="20"><Cell ss:StyleID="Generated" ss:MergeAcross="${columnCount - 1}"><Data ss:Type="String">${xmlEscape(`Generated ${generatedAt} • ${rows.length} request${rows.length === 1 ? '' : 's'} • LO-entered and payroll review fields`)}</Data></Cell></Row>
   <Row ss:Height="8">${columns.map(() => '<Cell/>').join('')}</Row>
   <Row ss:Height="34">${columns.map((column) => `<Cell ss:StyleID="Header"><Data ss:Type="String">${xmlEscape(column.label)}</Data></Cell>`).join('')}</Row>
   ${dataRows}
  </Table>
  <WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel">
   <FreezePanes/><FrozenNoSplit/><SplitHorizontal>5</SplitHorizontal><TopRowBottomPane>5</TopRowBottomPane><ActivePane>2</ActivePane>
   <ProtectObjects>False</ProtectObjects><ProtectScenarios>False</ProtectScenarios>
  </WorksheetOptions>
  <AutoFilter x:Range="R5C1:R${lastRow}C${columnCount}" xmlns="urn:schemas-microsoft-com:office:excel"/>
 </Worksheet>`;
}

export function buildPayrollExportWorkbook(report: PayrollExportReport) {
  const generatedAt = report.generatedAt ?? new Date().toISOString();
  const brokerRows = report.rows.filter((row) => row.loanChannel === 'BROKER');
  const nonDelegatedRows = report.rows.filter((row) => row.loanChannel === 'NON_DELEGATED');
  const xml = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal"><Alignment ss:Vertical="Center"/><Font ss:FontName="Aptos" ss:Size="10"/></Style>
  <Style ss:ID="Title"><Font ss:FontName="Aptos Display" ss:Size="18" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#064E3B" ss:Pattern="Solid"/><Alignment ss:Vertical="Center"/></Style>
  <Style ss:ID="Subtitle"><Font ss:FontName="Aptos" ss:Size="10" ss:Bold="1" ss:Color="#065F46"/><Interior ss:Color="#D1FAE5" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Generated"><Font ss:FontName="Aptos" ss:Size="9" ss:Color="#475569"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Header"><Font ss:FontName="Aptos" ss:Size="10" ss:Bold="1" ss:Color="#FFFFFF"/><Interior ss:Color="#059669" ss:Pattern="Solid"/><Alignment ss:WrapText="1" ss:Vertical="Center"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#047857"/></Borders></Style>
  <Style ss:ID="DataEven"><Interior ss:Color="#FFFFFF" ss:Pattern="Solid"/><Alignment ss:Vertical="Top" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#E2E8F0"/></Borders></Style>
  <Style ss:ID="DataOdd"><Interior ss:Color="#F0FDF4" ss:Pattern="Solid"/><Alignment ss:Vertical="Top" ss:WrapText="1"/><Borders><Border ss:Position="Bottom" ss:LineStyle="Continuous" ss:Weight="1" ss:Color="#D1FAE5"/></Borders></Style>
  <Style ss:ID="DataEvenCurrency" ss:Parent="DataEven"><NumberFormat ss:Format="Currency"/></Style>
  <Style ss:ID="DataOddCurrency" ss:Parent="DataOdd"><NumberFormat ss:Format="Currency"/></Style>
  <Style ss:ID="DataEvenNumber" ss:Parent="DataEven"><NumberFormat ss:Format="0"/></Style>
  <Style ss:ID="DataOddNumber" ss:Parent="DataOdd"><NumberFormat ss:Format="0"/></Style>
  <Style ss:ID="DataEvenPercent" ss:Parent="DataEven"><NumberFormat ss:Format="0.00"/></Style>
  <Style ss:ID="DataOddPercent" ss:Parent="DataOdd"><NumberFormat ss:Format="0.00"/></Style>
  <Style ss:ID="DataEvenDate" ss:Parent="DataEven"><NumberFormat ss:Format="mmm d, yyyy"/></Style>
  <Style ss:ID="DataOddDate" ss:Parent="DataOdd"><NumberFormat ss:Format="mmm d, yyyy"/></Style>
  <Style ss:ID="DataEvenDateTime" ss:Parent="DataEven"><NumberFormat ss:Format="mmm d, yyyy h:mm AM/PM"/></Style>
  <Style ss:ID="DataOddDateTime" ss:Parent="DataOdd"><NumberFormat ss:Format="mmm d, yyyy h:mm AM/PM"/></Style>
  <Style ss:ID="Empty"><Font ss:Italic="1" ss:Color="#64748B"/><Interior ss:Color="#F8FAFC" ss:Pattern="Solid"/><Alignment ss:Horizontal="Center" ss:Vertical="Center"/></Style>
 </Styles>
 ${worksheetXml('Broker', brokerRows, report, generatedAt)}
 ${worksheetXml('Non-Del', nonDelegatedRows, report, generatedAt)}
</Workbook>`;

  return {
    content: xml,
    filename: `payroll-export-report-${report.startDate}-to-${report.endDate}.xls`,
    mimeType: 'application/vnd.ms-excel;charset=utf-8',
  };
}

export function downloadPayrollExportReport(report: PayrollExportReport) {
  const workbook = buildPayrollExportWorkbook(report);
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
