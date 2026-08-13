'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import { Banknote as BanknoteIcon, Check, DollarSign, Edit3, Eye, FileText, Home, ListFilter, Loader2, RefreshCw, Save, Search, Trash2, UserRound, X } from 'lucide-react';
import { PayrollCompPlanType, PayrollCompRequestStatus, PayrollLeadProvidedBy, PayrollLeadSource, PayrollLoanChannel, PayrollProcessingType, PayrollReimbursementTarget, PayrollSplitPayType } from '@prisma/client';
import {
  approvePayrollRequest,
  deletePayrollRequest,
  editPayrollRequest,
  markPayrollRequestPaid,
  rejectPayrollRequest,
  reopenPayrollRequest,
  type PayrollRequestRow,
} from '@/app/actions/payrollActions';
import {
  formatCurrency,
  formatDate,
  formatPercent,
  loanChannelLabel,
  payrollLeadProvidedByLabel,
  payrollLeadSourceLabel,
  payrollPlanTypeLabel,
  payrollStatusClasses,
  payrollStatusLabel,
  processingTypeLabel,
} from './payrollFormat';

type Props = {
  rows: PayrollRequestRow[];
  compact?: boolean;
  embedded?: boolean;
};
type AdminEditForm = {
  loanNumber: string;
  borrowerName: string;
  loanType: string;
  lender: string;
  loanChannel: PayrollLoanChannel;
  processingType: PayrollProcessingType;
  leadSource: PayrollLeadSource;
  leadProvidedBy: PayrollLeadProvidedBy;
  appliedPlanType: PayrollCompPlanType;
  reimbursementTarget: PayrollReimbursementTarget;
  expectedRevenue: string;
  brokerComp: string;
  sectionAComp: string;
  yspAmount: string;
  toleranceCure: string;
  oneDayInterest: string;
  wireFee: string;
  underwritingFee: string;
  lenderCredit: string;
  originationFee: string;
  processingFee: string;
  appraisalAddBack: string;
  creditAddBack: string;
  voeAddBack: string;
  termiteAddBack: string;
  appraisalReinspectionAddBack: string;
  waterTestAddBack: string;
  loanAmountPriorToFees: string;
  recessionDate: string;
  figureNftyAttachmentName: string;
  submitterNotes: string;
  adminNotes: string;
  rejectionReason: string;
};

const LOAN_TYPE_OPTIONS = [
  'Conventional',
  'FHA',
  'VA',
  'Heloc',
  'Heloan',
  'Non QM',
  'Reverse Mortgage',
];
const LEAD_SOURCE_OPTIONS = [
  PayrollLeadSource.LEAD_BUY,
  PayrollLeadSource.MAILER,
  PayrollLeadSource.WARM_TRANSFER,
  PayrollLeadSource.REFERRAL,
  PayrollLeadSource.RETURN_CLIENT,
  PayrollLeadSource.OTHER,
];
const LEAD_PROVIDED_BY_OPTIONS = [
  PayrollLeadProvidedBy.SELF_SOURCED,
  PayrollLeadProvidedBy.BRANCH_PROVIDED,
];
type PayrollColumnId = 'loan' | 'loanOfficer' | 'fundedAt' | 'loanType' | 'lender' | 'splitBasis' | 'status' | 'submittedAt' | 'review';
type PayrollColumn = {
  id: PayrollColumnId;
  label: string;
  width: number;
  compactWidth?: number;
  align?: 'left' | 'right' | 'center';
  compact?: boolean;
};
type ColumnSort = {
  id: PayrollColumnId;
  direction: 'asc' | 'desc';
};
type ColumnFilterRule = {
  query?: string;
  selected?: string[];
  from?: string;
  to?: string;
  min?: string;
  max?: string;
};

const PAYROLL_WIDTH_STORAGE_KEY = 'ffl:payroll-request-widths-v1';
const PAYROLL_COLUMNS: PayrollColumn[] = [
  { id: 'loan', label: 'Loan', width: 220, compactWidth: 180, compact: true },
  { id: 'loanOfficer', label: 'Loan Officer', width: 220 },
  { id: 'fundedAt', label: 'Funded Date', width: 140, compactWidth: 116, compact: true },
  { id: 'loanType', label: 'Loan Type', width: 150 },
  { id: 'lender', label: 'Lender', width: 210, compactWidth: 165, compact: true },
  { id: 'splitBasis', label: 'Split Basis', width: 140, compactWidth: 120, align: 'right', compact: true },
  { id: 'status', label: 'Status', width: 150, compactWidth: 130, compact: true },
  { id: 'submittedAt', label: 'Submitted', width: 140 },
  { id: 'review', label: 'Review', width: 120, compactWidth: 92, align: 'right', compact: true },
];
const DATE_COLUMN_IDS = new Set<PayrollColumnId>(['fundedAt', 'submittedAt']);
const NUMBER_COLUMN_IDS = new Set<PayrollColumnId>(['splitBasis']);

