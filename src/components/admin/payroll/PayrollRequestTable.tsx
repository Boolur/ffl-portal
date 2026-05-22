'use client';

import React, { useEffect, useMemo, useState, useTransition } from 'react';
import { Check, DollarSign, Edit3, Eye, FileText, Home, Loader2, RefreshCw, Save, UserRound, X } from 'lucide-react';
import { PayrollCompPlanType, PayrollCompRequestStatus, PayrollLeadProvidedBy, PayrollLeadSource, PayrollLoanChannel, PayrollProcessingType, PayrollSplitPayType } from '@prisma/client';
import {
  approvePayrollRequest,
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
  expectedRevenue: string;
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
  PayrollLeadProvidedBy.COMPANY_PROVIDED,
  PayrollLeadProvidedBy.BRANCH_PROVIDED,
];

export function PayrollRequestTable({ rows, compact = false, embedded = false }: Props) {
  const [selectedRequest, setSelectedRequest] = useState<PayrollRequestRow | null>(null);
  const [editMode, setEditMode] = useState(false);
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
    expectedRevenue: '',
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
      expectedRevenue: String(currentRequest.expectedRevenue),
      submitterNotes: currentRequest.submitterNotes ?? '',
      adminNotes: currentRequest.adminNotes ?? '',
      rejectionReason: currentRequest.rejectionReason ?? '',
    });
  }, [currentRequest]);

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
        expectedRevenue: Number(editForm.expectedRevenue),
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
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/70">
              <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Loan</th>
              {!compact && <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Loan Officer</th>}
              <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Lender</th>
              <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Revenue</th>
              <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
              <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Review</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const busy = isPending && busyId === row.id;
              return (
                <React.Fragment key={row.id}>
                  <tr className="hover:bg-slate-50/70">
                    <td className="px-5 py-4">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left"
                        onClick={() => openRequest(row)}
                      >
                        <span>
                          <span className="flex items-center gap-2 font-semibold text-slate-900">
                            {row.loanNumber}
                            {row.editedAt && (
                              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                                Edited
                              </span>
                            )}
                          </span>
                          <span className="block text-xs text-slate-500">{row.borrowerName}</span>
                        </span>
                      </button>
                    </td>
                    {!compact && (
                      <td className="px-5 py-4">
                        <p className="font-medium text-slate-800">{row.loanOfficerName}</p>
                        <p className="text-xs text-slate-500">{row.loanOfficerEmail}</p>
                      </td>
                    )}
                    <td className="px-5 py-4">
                      <p className="font-medium text-slate-800">{row.lender}</p>
                      <p className="text-xs text-slate-500">{loanChannelLabel(row.loanChannel)} · {processingTypeLabel(row.processingType)}</p>
                    </td>
                    <td className="px-5 py-4 text-right font-semibold text-slate-900">{formatCurrency(row.expectedRevenue)}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${payrollStatusClasses(row.status)}`}>
                        {payrollStatusLabel(row.status)}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition hover:bg-blue-700 disabled:opacity-60"
                          disabled={busy}
                          onClick={() => openRequest(row)}
                        >
                          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Eye className="h-3.5 w-3.5" />}
                          Review
                        </button>
                      </div>
                    </td>
                  </tr>
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {currentRequest && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-3xl bg-white shadow-2xl">
            <div className="bg-gradient-to-br from-slate-950 via-blue-950 to-slate-900 px-6 py-5 text-white">
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
                  <p className="mt-1 text-sm text-blue-100">{currentRequest.loanOfficerName} · submitted {formatDate(currentRequest.submittedAt)}</p>
                </div>
              <button type="button" className="app-icon-btn" aria-label="Close request" onClick={() => setSelectedRequest(null)}>
                <X className="h-5 w-5" />
              </button>
              </div>
              <div className="mt-5 grid gap-3 md:grid-cols-4">
                <ReviewMetric label="Loan" value={currentRequest.loanNumber} />
                <ReviewMetric label="Borrower" value={currentRequest.borrowerName} />
                <ReviewMetric label="Revenue" value={formatCurrency(currentRequest.expectedRevenue)} />
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
                  <AdminInput label="Expected Revenue" value={editForm.expectedRevenue} onChange={(value) => setEditForm((current) => ({ ...current, expectedRevenue: value }))} inputMode="decimal" />
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
                      <Detail label="Loan Type" value={currentRequest.loanType} />
                      <Detail label="Lender" value={currentRequest.lender} />
                      <Detail label="Channel" value={loanChannelLabel(currentRequest.loanChannel)} />
                      <Detail label="Processing" value={processingTypeLabel(currentRequest.processingType)} />
                      <Detail label="Lead Source" value={payrollLeadSourceLabel(currentRequest.leadSource)} />
                      <Detail label="Provided By" value={payrollLeadProvidedByLabel(currentRequest.leadProvidedBy)} />
                      <Detail label="Split Type" value={payrollPlanTypeLabel(currentRequest.appliedPlanType)} />
                      <Detail label="Revenue" value={formatCurrency(currentRequest.expectedRevenue)} />
                      <Detail label="Edited" value={formatDate(currentRequest.editedAt)} />
                    </dl>
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

              <div className="flex flex-wrap justify-end gap-3 border-t border-slate-100 pt-5">
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
      )}
    </div>
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
    <div className="rounded-2xl bg-white/10 px-4 py-3 ring-1 ring-white/15">
      <p className="text-[11px] font-bold uppercase tracking-wider text-blue-100">{label}</p>
      <p className="mt-1 truncate text-base font-bold text-white">{value}</p>
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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input
        value={value}
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
        {options.map((option) => (
          <option key={option} value={option}>{labels?.[option] ?? option}</option>
        ))}
      </select>
    </label>
  );
}