function numberOrNull(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned.replace(/[$,\s]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function columnRawValue(row: PayrollRequestRow, id: PayrollColumnId): string | number | null {
  if (id === 'loan') return `${row.loanNumber} ${row.borrowerName}`;
  if (id === 'loanOfficer') return row.loanOfficerName;
  if (id === 'fundedAt') return row.fundedAt;
  if (id === 'loanType') return row.loanType;
  if (id === 'lender') return row.lender;
  if (id === 'splitBasis') return row.splitBasisAmount ?? row.expectedRevenue;
  if (id === 'status') return payrollStatusLabel(row.status);
  if (id === 'submittedAt') return row.submittedAt;
  return null;
}

function columnDisplayValue(row: PayrollRequestRow, id: PayrollColumnId) {
  const value = columnRawValue(row, id);
  if (value === null || value === '') return 'Blank';
  if (DATE_COLUMN_IDS.has(id)) return formatDate(String(value));
  if (NUMBER_COLUMN_IDS.has(id)) return formatCurrency(Number(value));
  return String(value);
}

function isColumnFilterActive(rule?: ColumnFilterRule) {
  return Boolean(
    rule?.query?.trim() ||
    rule?.selected?.length ||
    rule?.from ||
    rule?.to ||
    rule?.min ||
    rule?.max,
  );
}

function defaultColumnWidth(column: PayrollColumn, compact: boolean) {
  return compact && column.compactWidth ? column.compactWidth : column.width;
}

export function PayrollRequestTable({ rows, compact = false, embedded = false }: Props) {
  const [selectedRequest, setSelectedRequest] = useState<PayrollRequestRow | null>(null);
  const [editMode, setEditMode] = useState(false);
  const widthStorageKey = compact ? `${PAYROLL_WIDTH_STORAGE_KEY}:compact-v2` : `${PAYROLL_WIDTH_STORAGE_KEY}:full-v2`;
  const [columnWidths, setColumnWidths] = useState<Record<PayrollColumnId, number>>(() => {
    if (typeof window === 'undefined') {
      return Object.fromEntries(PAYROLL_COLUMNS.map((column) => [column.id, defaultColumnWidth(column, compact)])) as Record<PayrollColumnId, number>;
    }
    try {
      const stored = window.localStorage.getItem(widthStorageKey);
      const parsed = stored ? JSON.parse(stored) : {};
      return Object.fromEntries(PAYROLL_COLUMNS.map((column) => [
        column.id,
        typeof parsed[column.id] === 'number' ? parsed[column.id] : defaultColumnWidth(column, compact),
      ])) as Record<PayrollColumnId, number>;
    } catch {
      return Object.fromEntries(PAYROLL_COLUMNS.map((column) => [column.id, defaultColumnWidth(column, compact)])) as Record<PayrollColumnId, number>;
    }
  });
  const [columnSort, setColumnSort] = useState<ColumnSort | null>(null);
  const [columnFilters, setColumnFilters] = useState<Partial<Record<PayrollColumnId, ColumnFilterRule>>>({});
  const [columnMenu, setColumnMenu] = useState<{ id: PayrollColumnId; left: number; top: number } | null>(null);
  const [columnOptionSearch, setColumnOptionSearch] = useState('');
  const [editForm, setEditForm] = useState<AdminEditForm>({
    loanNumber: '',
    borrowerName: '',
    loanType: '',
    lender: '',
    loanChannel: PayrollLoanChannel.BROKER,
    processingType: PayrollProcessingType.IN_HOUSE,
    leadSource: PayrollLeadSource.OTHER,
    leadProvidedBy: PayrollLeadProvidedBy.SELF_SOURCED,
    appliedPlanType: PayrollCompPlanType.BROKER,
    reimbursementTarget: PayrollReimbursementTarget.SELF,
    expectedRevenue: '',
    brokerComp: '',
    sectionAComp: '',
    yspAmount: '',
    toleranceCure: '',
    oneDayInterest: '',
    wireFee: '',
    underwritingFee: '',
    lenderCredit: '',
    originationFee: '',
    processingFee: '',
    appraisalAddBack: '',
    creditAddBack: '',
    voeAddBack: '',
    termiteAddBack: '',
    appraisalReinspectionAddBack: '',
    waterTestAddBack: '',
    loanAmountPriorToFees: '',
    recessionDate: '',
    figureNftyAttachmentName: '',
    submitterNotes: '',
    adminNotes: '',
    rejectionReason: '',
  });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const currentRequest = useMemo(
    () => rows.find((row) => row.id === selectedRequest?.id) ?? selectedRequest,
    [rows, selectedRequest]
  );
  const visibleColumns = useMemo(
    () => PAYROLL_COLUMNS.filter((column) => !compact || column.compact),
    [compact],
  );
  const visibleRows = useMemo(() => {
    const filtered = rows.filter((row) =>
      Object.entries(columnFilters).every(([rawId, rule]) => {
        const id = rawId as PayrollColumnId;
        if (!rule || !isColumnFilterActive(rule)) return true;
        const rawValue = columnRawValue(row, id);
        const displayValue = columnDisplayValue(row, id);
        if (rule.query?.trim() && !displayValue.toLowerCase().includes(rule.query.trim().toLowerCase())) return false;
        if (rule.selected?.length && !rule.selected.includes(displayValue)) return false;
        if (DATE_COLUMN_IDS.has(id)) {
          if (!rawValue) return false;
          const dateValue = String(rawValue).slice(0, 10);
          if (rule.from && dateValue < rule.from) return false;
          if (rule.to && dateValue > rule.to) return false;
        }
        if (NUMBER_COLUMN_IDS.has(id)) {
          const numberValue = typeof rawValue === 'number' ? rawValue : Number(rawValue);
          if (!Number.isFinite(numberValue)) return false;
          if (rule.min && numberValue < Number(rule.min)) return false;
          if (rule.max && numberValue > Number(rule.max)) return false;
        }
        return true;
      }),
    );
    if (!columnSort) return filtered;
    return [...filtered].sort((leftRow, rightRow) => {
      const left = columnRawValue(leftRow, columnSort.id);
      const right = columnRawValue(rightRow, columnSort.id);
      if (left === right) return 0;
      if (left === null || left === '') return 1;
      if (right === null || right === '') return -1;
      let comparison: number;
      if (DATE_COLUMN_IDS.has(columnSort.id)) {
        comparison = new Date(String(left)).getTime() - new Date(String(right)).getTime();
      } else if (NUMBER_COLUMN_IDS.has(columnSort.id) || typeof left === 'number' || typeof right === 'number') {
        comparison = Number(left) - Number(right);
      } else {
        comparison = String(left).localeCompare(String(right), undefined, {
          numeric: true,
          sensitivity: 'base',
        });
      }
      return columnSort.direction === 'asc' ? comparison : -comparison;
    });
  }, [columnFilters, columnSort, rows]);
  const activeColumnRule = columnMenu ? columnFilters[columnMenu.id] || {} : {};
  const activeColumnLabel = columnMenu
    ? PAYROLL_COLUMNS.find((column) => column.id === columnMenu.id)?.label || columnMenu.id
    : '';
  const columnValueOptions = useMemo(() => {
    if (!columnMenu || DATE_COLUMN_IDS.has(columnMenu.id) || NUMBER_COLUMN_IDS.has(columnMenu.id)) return [];
    return Array.from(new Set(rows.map((row) => columnDisplayValue(row, columnMenu.id))))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: 'base' }));
  }, [columnMenu, rows]);
  const tableWidth = visibleColumns.reduce((sum, column) => sum + (columnWidths[column.id] || defaultColumnWidth(column, compact)), 0);

  useEffect(() => {
    if (!currentRequest) return;
    setSelectedRequest(currentRequest);
    setEditForm({
      loanNumber: currentRequest.loanNumber,
      borrowerName: currentRequest.borrowerName,
      loanType: currentRequest.loanType,
      lender: currentRequest.lender,
      loanChannel: currentRequest.loanChannel,
      processingType: currentRequest.processingType,
      leadSource: currentRequest.leadSource,
      leadProvidedBy: currentRequest.leadProvidedBy,
      appliedPlanType: currentRequest.appliedPlanType,
      reimbursementTarget: currentRequest.reimbursementTarget,
      expectedRevenue: String(currentRequest.expectedRevenue),
      brokerComp: currentRequest.brokerComp ? String(currentRequest.brokerComp) : '',
      sectionAComp: currentRequest.sectionAComp ? String(currentRequest.sectionAComp) : '',
      yspAmount: currentRequest.yspAmount ? String(currentRequest.yspAmount) : '',
      toleranceCure: currentRequest.toleranceCure ? String(currentRequest.toleranceCure) : '',
      oneDayInterest: currentRequest.oneDayInterest ? String(currentRequest.oneDayInterest) : '',
      wireFee: currentRequest.wireFee ? String(currentRequest.wireFee) : '',
      underwritingFee: currentRequest.underwritingFee ? String(currentRequest.underwritingFee) : '',
      lenderCredit: currentRequest.lenderCredit ? String(currentRequest.lenderCredit) : '',
      originationFee: currentRequest.originationFee ? String(currentRequest.originationFee) : '',
      processingFee: currentRequest.processingFee ? String(currentRequest.processingFee) : '',
      appraisalAddBack: currentRequest.appraisalAddBack ? String(currentRequest.appraisalAddBack) : '',
      creditAddBack: currentRequest.creditAddBack ? String(currentRequest.creditAddBack) : '',
      voeAddBack: currentRequest.voeAddBack ? String(currentRequest.voeAddBack) : '',
      termiteAddBack: currentRequest.termiteAddBack ? String(currentRequest.termiteAddBack) : '',
      appraisalReinspectionAddBack: currentRequest.appraisalReinspectionAddBack ? String(currentRequest.appraisalReinspectionAddBack) : '',
      waterTestAddBack: currentRequest.waterTestAddBack ? String(currentRequest.waterTestAddBack) : '',
      loanAmountPriorToFees: currentRequest.loanAmountPriorToFees ? String(currentRequest.loanAmountPriorToFees) : '',
      recessionDate: currentRequest.recessionDate ? currentRequest.recessionDate.slice(0, 10) : '',
      figureNftyAttachmentName: currentRequest.figureNftyAttachmentName ?? '',
      submitterNotes: currentRequest.submitterNotes ?? '',
      adminNotes: currentRequest.adminNotes ?? '',
      rejectionReason: currentRequest.rejectionReason ?? '',
    });
  }, [currentRequest]);
  useEffect(() => {
    window.localStorage.setItem(widthStorageKey, JSON.stringify(columnWidths));
  }, [columnWidths, widthStorageKey]);
  useEffect(() => {
    if (!columnMenu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-payroll-column-menu-panel]') || target?.closest('[data-payroll-column-menu-trigger]')) return;
      setColumnMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setColumnMenu(null);
    };
    window.addEventListener('pointerdown', closeOnPointerDown);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOnPointerDown);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [columnMenu]);

  const openColumnMenu = (id: PayrollColumnId, button: HTMLButtonElement) => {
    if (id === 'review') return;
    if (columnMenu?.id === id) {
      setColumnMenu(null);
      return;
    }
    const rect = button.getBoundingClientRect();
    setColumnOptionSearch(columnFilters[id]?.query || '');
    setColumnMenu({
      id,
      left: Math.min(rect.left, window.innerWidth - 340),
      top: rect.bottom + 8,
    });
  };
  const resizeColumn = (id: PayrollColumnId, width: number) => {
    setColumnWidths((current) => ({ ...current, [id]: Math.round(width) }));
  };
  const updateColumnFilter = (id: PayrollColumnId, patch: Partial<ColumnFilterRule>) => {
    setColumnFilters((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };
  const clearColumnFilter = (id: PayrollColumnId) => {
    setColumnFilters((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  };

  const runAction = (id: string, action: () => Promise<void>) => {
    setBusyId(id);
    startTransition(async () => {
      try {
        await action();
      } finally {
        setBusyId(null);
      }
    });
  };
  const openRequest = (row: PayrollRequestRow) => {
    setSelectedRequest(row);
    setEditMode(false);
  };
  const deleteRequest = () => {
    if (!currentRequest) return;
    const confirmed = window.confirm(`Delete payroll request ${currentRequest.loanNumber} for ${currentRequest.borrowerName}? This cannot be undone.`);
    if (!confirmed) return;
    runAction(currentRequest.id, async () => {
      await deletePayrollRequest(currentRequest.id);
      setSelectedRequest(null);
      setEditMode(false);
    });
  };
  const saveEdits = () => {
    if (!currentRequest) return;
    runAction(currentRequest.id, () =>
      editPayrollRequest({
        requestId: currentRequest.id,
        loanNumber: editForm.loanNumber,
        borrowerName: editForm.borrowerName,
        loanType: editForm.loanType,
        lender: editForm.lender,
        loanChannel: editForm.loanChannel,
        processingType: editForm.processingType,
        leadSource: editForm.leadSource,
        leadProvidedBy: editForm.leadProvidedBy,
        appliedPlanType: editForm.appliedPlanType,
        reimbursementTarget: editForm.reimbursementTarget,
        expectedRevenue: Number(editForm.expectedRevenue),
        brokerComp: numberOrNull(editForm.brokerComp),
        sectionAComp: numberOrNull(editForm.sectionAComp),
        yspAmount: numberOrNull(editForm.yspAmount),
        toleranceCure: numberOrNull(editForm.toleranceCure),
        oneDayInterest: numberOrNull(editForm.oneDayInterest),
        wireFee: numberOrNull(editForm.wireFee),
        underwritingFee: numberOrNull(editForm.underwritingFee),
        lenderCredit: numberOrNull(editForm.lenderCredit),
        originationFee: numberOrNull(editForm.originationFee),
        processingFee: numberOrNull(editForm.processingFee),
        appraisalAddBack: numberOrNull(editForm.appraisalAddBack),
        creditAddBack: numberOrNull(editForm.creditAddBack),
        voeAddBack: numberOrNull(editForm.voeAddBack),
        termiteAddBack: numberOrNull(editForm.termiteAddBack),
        appraisalReinspectionAddBack: numberOrNull(editForm.appraisalReinspectionAddBack),
        waterTestAddBack: numberOrNull(editForm.waterTestAddBack),
        loanAmountPriorToFees: numberOrNull(editForm.loanAmountPriorToFees),
        recessionDate: editForm.recessionDate || null,
        figureNftyAttachmentName: editForm.figureNftyAttachmentName || null,
        submitterNotes: editForm.submitterNotes,
        adminNotes: editForm.adminNotes,
      })
    );
    setEditMode(false);
  };

  if (rows.length === 0) {
    return (
      <div className={`${embedded ? 'px-6 py-14' : 'rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-14'} text-center`}>
        <DollarSign className="mx-auto h-10 w-10 text-slate-300" />
        <p className="mt-3 text-sm font-semibold text-slate-700">No payroll requests yet</p>
        <p className="mt-1 text-sm text-slate-500">Submitted compensation requests will appear here.</p>
      </div>
    );
  }

  return (
    <div className={embedded ? 'overflow-hidden' : 'overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm'}>
      <div className="overflow-x-auto">
        <table className="table-fixed text-sm" style={{ width: compact ? '100%' : tableWidth }}>
          <colgroup>
            {visibleColumns.map((column) => (
              <col key={column.id} style={{ width: columnWidths[column.id] || defaultColumnWidth(column, compact) }} />
            ))}
          </colgroup>
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70">
              {visibleColumns.map((column) => (
                <ResizablePayrollHeader
                  key={column.id}
                  column={column}
                  width={columnWidths[column.id] || defaultColumnWidth(column, compact)}
                  active={columnMenu?.id === column.id || columnSort?.id === column.id || isColumnFilterActive(columnFilters[column.id])}
                  onOpenMenu={openColumnMenu}
                  onResize={resizeColumn}
                />
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleRows.map((row) => {
              const busy = isPending && busyId === row.id;
              return (
                <React.Fragment key={row.id}>
                  <tr className="hover:bg-slate-50/70">
                    {visibleColumns.map((column) => (
                      <PayrollCell key={column.id} column={column} row={row} busy={busy} onOpen={openRequest} />
                    ))}
                  </tr>
                </React.Fragment>
              );
            })}
            {visibleRows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-6 py-14 text-center text-sm font-medium text-slate-500">
                  No payroll requests match the current column filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {columnMenu && (
        <ColumnOptionsMenu
          id={columnMenu.id}
          label={activeColumnLabel}
          top={columnMenu.top}
          left={columnMenu.left}
          rule={activeColumnRule}
          options={columnValueOptions}
          optionSearch={columnOptionSearch}
          sort={columnSort}
          onSearchOptions={setColumnOptionSearch}
          onSort={(direction) => setColumnSort({ id: columnMenu.id, direction })}
          onFilter={(patch) => updateColumnFilter(columnMenu.id, patch)}
          onClear={() => {
            clearColumnFilter(columnMenu.id);
            if (columnSort?.id === columnMenu.id) setColumnSort(null);
            setColumnOptionSearch('');
          }}
          onClose={() => setColumnMenu(null)}
        />
      )}
      {currentRequest && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="border-b border-slate-200 bg-gradient-to-br from-white via-slate-50 to-slate-100 px-6 py-5 text-slate-950">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-xl font-bold">Payroll Request Review</h2>
                    <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${payrollStatusClasses(currentRequest.status)} bg-white`}>
                      {payrollStatusLabel(currentRequest.status)}
                    </span>
                    {currentRequest.editedAt && (
                      <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700">
                        Edited
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-slate-500">{currentRequest.loanOfficerName} · submitted {formatDate(currentRequest.submittedAt)}</p>
                </div>
              <button type="button" className="app-icon-btn" aria-label="Close request" onClick={() => setSelectedRequest(null)}>
                <X className="h-5 w-5" />
              </button>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <ReviewMetric label="Loan" value={currentRequest.loanNumber} />
                <ReviewMetric label="Borrower" value={currentRequest.borrowerName} />
                <ReviewMetric label="Funded Date" value={formatDate(currentRequest.fundedAt)} />
                <ReviewMetric label="Split Basis" value={formatCurrency(currentRequest.splitBasisAmount ?? currentRequest.expectedRevenue)} />
                <ReviewMetric label="Final Comp" value={formatCurrency(currentRequest.netCompAmount ?? currentRequest.expectedRevenue)} />
                <ReviewMetric label="Split Type" value={payrollPlanTypeLabel(currentRequest.appliedPlanType)} />
              </div>
            </div>

            <div className="space-y-5 p-6">
              {editMode ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <AdminInput label="Arive Loan Number" value={editForm.loanNumber} onChange={(value) => setEditForm((current) => ({ ...current, loanNumber: value }))} />
                  <AdminInput label="Borrower's Name" value={editForm.borrowerName} onChange={(value) => setEditForm((current) => ({ ...current, borrowerName: value }))} />
                  <AdminSelect label="Loan Type" value={editForm.loanType} onChange={(value) => setEditForm((current) => ({ ...current, loanType: value }))} options={LOAN_TYPE_OPTIONS} />
                  <AdminInput label="Lender" value={editForm.lender} onChange={(value) => setEditForm((current) => ({ ...current, lender: value }))} />
                  <AdminSelect label="Broker or Non-Delegated" value={editForm.loanChannel} onChange={(value) => setEditForm((current) => ({ ...current, loanChannel: value as PayrollLoanChannel }))} options={[PayrollLoanChannel.BROKER, PayrollLoanChannel.NON_DELEGATED]} labels={{ BROKER: 'Broker', NON_DELEGATED: 'Non-Delegated' }} />
                  <AdminSelect label="Processing Type" value={editForm.processingType} onChange={(value) => setEditForm((current) => ({ ...current, processingType: value as PayrollProcessingType }))} options={[PayrollProcessingType.IN_HOUSE, PayrollProcessingType.CONTRACT, PayrollProcessingType.LENDER, PayrollProcessingType.OTHER]} labels={{ IN_HOUSE: 'In-House', CONTRACT: 'Contract', LENDER: 'Lender', OTHER: 'Other' }} />
                  <AdminSelect label="Lead Source" value={editForm.leadSource} onChange={(value) => setEditForm((current) => ({ ...current, leadSource: value as PayrollLeadSource }))} options={LEAD_SOURCE_OPTIONS} labels={{ LEAD_BUY: 'Lead Buy', MAILER: 'Mailer', WARM_TRANSFER: 'Warm Transfer', REFERRAL: 'Referral', RETURN_CLIENT: 'Return Client', OTHER: 'Other' }} />
                  <AdminSelect label="Lead Provided By" value={editForm.leadProvidedBy} onChange={(value) => setEditForm((current) => ({ ...current, leadProvidedBy: value as PayrollLeadProvidedBy }))} options={LEAD_PROVIDED_BY_OPTIONS} labels={{ SELF_SOURCED: 'Self Sourced', COMPANY_PROVIDED: 'Company Provided', BRANCH_PROVIDED: 'Branch Provided' }} />
                  <AdminSelect label="Applied Split Type" value={editForm.appliedPlanType} onChange={(value) => setEditForm((current) => ({ ...current, appliedPlanType: value as PayrollCompPlanType }))} options={[PayrollCompPlanType.BROKER, PayrollCompPlanType.RETAIL]} labels={{ BROKER: 'Broker Split', RETAIL: 'Retail Split' }} />
                  <AdminSelect label="Reimbursement To" value={editForm.reimbursementTarget} onChange={(value) => setEditForm((current) => ({ ...current, reimbursementTarget: value as PayrollReimbursementTarget }))} options={[PayrollReimbursementTarget.SELF, PayrollReimbursementTarget.MANAGER]} labels={{ SELF: 'Self Reimbursed', MANAGER: 'Manager' }} />
                  <div className="md:col-span-2 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-sm font-bold text-slate-900">Pre-Split Calculation</p>
                    <div className="mt-3 grid gap-4 md:grid-cols-3">
                      {editForm.loanChannel === PayrollLoanChannel.BROKER ? (
                        <AdminInput label="Broker Comp" value={editForm.brokerComp} onChange={(value) => setEditForm((current) => ({ ...current, brokerComp: value }))} inputMode="decimal" />
                      ) : (
                        <AdminInput label="Section A" value={editForm.sectionAComp} onChange={(value) => setEditForm((current) => ({ ...current, sectionAComp: value }))} inputMode="decimal" />
                      )}
                      <AdminInput label="YSP (+ deducts / - adds)" value={editForm.yspAmount} onChange={(value) => setEditForm((current) => ({ ...current, yspAmount: value }))} inputMode="decimal" />
                      <AdminInput label="Tolerance Cure" value={editForm.toleranceCure} onChange={(value) => setEditForm((current) => ({ ...current, toleranceCure: value }))} inputMode="decimal" />
                      <AdminInput label="1 Day Interest" value={editForm.oneDayInterest} onChange={(value) => setEditForm((current) => ({ ...current, oneDayInterest: value }))} inputMode="decimal" />
                      <AdminInput label="Wire Fee" value={editForm.wireFee} onChange={(value) => setEditForm((current) => ({ ...current, wireFee: value }))} inputMode="decimal" />
                      <AdminInput label="Underwriting Fee" value={editForm.underwritingFee} onChange={(value) => setEditForm((current) => ({ ...current, underwritingFee: value }))} inputMode="decimal" />
                      <AdminInput label="Lender Credit" value={editForm.lenderCredit} onChange={(value) => setEditForm((current) => ({ ...current, lenderCredit: value }))} inputMode="decimal" />
                      <AdminInput label="Origination Fee" value={editForm.originationFee} onChange={(value) => setEditForm((current) => ({ ...current, originationFee: value }))} inputMode="decimal" />
                      <AdminInput label="Processing Fee" value={editForm.processingFee} onChange={(value) => setEditForm((current) => ({ ...current, processingFee: value }))} inputMode="decimal" />
                    </div>
                  </div>
                  <div className="md:col-span-2 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
                    <p className="text-sm font-bold text-slate-900">Post-Split Add-Backs</p>
                    <div className="mt-3 grid gap-4 md:grid-cols-3">
                      <AdminInput label="Appraisal" value={editForm.appraisalAddBack} onChange={(value) => setEditForm((current) => ({ ...current, appraisalAddBack: value }))} inputMode="decimal" />
                      <AdminInput label="Credit" value={editForm.creditAddBack} onChange={(value) => setEditForm((current) => ({ ...current, creditAddBack: value }))} inputMode="decimal" />
                      <AdminInput label="VOE" value={editForm.voeAddBack} onChange={(value) => setEditForm((current) => ({ ...current, voeAddBack: value }))} inputMode="decimal" />
                      <AdminInput label="Termite" value={editForm.termiteAddBack} onChange={(value) => setEditForm((current) => ({ ...current, termiteAddBack: value }))} inputMode="decimal" />
                      <AdminInput label="Appraisal Reinspection" value={editForm.appraisalReinspectionAddBack} onChange={(value) => setEditForm((current) => ({ ...current, appraisalReinspectionAddBack: value }))} inputMode="decimal" />
                      <AdminInput label="Water Test" value={editForm.waterTestAddBack} onChange={(value) => setEditForm((current) => ({ ...current, waterTestAddBack: value }))} inputMode="decimal" />
                    </div>
                  </div>
                  <div className="md:col-span-2 rounded-2xl border border-amber-100 bg-amber-50/60 p-4">
                    <p className="text-sm font-bold text-slate-900">Figure/NFTY Context</p>
                    <div className="mt-3 grid gap-4 md:grid-cols-3">
                      <AdminInput label="Loan Amount Prior to Fees" value={editForm.loanAmountPriorToFees} onChange={(value) => setEditForm((current) => ({ ...current, loanAmountPriorToFees: value }))} inputMode="decimal" />
                      <AdminInput label="Recession Date" value={editForm.recessionDate} onChange={(value) => setEditForm((current) => ({ ...current, recessionDate: value }))} type="date" />
                      <AdminInput label="Attachment Name" value={editForm.figureNftyAttachmentName} onChange={(value) => setEditForm((current) => ({ ...current, figureNftyAttachmentName: value }))} />
                    </div>
                  </div>
                  <AdminInput label="Admin Notes" value={editForm.adminNotes} onChange={(value) => setEditForm((current) => ({ ...current, adminNotes: value }))} />
                  <div className="md:col-span-2">
                    <AdminInput label="LO Notes" value={editForm.submitterNotes} onChange={(value) => setEditForm((current) => ({ ...current, submitterNotes: value }))} />
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
                  <ReviewCard title="Loan & Request Details" Icon={FileText}>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <Detail label="Loan" value={currentRequest.loanNumber} />
                      <Detail label="Borrower" value={currentRequest.borrowerName} />
                      <Detail label="Funded Date" value={formatDate(currentRequest.fundedAt)} />
                      <Detail label="Loan Type" value={currentRequest.loanType} />
                      <Detail label="Lender" value={currentRequest.lender} />
                      <Detail label="Channel" value={loanChannelLabel(currentRequest.loanChannel)} />
                      <Detail label="Processing" value={processingTypeLabel(currentRequest.processingType)} />
                      <Detail label="Lead Source" value={payrollLeadSourceLabel(currentRequest.leadSource)} />
                      <Detail label="Provided By" value={payrollLeadProvidedByLabel(currentRequest.leadProvidedBy)} />
                      <Detail label="Split Type" value={payrollPlanTypeLabel(currentRequest.appliedPlanType)} />
                      <Detail label="Reimbursement To" value={currentRequest.reimbursementTarget === PayrollReimbursementTarget.MANAGER ? 'Manager' : 'Self Reimbursed'} />
                      <Detail label="Split Basis" value={formatCurrency(currentRequest.splitBasisAmount ?? currentRequest.expectedRevenue)} />
                      <Detail label="Final Comp" value={formatCurrency(currentRequest.netCompAmount ?? currentRequest.expectedRevenue)} />
                      <Detail label="Edited" value={formatDate(currentRequest.editedAt)} />
                    </dl>
                  </ReviewCard>
                  <ReviewCard title="Compensation Calculation" Icon={BanknoteIcon}>
                    <CalculationDetails request={currentRequest} />
                  </ReviewCard>
                  <ReviewCard title="Loan Officer" Icon={UserRound}>
                    <dl className="grid grid-cols-2 gap-3 text-sm">
                      <Detail label="Name" value={currentRequest.loanOfficerName} />
                      <Detail label="Email" value={currentRequest.loanOfficerEmail} />
                      <Detail label="Submitted" value={formatDate(currentRequest.submittedAt)} />
                      <Detail label="Reviewed" value={formatDate(currentRequest.reviewedAt)} />
                      <Detail label="Paid" value={formatDate(currentRequest.paidAt)} />
                    </dl>
                  </ReviewCard>
                  <ReviewCard title="MISMO Borrower & Property Context" Icon={Home}>
                    <MismoDetails details={currentRequest.mismoDetails} />
                  </ReviewCard>
                  <SplitSnapshot request={currentRequest} />
                  <div className="xl:col-span-2">
                    {(currentRequest.submitterNotes || currentRequest.adminNotes || currentRequest.rejectionReason) && (
                      <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 text-sm text-slate-600">
                        {currentRequest.submitterNotes && <p><span className="font-semibold text-slate-800">LO notes:</span> {currentRequest.submitterNotes}</p>}
                        {currentRequest.adminNotes && <p><span className="font-semibold text-slate-800">Admin notes:</span> {currentRequest.adminNotes}</p>}
                        {currentRequest.rejectionReason && <p><span className="font-semibold text-slate-800">Rejection:</span> {currentRequest.rejectionReason}</p>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-5">
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 text-sm font-semibold text-rose-700 transition hover:bg-rose-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                  onClick={deleteRequest}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete Request
                </button>
                <div className="flex flex-wrap justify-end gap-3">
                  {editMode ? (
                    <>
                      <button type="button" className="app-btn-secondary" onClick={() => setEditMode(false)}>Cancel Edit</button>
                      <button type="button" className="app-btn-primary" disabled={isPending} onClick={saveEdits}>
                        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Save Changes
                      </button>
                    </>
                  ) : (
                    <>
                      {currentRequest.status !== PayrollCompRequestStatus.PAID && (
                        <button type="button" className="app-btn-secondary" onClick={() => setEditMode(true)}>
                          <Edit3 className="h-4 w-4" /> Edit Request
                        </button>
                      )}
                      {currentRequest.status !== PayrollCompRequestStatus.PAID && (
                        <button
                          type="button"
                          className="app-btn-secondary text-rose-700"
                          disabled={isPending}
                          onClick={() => runAction(currentRequest.id, () => rejectPayrollRequest(currentRequest.id, editForm.rejectionReason || 'Rejected by payroll admin', editForm.adminNotes))}
                        >
                          <X className="h-4 w-4" /> Reject
                        </button>
                      )}
                      {currentRequest.status === PayrollCompRequestStatus.PENDING_REVIEW || currentRequest.status === PayrollCompRequestStatus.REJECTED ? (
                        <button type="button" className="app-btn-primary" disabled={isPending} onClick={() => runAction(currentRequest.id, () => approvePayrollRequest(currentRequest.id, editForm.adminNotes))}>
                          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          Approve
                        </button>
                      ) : null}
                      {currentRequest.status === PayrollCompRequestStatus.APPROVED && (
                        <>
                          <button type="button" className="app-btn-secondary" disabled={isPending} onClick={() => runAction(currentRequest.id, () => reopenPayrollRequest(currentRequest.id))}>
                            <RefreshCw className="h-4 w-4" /> Reopen
                          </button>
                          <button type="button" className="app-btn-primary" disabled={isPending} onClick={() => runAction(currentRequest.id, () => markPayrollRequestPaid(currentRequest.id, editForm.adminNotes))}>
                            <DollarSign className="h-4 w-4" /> Mark Paid
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ResizablePayrollHeader({
  column,
  width,
  active,
  onOpenMenu,
  onResize,
}: {
  column: PayrollColumn;
  width: number;
  active: boolean;
  onOpenMenu: (id: PayrollColumnId, button: HTMLButtonElement) => void;
  onResize: (id: PayrollColumnId, width: number) => void;
}) {
  return (
    <th
      scope="col"
      style={{ width, minWidth: width, maxWidth: width }}
      className={`group/header relative border-b border-r border-slate-200 bg-slate-50 px-3 py-3 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 ${
        column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
      }`}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <div className="min-w-0 flex-1 truncate">{column.label}</div>
        {column.id !== 'review' && (
          <button
            type="button"
            data-payroll-column-menu-trigger
            aria-label={`Sort and filter ${column.label}`}
            title="Sort and filter"
            onClick={(event) => {
              event.stopPropagation();
              onOpenMenu(column.id, event.currentTarget);
            }}
            className={`mr-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              active ? 'bg-blue-100 text-blue-700' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700'
            }`}
          >
            <ListFilter className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <button
        type="button"
        aria-label={`Resize ${column.label} column`}
        title="Drag to resize"
        onPointerDown={(event) => {
          event.preventDefault();
          const startX = event.clientX;
          const startWidth = width;
          const onPointerMove = (moveEvent: PointerEvent) => {
            onResize(column.id, Math.max(72, Math.min(420, startWidth + moveEvent.clientX - startX)));
          };
          const onPointerUp = () => {
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', onPointerUp);
          };
          window.addEventListener('pointermove', onPointerMove);
          window.addEventListener('pointerup', onPointerUp);
        }}
        className="absolute inset-y-0 right-0 w-2 cursor-col-resize touch-none border-0 bg-transparent p-0 opacity-0 transition hover:bg-blue-400/30 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 group-hover/header:opacity-100"
      />
    </th>
  );
}

function PayrollCell({
  column,
  row,
  busy,
  onOpen,
}: {
  column: PayrollColumn;
  row: PayrollRequestRow;
  busy: boolean;
  onOpen: (row: PayrollRequestRow) => void;
}) {
  const align = column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left';
  if (column.id === 'loan') {
    return (
      <td className="border-b border-r border-slate-100 px-5 py-4">
        <button type="button" className="flex min-w-0 items-center gap-2 text-left" onClick={() => onOpen(row)}>
          <span className="min-w-0">
            <span className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="truncate">{row.loanNumber}</span>
              {row.editedAt && (
                <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                  Edited
                </span>
              )}
            </span>
            <span className="block truncate text-xs text-slate-500">{row.borrowerName}</span>
          </span>
        </button>
      </td>
    );
  }
  if (column.id === 'loanOfficer') {
    return (
      <td className="border-b border-r border-slate-100 px-5 py-4">
        <p className="truncate font-medium text-slate-800">{row.loanOfficerName}</p>
        <p className="truncate text-xs text-slate-500">{row.loanOfficerEmail}</p>
      </td>
    );
  }
  if (column.id === 'lender') {
    return (
      <td className="border-b border-r border-slate-100 px-5 py-4">
        <p className="truncate font-medium text-slate-800">{row.lender}</p>
        <p className="truncate text-xs text-slate-500">{loanChannelLabel(row.loanChannel)} · {processingTypeLabel(row.processingType)}</p>
      </td>
    );
  }
  if (column.id === 'status') {
    return (
      <td className="border-b border-r border-slate-100 px-5 py-4">
        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${payrollStatusClasses(row.status)}`}>
          {payrollStatusLabel(row.status)}
        </span>
      </td>
    );
  }
  if (column.id === 'review') {
    return (
      <td className="border-b border-r border-slate-100 px-5 py-4">
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-60"
            disabled={busy}
            onClick={() => onOpen(row)}
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
            Review
          </button>
        </div>
      </td>
    );
  }
  return (
    <td className={`truncate border-b border-r border-slate-100 px-5 py-4 ${align} ${column.id === 'splitBasis' ? 'font-semibold tabular-nums text-slate-900' : 'font-medium text-slate-700'}`}>
      {columnDisplayValue(row, column.id)}
    </td>
  );
}

function ColumnOptionsMenu({
  id,
  label,
  top,
  left,
  rule,
  options,
  optionSearch,
  sort,
  onSearchOptions,
  onSort,
  onFilter,
  onClear,
  onClose,
}: {
  id: PayrollColumnId;
  label: string;
  top: number;
  left: number;
  rule: ColumnFilterRule;
  options: string[];
  optionSearch: string;
  sort: ColumnSort | null;
  onSearchOptions: (value: string) => void;
  onSort: (direction: 'asc' | 'desc') => void;
  onFilter: (patch: Partial<ColumnFilterRule>) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const visibleOptions = options.filter((option) => option.toLowerCase().includes(optionSearch.trim().toLowerCase()));
  return (
    <div
      data-payroll-column-menu-panel
      role="dialog"
      aria-label={`Sort and filter ${label}`}
      className="fixed z-[90] w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl shadow-slate-400/30"
      style={{ left, top }}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.12em] text-blue-600">Column options</p>
          <h3 className="mt-1 text-sm font-black text-slate-950">{label}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          aria-label="Close column options"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {(['asc', 'desc'] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            onClick={() => onSort(direction)}
            className={`rounded-lg border px-3 py-2 text-xs font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 ${
              sort?.id === id && sort.direction === direction
                ? 'border-blue-300 bg-blue-50 text-blue-800'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {direction === 'asc' ? 'Sort A-Z / Oldest' : 'Sort Z-A / Newest'}
          </button>
        ))}
      </div>

      <div className="mt-4 border-t border-slate-100 pt-4">
        {DATE_COLUMN_IDS.has(id) ? (
          <div className="grid grid-cols-2 gap-2">
            <ColumnFilterInput label="From" type="date" value={rule.from} onChange={(value) => onFilter({ from: value })} />
            <ColumnFilterInput label="To" type="date" value={rule.to} onChange={(value) => onFilter({ to: value })} />
          </div>
        ) : NUMBER_COLUMN_IDS.has(id) ? (
          <div className="grid grid-cols-2 gap-2">
            <ColumnFilterInput label="Minimum" type="number" value={rule.min} onChange={(value) => onFilter({ min: value })} />
            <ColumnFilterInput label="Maximum" type="number" value={rule.max} onChange={(value) => onFilter({ max: value })} />
          </div>
        ) : (
          <>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <span className="sr-only">Search {label}</span>
              <input
                autoFocus
                value={rule.query || ''}
                onChange={(event) => {
                  onSearchOptions(event.target.value);
                  onFilter({ query: event.target.value });
                }}
                placeholder={`Search ${label.toLowerCase()}...`}
                className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm font-semibold text-slate-700 outline-none focus:border-blue-300 focus:bg-white focus:ring-4 focus:ring-blue-100"
              />
            </label>
            <div className="mt-3 max-h-52 space-y-1 overflow-y-auto pr-1">
              {visibleOptions.map((option) => {
                const selected = rule.selected?.includes(option) ?? false;
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onFilter({
                      selected: selected
                        ? (rule.selected || []).filter((value) => value !== option)
                        : [...(rule.selected || []), option],
                    })}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${selected ? 'border-blue-500 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>
                      {selected && <Check className="h-3.5 w-3.5" />}
                    </span>
                    <span className="truncate">{option}</span>
                  </button>
                );
              })}
              {visibleOptions.length === 0 && (
                <p className="px-2 py-4 text-center text-xs font-medium text-slate-400">No options found.</p>
              )}
            </div>
          </>
        )}
      </div>
      <div className="mt-4 flex justify-between border-t border-slate-100 pt-3">
        <button type="button" onClick={onClear} className="text-xs font-bold text-slate-500 hover:text-slate-800">
          Clear column
        </button>
        <button type="button" onClick={onClose} className="text-xs font-bold text-blue-600 hover:text-blue-800">
          Done
        </button>
      </div>
    </div>
  );
}

function ColumnFilterInput({
  label,
  value,
  onChange,
  type = 'text',
}: {
  label: string;
  value: string | number | undefined;
  onChange: (value: string) => void;
  type?: 'text' | 'date' | 'number';
}) {
  return (
    <label>
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
      />
    </label>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-800">{value}</dd>
    </div>
  );
}

function ReviewMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 truncate text-base font-bold text-slate-950">{value}</p>
    </div>
  );
}

function ReviewCard({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <Icon className="h-4 w-4" />
        </span>
        <p className="font-bold text-slate-900">{title}</p>
      </div>
      {children}
    </section>
  );
}

function MismoDetails({ details }: { details: PayrollRequestRow['mismoDetails'] }) {
  if (!details || Object.keys(details).length === 0) {
    return <p className="rounded-xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No MISMO detail context was captured for this request.</p>;
  }
  const rows = [
    ['Address', [details.propertyAddress, details.propertyCity, details.propertyState, details.propertyZip].filter(Boolean).join(', ')],
    ['Loan Amount', details.loanAmount ? formatCurrency(details.loanAmount) : 'Not captured'],
    ['Home Value', details.homeValue ? formatCurrency(details.homeValue) : 'Not captured'],
    ['Purchase Price', details.purchasePrice ? formatCurrency(details.purchasePrice) : 'Not captured'],
    ['Appraised Value', details.appraisedValue ? formatCurrency(details.appraisedValue) : 'Not captured'],
    ['Occupancy', details.occupancy || 'Not captured'],
    ['Purpose', details.loanPurpose || 'Not captured'],
    ['Lien Position', details.lienPosition || 'Not captured'],
    ['Note Rate', details.noteRate ? `${details.noteRate}%` : 'Not captured'],
    ['Monthly Payment', details.monthlyPayment ? formatCurrency(details.monthlyPayment) : 'Not captured'],
    ['Credit Score', details.borrowerCreditScore ? String(details.borrowerCreditScore) : 'Not captured'],
  ];

  return (
    <dl className="grid grid-cols-2 gap-3 text-sm">
      {rows.map(([label, value]) => (
        <Detail key={label} label={label} value={value} />
      ))}
    </dl>
  );
}

function CalculationDetails({ request }: { request: PayrollRequestRow }) {
  const snapshot = request.calculationSnapshot;
  if (!snapshot) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
        This request was created before the detailed compensation worksheet. Split basis is currently {formatCurrency(request.expectedRevenue)}.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        <MiniMetric label="Split Basis" value={formatCurrency(snapshot.splitBasisAmount)} />
        <MiniMetric label="Post-Split Add-Backs" value={formatCurrency(snapshot.postSplitAddBackTotal)} />
        <MiniMetric label="Final Comp" value={formatCurrency(snapshot.netCompAmount)} />
      </div>
      {snapshot.warnings.length > 0 && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700">
          {snapshot.warnings.map((warning) => <p key={warning}>{warning}</p>)}
        </div>
      )}
      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {snapshot.lines.map((line) => (
          <div key={`${line.stage}:${line.key}`} className="flex items-start justify-between gap-3 p-3 text-sm">
            <div>
              <p className="font-semibold text-slate-900">{line.label}</p>
              <p className="text-xs text-slate-500">
                {line.stage === 'POST_SPLIT' ? 'Post-split add-back' : line.stage === 'MISSING_FEE' ? 'Required fee check' : line.stage === 'BASE' ? 'Base comp' : 'Pre-split adjustment'}
                {line.note ? ` · ${line.note}` : ''}
              </p>
            </div>
            <div className="text-right">
              {line.enteredAmount !== null && <p className="text-xs text-slate-500">Entered {formatCurrency(line.enteredAmount)}</p>}
              <p className={`font-bold ${line.calculatedAmount < 0 || line.missing ? 'text-rose-700' : 'text-slate-900'}`}>{formatCurrency(line.calculatedAmount)}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="font-bold text-slate-950">{value}</p>
    </div>
  );
}

function SplitSnapshot({ request }: { request: PayrollRequestRow }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <DollarSign className="h-4 w-4" />
        </span>
        <p className="font-bold text-slate-900">Split Snapshot</p>
      </div>
      <div className="mt-3 divide-y divide-slate-100">
        {request.splits.map((split) => (
          <div key={split.id} className="flex items-center justify-between gap-4 py-2">
            <div>
              <p className="font-medium text-slate-900">{split.recipientName}</p>
              <p className="text-xs text-slate-500">
                {split.roleLabel} · {split.payType !== PayrollSplitPayType.FLAT ? formatPercent(split.splitPercent) : 'Flat fee'}
                {split.payType !== PayrollSplitPayType.PERCENT && split.flatAmount ? ` + ${formatCurrency(split.flatAmount)}` : ''}
              </p>
            </div>
            <p className="font-semibold text-slate-900">{formatCurrency(split.amount)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function AdminInput({
  label,
  value,
  onChange,
  inputMode,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  type?: React.HTMLInputTypeAttribute;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        value={value}
        type={type}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      />
    </label>
  );
}

function AdminSelect({
  label,
  value,
  onChange,
  options,
  labels,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  labels?: Record<string, string>;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
      >
        {value && !options.includes(value) ? (
          <option value={value}>{labels?.[value] ?? value}</option>
        ) : null}
        {options.map((option) => (
          <option key={option} value={option}>{labels?.[option] ?? option}</option>
        ))}
      </select>
    </label>
  );
}
