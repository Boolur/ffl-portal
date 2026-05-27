'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { Banknote, Building2, Bug, Calculator, CheckCircle2, Clock, Droplets, DollarSign, Edit3, FileCheck2, FilePlus2, Landmark, Loader2, Megaphone, Percent, Plus, ReceiptText, RefreshCw, Send, ShieldCheck, Upload, WalletCards, Waves, X } from 'lucide-react';
import { PayrollLeadProvidedBy, PayrollLeadSource, PayrollLoanChannel, PayrollProcessingType, PayrollSplitPayType } from '@prisma/client';
import {
  getPayrollRequestPreview,
  submitPayrollCompRequest,
  type PayrollCalculationSnapshot,
  type PayrollMismoDetails,
  type PayrollRequestRow,
} from '@/app/actions/payrollActions';
import {
  formatCurrency,
  formatDate,
  formatPercent,
  payrollStatusClasses,
  payrollStatusLabel,
} from '@/components/admin/payroll/payrollFormat';
import { PAYROLL_LENDER_OPTIONS } from './payrollOptions';

type Props = {
  rows: PayrollRequestRow[];
  summary: {
    totalRequests: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
    paidCount: number;
    submittedRevenue: number;
    pendingRevenue: number;
    approvedRevenue: number;
    paidRevenue: number;
  };
  nextPaycheck?: {
    paycheckDate: string;
    periodStart: string;
    periodEnd: string;
    salaryAmount: number;
    commissionAmount: number;
    totalAmount: number;
  };
};

type FormState = {
  loanNumber: string;
  borrowerName: string;
  loanType: string;
  lender: string;
  loanChannel: PayrollLoanChannel;
  processingType: PayrollProcessingType;
  leadSource: PayrollLeadSource;
  leadProvidedBy: PayrollLeadProvidedBy;
  expectedRevenue: string;
  brokerComp: string;
  brokerPaidBy: 'BORROWER_PAID' | 'LENDER_PAID';
  sectionAComp: string;
  yspAmount: string;
  toleranceCure: string;
  oneDayInterest: string;
  wireFee: string;
  underwritingFee: string;
  lenderCredit: string;
  originationFee: string;
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
  mismoDetails: PayrollMismoDetails | null;
};
type RequiredFieldKey = 'loanNumber' | 'borrowerName' | 'loanType' | 'lender' | 'loanChannel' | 'processingType' | 'leadSource' | 'leadProvidedBy' | 'brokerComp' | 'sectionAComp';

const initialForm: FormState = {
  loanNumber: '',
  borrowerName: '',
  loanType: '',
  lender: '',
  loanChannel: PayrollLoanChannel.BROKER,
  processingType: PayrollProcessingType.IN_HOUSE,
  leadSource: PayrollLeadSource.OTHER,
  leadProvidedBy: PayrollLeadProvidedBy.SELF_SOURCED,
  expectedRevenue: '',
  brokerComp: '',
  brokerPaidBy: 'BORROWER_PAID',
  sectionAComp: '',
  yspAmount: '',
  toleranceCure: '',
  oneDayInterest: '',
  wireFee: '',
  underwritingFee: '',
  lenderCredit: '',
  originationFee: '',
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
  mismoDetails: null,
};
const REQUIRED_FIELDS: Array<{ key: RequiredFieldKey; label: string }> = [
  { key: 'loanNumber', label: 'Arive Loan Number' },
  { key: 'borrowerName', label: "Borrower's Name" },
  { key: 'loanType', label: 'Loan Type' },
  { key: 'lender', label: 'Lender' },
  { key: 'loanChannel', label: 'Broker or Non-Delegated' },
  { key: 'processingType', label: 'Processing Type' },
  { key: 'leadSource', label: 'Lead Source' },
  { key: 'leadProvidedBy', label: 'Lead Provided By' },
  { key: 'brokerComp', label: 'Broker Comp' },
  { key: 'sectionAComp', label: 'Section A' },
];
const LOAN_TYPE_OPTIONS = [
  'Conventional',
  'FHA',
  'VA',
  'Heloc',
  'Heloan',
  'Non QM',
  'Reverse Mortgage',
];
const LOAN_TYPE_OPTION_SET = new Set(LOAN_TYPE_OPTIONS.map((option) => option.toUpperCase()));
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
const LEAD_SOURCE_LABELS: Record<PayrollLeadSource, string> = {
  LEAD_BUY: 'Lead Buy',
  MAILER: 'Mailer',
  WARM_TRANSFER: 'Warm Transfer',
  REFERRAL: 'Referral',
  RETURN_CLIENT: 'Return Client',
  OTHER: 'Other',
};
const LEAD_PROVIDED_BY_LABELS: Record<PayrollLeadProvidedBy, string> = {
  SELF_SOURCED: 'Self Sourced',
  COMPANY_PROVIDED: 'Company Provided',
  BRANCH_PROVIDED: 'Branch Provided',
};
const BROKER_PAID_BY_OPTIONS = [
  { value: 'BORROWER_PAID', label: 'Borrower Paid' },
  { value: 'LENDER_PAID', label: 'Lender Paid' },
] as const;
const MONEY_FIELDS = [
  'brokerComp',
  'sectionAComp',
  'yspAmount',
  'toleranceCure',
  'oneDayInterest',
  'wireFee',
  'underwritingFee',
  'lenderCredit',
  'originationFee',
  'appraisalAddBack',
  'creditAddBack',
  'voeAddBack',
  'termiteAddBack',
  'appraisalReinspectionAddBack',
  'waterTestAddBack',
  'loanAmountPriorToFees',
] as const;
type MoneyField = (typeof MONEY_FIELDS)[number];

function toOptionalNumber(value: string) {
  const cleaned = value.trim();
  if (!cleaned) return null;
  const numeric = Number(cleaned.replace(/[$,\s]/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

function toDeductionNumber(value: string) {
  const numeric = toOptionalNumber(value);
  if (numeric === null) return null;
  return Math.abs(numeric);
}

function buildCompInput(form: FormState) {
  const amounts = Object.fromEntries(
    MONEY_FIELDS.map((field) => [field, toOptionalNumber(form[field])])
  ) as Record<MoneyField, number | null>;
  const deductionAmounts = {
    toleranceCure: toDeductionNumber(form.toleranceCure),
    oneDayInterest: toDeductionNumber(form.oneDayInterest),
    wireFee: toDeductionNumber(form.wireFee),
    underwritingFee: toDeductionNumber(form.underwritingFee),
    lenderCredit: toDeductionNumber(form.lenderCredit),
    originationFee: toDeductionNumber(form.originationFee),
  };
  return {
    ...form,
    ...amounts,
    ...deductionAmounts,
    expectedRevenue: amounts.brokerComp ?? amounts.sectionAComp ?? 0,
    recessionDate: form.recessionDate || null,
    figureNftyAttachmentName: form.figureNftyAttachmentName || null,
    figureNftyAttachmentUrl: form.figureNftyAttachmentName || null,
  };
}

function isFigureNftyLender(lender: string) {
  const normalized = lender.trim().toUpperCase();
  return normalized.includes('FIGURE') || normalized.includes('NFTY');
}

function normalizePayrollLoanType(value: string) {
  const normalized = value.trim().toUpperCase();
  if (!normalized) return '';
  if (normalized.includes('REVERSE') || normalized.includes('HECM')) return 'Reverse Mortgage';
  if (normalized === 'CONVENTIONAL') return 'Conventional';
  if (normalized === 'FHA') return 'FHA';
  if (normalized === 'VA') return 'VA';
  if (normalized === 'HELOC') return 'Heloc';
  if (normalized === 'HELOAN' || normalized === 'HELOAN') return 'Heloan';
  if (normalized === 'NON QM' || normalized === 'NONQM' || normalized === 'NON-QM') return 'Non QM';
  return LOAN_TYPE_OPTION_SET.has(normalized) ? value.trim() : '';
}

type PayrollMismoPrefill = {
  loanNumber?: string;
  borrowerName?: string;
  loanType?: string;
  lender?: string;
  loanChannel?: PayrollLoanChannel;
  mismoDetails?: PayrollMismoDetails;
};

function parsePayrollMismoXml(xmlText: string, sourceFilename?: string): PayrollMismoPrefill {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid XML');
  }

  const getText = (parent: Element | Document | null, localName: string) => {
    if (!parent) return '';
    const el = parent.getElementsByTagNameNS('*', localName)[0];
    return el?.textContent?.trim() ?? '';
  };
  const getTextFromElement = (el: Element | null, localName: string) => {
    if (!el) return '';
    const node = el.getElementsByTagNameNS('*', localName)[0];
    return node?.textContent?.trim() ?? '';
  };
  const getFirstText = (parent: Element | Document | null, localNames: string[]) => {
    for (const localName of localNames) {
      const value = getText(parent, localName);
      if (value) return value;
    }
    return '';
  };
  const toNumber = (value: string) => {
    const numeric = Number(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
  };
  const isGuidLike = (value: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim()
    );
  const extractLoanNumberFromFilename = (filename?: string) => {
    if (!filename) return '';
    const stem = filename.replace(/\.[^/.]+$/, '');
    const allNumericRuns = stem.match(/\d{6,}/g);
    if (!allNumericRuns || allNumericRuns.length === 0) return '';
    return allNumericRuns.sort((a, b) => b.length - a.length).at(0) || '';
  };
  const findPartiesByRole = (roleType: string) =>
    Array.from(doc.getElementsByTagNameNS('*', 'PARTY')).filter((party) =>
      Array.from(party.getElementsByTagNameNS('*', 'PartyRoleType')).some(
        (node) => node.textContent?.trim() === roleType
      )
    );

  const borrowerParty = findPartiesByRole('Borrower')[0] ?? null;
  const borrowerName = [
    getTextFromElement(borrowerParty, 'FirstName'),
    getTextFromElement(borrowerParty, 'LastName'),
  ]
    .filter(Boolean)
    .join(' ');

  const loanIdentifiers = Array.from(doc.getElementsByTagNameNS('*', 'LOAN_IDENTIFIER'));
  const losIdentifierCandidates: string[] = [];
  for (const id of loanIdentifiers) {
    const type = getTextFromElement(id, 'LoanIdentifierType');
    const typeOtherDescription = getTextFromElement(id, 'LoanIdentifierTypeOtherDescription');
    const identifier = getTextFromElement(id, 'LoanIdentifier');
    if (!identifier || isGuidLike(identifier)) continue;
    const isLosIdentifier =
      type === 'UniversalLoan' ||
      (type === 'Other' &&
        /(lwloan|arrive|loan origination system|los)/i.test(typeOtherDescription || ''));
    if (isLosIdentifier) losIdentifierCandidates.push(identifier.trim());
  }

  const fallbackLoanNumber = getFirstText(doc, ['LoanOriginationSystemLoanIdentifier']);
  const loanNumber =
    extractLoanNumberFromFilename(sourceFilename) ||
    losIdentifierCandidates[0] ||
    (!isGuidLike(fallbackLoanNumber) ? fallbackLoanNumber : '');

  const mortgageType = getText(doc, 'MortgageType');
  const normalizedMortgageType = mortgageType.trim().toUpperCase();
  const loanPurposeType = getText(doc, 'LoanPurposeType').trim().toUpperCase();
  const governmentRefinanceType = getText(doc, 'GovernmentRefinanceType').trim().toUpperCase();
  const refinancePrimaryPurposeType = getText(doc, 'RefinancePrimaryPurposeType').trim().toUpperCase();
  const reverseMortgageIndicator = [
    getText(doc, 'ReverseMortgageType'),
    getText(doc, 'HECMIndicator'),
    getText(doc, 'ReverseMortgageIndicator'),
  ]
    .join(' ')
    .toUpperCase();
  const rawLoanType =
    reverseMortgageIndicator.includes('HECM') ||
    reverseMortgageIndicator.includes('REVERSE') ||
    normalizedMortgageType.includes('REVERSE')
      ? 'Reverse Mortgage'
      : ['CONVENTIONAL', 'FHA', 'VA'].includes(normalizedMortgageType)
        ? mortgageType
        : '';

  const loanOriginatorType = getText(doc, 'LoanOriginatorType');
  const loanChannel =
    loanOriginatorType === 'Broker'
      ? PayrollLoanChannel.BROKER
      : loanOriginatorType === 'Correspondent'
        ? PayrollLoanChannel.NON_DELEGATED
        : undefined;

  return {
    loanNumber,
    borrowerName,
    loanType: normalizePayrollLoanType(rawLoanType),
    lender: getText(doc, 'ProductProviderName'),
    loanChannel,
    mismoDetails: {
      propertyAddress: [
        getFirstText(doc, ['AddressLineText', 'AddressLine1Text']),
        getFirstText(doc, ['AddressLine2Text']),
      ].filter(Boolean).join(' '),
      propertyCity: getFirstText(doc, ['CityName']),
      propertyState: getFirstText(doc, ['StateCode']),
      propertyZip: getFirstText(doc, ['PostalCode']),
      loanAmount: toNumber(getFirstText(doc, ['NoteAmount', 'BaseLoanAmount', 'LoanAmount'])),
      homeValue: toNumber(getFirstText(doc, ['PropertyEstimatedValueAmount', 'EstimatedPropertyValueAmount'])),
      purchasePrice: toNumber(getFirstText(doc, ['PurchasePriceAmount', 'SalesContractAmount'])),
      appraisedValue: toNumber(getFirstText(doc, ['PropertyAppraisedValueAmount', 'AppraisedValueAmount'])),
      occupancy: getFirstText(doc, ['OccupancyType']),
      loanPurpose: getFirstText(doc, ['LoanPurposeType']),
      lienPosition: getFirstText(doc, ['LienPriorityType']),
      noteRate: toNumber(getFirstText(doc, ['NoteRatePercent', 'InterestRatePercent'])),
      monthlyPayment: toNumber(getFirstText(doc, ['InitialPrincipalAndInterestPaymentAmount', 'MonthlyPrincipalAndInterestAmount'])),
      borrowerCreditScore: toNumber(getFirstText(doc, ['CreditScoreValue'])),
    },
  };
}

function Kpi({
  title,
  value,
  subtitle,
  Icon,
}: {
  title: string;
  value: string;
  subtitle: string;
  Icon: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{title}</p>
          <p className="mt-2 text-2xl font-bold text-slate-950">{value}</p>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
        <Icon className="h-5 w-5 text-emerald-600" />
      </div>
    </div>
  );
}

function StatsPanel({
  title,
  subtitle,
  rows,
  emptyText,
}: {
  title: string;
  subtitle: string;
  rows: Array<{ label: string; count: number }>;
  emptyText: string;
}) {
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="font-bold text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500">{subtitle}</p>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">
          {emptyText}
        </div>
      ) : (
        <div className="space-y-3 p-5">
          {rows.map((row) => (
            <div key={row.label} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-800">{row.label}</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700">
                  {row.count}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-emerald-500"
                  style={{ width: `${Math.max((row.count / maxCount) * 100, 8)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function PayrollPortal({ rows, summary, nextPaycheck }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [dragActive, setDragActive] = useState(false);
  const [mismoFileName, setMismoFileName] = useState('');
  const [isParsingMismo, setIsParsingMismo] = useState(false);
  const [lenderDropdownOpen, setLenderDropdownOpen] = useState(false);
  const [lenderSearch, setLenderSearch] = useState('');
  const [touchedFields, setTouchedFields] = useState<Set<RequiredFieldKey>>(new Set());
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [preview, setPreview] = useState<{
    calculation: PayrollCalculationSnapshot;
    splits: Array<{
    recipientName: string;
    recipientEmail: string | null;
    roleLabel: string;
    payType: PayrollSplitPayType;
    splitPercent: number;
    flatAmount: number | null;
    amount: number;
    sortOrder: number;
    }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const canPreview = useMemo(() => {
    const base = form.loanChannel === PayrollLoanChannel.BROKER ? form.brokerComp : form.sectionAComp;
    return Number(base) > 0;
  }, [form.brokerComp, form.loanChannel, form.sectionAComp]);
  const figureNftyRequired = useMemo(() => isFigureNftyLender(form.lender), [form.lender]);
  const lenderStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const lender = row.lender.trim() || 'Unknown Lender';
      counts.set(lender, (counts.get(lender) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [rows]);
  const loanTypeStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const loanType = row.loanType.trim() || 'Unknown Loan Type';
      counts.set(loanType, (counts.get(loanType) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [rows]);
  const filteredLenders = useMemo(() => {
    const term = lenderSearch.trim().toLowerCase();
    if (!term) return PAYROLL_LENDER_OPTIONS;
    return PAYROLL_LENDER_OPTIONS.filter((lender) => lender.toLowerCase().includes(term));
  }, [lenderSearch]);
  const missingFields = useMemo(() => {
    return REQUIRED_FIELDS.filter(({ key }) => {
      const value = form[key];
      if (key === 'brokerComp') {
        return form.loanChannel === PayrollLoanChannel.BROKER && (!Number.isFinite(Number(value)) || Number(value) <= 0);
      }
      if (key === 'sectionAComp') {
        return form.loanChannel === PayrollLoanChannel.NON_DELEGATED && (!Number.isFinite(Number(value)) || Number(value) <= 0);
      }
      return !String(value).trim();
    });
  }, [form]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setError(null);
  };
  const markTouched = (key: RequiredFieldKey) => {
    setTouchedFields((current) => new Set(current).add(key));
  };
  const shouldHighlight = (key: RequiredFieldKey) => {
    if (!missingFields.some((field) => field.key === key)) return false;
    return attemptedSubmit || touchedFields.has(key);
  };

  const handleMismoFile = async (file: File | null) => {
    if (!file) return;
    setMismoFileName(file.name);
    setIsParsingMismo(true);
    try {
      const text = await file.text();
      const prefill = parsePayrollMismoXml(text, file.name);
      setForm((current) => ({
        ...current,
        loanNumber: prefill.loanNumber || current.loanNumber,
        borrowerName: prefill.borrowerName || current.borrowerName,
        loanType: prefill.loanType || current.loanType,
        lender: prefill.lender || current.lender,
        loanChannel: prefill.loanChannel || current.loanChannel,
        mismoDetails: prefill.mismoDetails ?? current.mismoDetails,
      }));
      setPreview(null);
      setError(null);
    } catch {
      setError('Could not read this MISMO file. Please verify the XML export.');
    } finally {
      setIsParsingMismo(false);
    }
  };

  const loadPreview = () => {
    startTransition(async () => {
      try {
        setError(null);
        const result = await getPayrollRequestPreview(buildCompInput(form));
        setPreview(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to calculate split preview.');
      }
    });
  };

  const submit = () => {
    setAttemptedSubmit(true);
    if (missingFields.length > 0) {
      setTouchedFields(new Set(REQUIRED_FIELDS.map((field) => field.key)));
      setError(`Please complete: ${missingFields.map((field) => field.label).join(', ')}.`);
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        await submitPayrollCompRequest(buildCompInput(form));
        setForm(initialForm);
        setTouchedFields(new Set());
        setAttemptedSubmit(false);
        setPreview(null);
        setModalOpen(false);
      } catch (err) {
        const message = err instanceof Error && err.message && !err.message.includes('digest')
          ? err.message
          : 'Unable to submit payroll request. Please confirm every required field is filled out and try again.';
        setError(message);
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Kpi title="Submitted" value={formatCurrency(summary.submittedRevenue)} subtitle={`${summary.totalRequests} requests`} Icon={ReceiptText} />
        <Kpi title="Pending" value={String(summary.pendingCount)} subtitle={formatCurrency(summary.pendingRevenue)} Icon={Clock} />
        <Kpi title="Approved" value={String(summary.approvedCount)} subtitle={formatCurrency(summary.approvedRevenue)} Icon={CheckCircle2} />
        <Kpi title="Paid" value={String(summary.paidCount)} subtitle={formatCurrency(summary.paidRevenue)} Icon={Banknote} />
        <Kpi
          title="Next Paycheck"
          value={formatCurrency(nextPaycheck?.totalAmount ?? 0)}
          subtitle={nextPaycheck ? `${formatDate(nextPaycheck.paycheckDate)} · salary ${formatCurrency(nextPaycheck.salaryAmount)} + commission ${formatCurrency(nextPaycheck.commissionAmount)}` : 'Next 1st/16th payroll'}
          Icon={DollarSign}
        />
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Submit a Funded Loan</h2>
          <p className="text-sm text-emerald-800/80">Send accounting the loan details and expected revenue for payroll review.</p>
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
          onClick={() => setModalOpen(true)}
        >
          <Plus className="h-4 w-4" /> Submit Compensation Request
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-bold text-slate-900">My Compensation Requests</h2>
            <p className="text-sm text-slate-500">Track prior submissions and payroll decisions.</p>
          </div>
          {rows.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Banknote className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-slate-700">No compensation requests yet</p>
              <p className="mt-1 text-sm text-slate-500">Your funded loan submissions will appear here.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/70">
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Loan</th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Lender</th>
                    <th className="px-5 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Revenue</th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
                    <th className="px-5 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-slate-50/70">
                      <td className="px-5 py-4">
                        <p className="flex items-center gap-2 font-semibold text-slate-900">
                          {row.loanNumber}
                          {row.editedAt && (
                            <span className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                              <Edit3 className="h-3 w-3" />
                              Edited
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-500">{row.borrowerName}</p>
                      </td>
                      <td className="px-5 py-4 text-slate-700">{row.lender}</td>
                      <td className="px-5 py-4 text-right font-semibold text-slate-900">{formatCurrency(row.expectedRevenue)}</td>
                      <td className="px-5 py-4">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${payrollStatusClasses(row.status)}`}>
                          {payrollStatusLabel(row.status)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-slate-600">{formatDate(row.submittedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="grid gap-5">
          <StatsPanel
            title="Lender Stats"
            subtitle="Funded loans by lender"
            rows={lenderStats}
            emptyText="Lender stats will appear after your first request."
          />
          <StatsPanel
            title="Loan Type Stats"
            subtitle="Funded loans by loan type"
            rows={loanTypeStats}
            emptyText="Loan type stats will appear after your first request."
          />
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/30 p-4 backdrop-blur-sm">
          <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Submit Compensation Request</h2>
                <p className="text-sm text-slate-500">Enter the funded loan details for payroll review.</p>
              </div>
              <button type="button" className="app-icon-btn" aria-label="Close modal" onClick={() => setModalOpen(false)}>
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5 p-6">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragActive(false);
                  void handleMismoFile(event.dataTransfer.files?.[0] || null);
                }}
                className={`rounded-2xl border-2 border-dashed p-5 transition ${
                  dragActive
                    ? 'border-emerald-400 bg-emerald-50'
                    : 'border-emerald-200 bg-gradient-to-br from-emerald-50/80 to-white'
                }`}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                      {isParsingMismo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-900">Drop MISMO</p>
                      <p className="text-sm text-slate-500">
                        Upload MISMO 3.4 XML to fill Arive loan number, borrower, loan type, lender, and channel when available.
                      </p>
                      {(mismoFileName || isParsingMismo) && (
                        <p className="mt-1 text-xs font-semibold text-emerald-700">
                          {isParsingMismo ? 'Importing MISMO file...' : `Imported: ${mismoFileName}`}
                        </p>
                      )}
                    </div>
                  </div>
                  <label className="inline-flex cursor-pointer items-center justify-center rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-bold text-emerald-700 shadow-sm transition hover:bg-emerald-50">
                    Choose XML
                    <input
                      type="file"
                      accept=".xml,text/xml,application/xml"
                      className="hidden"
                      onChange={(event) => {
                        void handleMismoFile(event.target.files?.[0] || null);
                        event.currentTarget.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Input label="Arive Loan Number" value={form.loanNumber} onChange={(value) => update('loanNumber', value)} onBlur={() => markTouched('loanNumber')} error={shouldHighlight('loanNumber')} />
                <Input label="Borrower's Name" value={form.borrowerName} onChange={(value) => update('borrowerName', value)} onBlur={() => markTouched('borrowerName')} error={shouldHighlight('borrowerName')} />
                <label className="block">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${shouldHighlight('loanType') ? 'text-rose-600' : 'text-slate-500'}`}>Loan Type</span>
                  <select
                    value={form.loanType}
                    onChange={(event) => update('loanType', event.target.value)}
                    onBlur={() => markTouched('loanType')}
                    aria-invalid={shouldHighlight('loanType')}
                    className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${
                      shouldHighlight('loanType')
                        ? 'border-rose-300 bg-rose-50 focus:border-rose-500 focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/20'
                    }`}
                  >
                    <option value="">Select loan type...</option>
                    {LOAN_TYPE_OPTIONS.map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                </label>
                <div className="relative">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${shouldHighlight('lender') ? 'text-rose-600' : 'text-slate-500'}`}>Lender</span>
                  <button
                    type="button"
                    onClick={() => {
                      setLenderDropdownOpen((open) => !open);
                      markTouched('lender');
                    }}
                    onBlur={() => markTouched('lender')}
                    aria-invalid={shouldHighlight('lender')}
                    className={`mt-1 flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-sm outline-none focus:ring-2 ${
                      shouldHighlight('lender')
                        ? 'border-rose-300 bg-rose-50 focus:border-rose-500 focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/20'
                    }`}
                  >
                    <span className={form.lender ? 'text-slate-900' : 'text-slate-400'}>
                      {form.lender || 'Select lender...'}
                    </span>
                    <span className="text-slate-400">⌄</span>
                  </button>
                  {lenderDropdownOpen && (
                    <div className="absolute z-[70] mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                      <div className="border-b border-slate-100 p-2">
                        <input
                          value={lenderSearch}
                          onChange={(event) => setLenderSearch(event.target.value)}
                          placeholder="Search lenders..."
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                          autoFocus
                        />
                      </div>
                      <div className="max-h-64 overflow-y-auto py-1">
                        {filteredLenders.length === 0 ? (
                          <p className="px-3 py-3 text-sm text-slate-500">No lenders found.</p>
                        ) : filteredLenders.map((lender) => (
                          <button
                            key={lender}
                            type="button"
                            className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-emerald-50 hover:text-emerald-700 ${
                              form.lender === lender ? 'bg-emerald-50 font-semibold text-emerald-700' : 'text-slate-700'
                            }`}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => {
                              update('lender', lender);
                              markTouched('lender');
                              setLenderSearch('');
                              setLenderDropdownOpen(false);
                            }}
                          >
                            {lender}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
                <label className="block">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${shouldHighlight('loanChannel') ? 'text-rose-600' : 'text-slate-500'}`}>Broker or Non-Delegated</span>
                  <select
                    value={form.loanChannel}
                    onChange={(event) => update('loanChannel', event.target.value as PayrollLoanChannel)}
                    onBlur={() => markTouched('loanChannel')}
                    aria-invalid={shouldHighlight('loanChannel')}
                    className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${
                      shouldHighlight('loanChannel')
                        ? 'border-rose-300 bg-rose-50 focus:border-rose-500 focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/20'
                    }`}
                  >
                    <option value="BROKER">Broker</option>
                    <option value="NON_DELEGATED">Non-Delegated</option>
                  </select>
                </label>
                <label className="block">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${shouldHighlight('processingType') ? 'text-rose-600' : 'text-slate-500'}`}>Processing Type</span>
                  <select
                    value={form.processingType}
                    onChange={(event) => update('processingType', event.target.value as PayrollProcessingType)}
                    onBlur={() => markTouched('processingType')}
                    aria-invalid={shouldHighlight('processingType')}
                    className={`mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 ${
                      shouldHighlight('processingType')
                        ? 'border-rose-300 bg-rose-50 focus:border-rose-500 focus:ring-rose-500/20'
                        : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/20'
                    }`}
                  >
                    <option value="IN_HOUSE">In-House</option>
                    <option value="CONTRACT">Contract</option>
                    <option value="LENDER">Lender</option>
                    <option value="OTHER">Other</option>
                  </select>
                </label>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/70 to-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                      <Calculator className="h-4 w-4 text-emerald-700" />
                      Compensation Before Split
                    </p>
                    <p className="text-sm text-slate-500">These fields calculate the split basis first. Add-backs below are applied after the split.</p>
                  </div>
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-700">Calculate Split</span>
                </div>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {form.loanChannel === PayrollLoanChannel.BROKER ? (
                    <>
                      <Input label="Broker Comp" Icon={DollarSign} value={form.brokerComp} onChange={(value) => update('brokerComp', value)} onBlur={() => markTouched('brokerComp')} error={shouldHighlight('brokerComp')} placeholder="0" inputMode="decimal" currencyPrefix="+$" green />
                      <label className="block">
                        <span className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-900">
                          <WalletCards className="h-4 w-4 text-emerald-700" />
                          Broker Compensation Type
                        </span>
                        <select
                          value={form.brokerPaidBy}
                          onChange={(event) => update('brokerPaidBy', event.target.value as FormState['brokerPaidBy'])}
                          className="mt-1 w-full rounded-xl border border-emerald-200 bg-white px-3 py-3 text-sm font-semibold text-slate-950 shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                        >
                          {BROKER_PAID_BY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <>
                      <Input label="Section A" Icon={Landmark} value={form.sectionAComp} onChange={(value) => update('sectionAComp', value)} onBlur={() => markTouched('sectionAComp')} error={shouldHighlight('sectionAComp')} placeholder="0" inputMode="decimal" currencyPrefix="+$" green />
                      <Input label="YSP (enter as negative)" Icon={DollarSign} value={form.yspAmount} onChange={(value) => update('yspAmount', value)} placeholder="0" inputMode="decimal" helper="Shows negative from the loan file, but payroll treats it as positive comp." currencyPrefix="+$" green />
                    </>
                  )}
                  <Input label="Tolerance Cure" Icon={ShieldCheck} value={form.toleranceCure} onChange={(value) => update('toleranceCure', value)} placeholder="0" inputMode="decimal" currencyPrefix="-$" green />
                  {form.loanChannel === PayrollLoanChannel.NON_DELEGATED && (
                    <>
                      <Input label="1 Day of Interest" Icon={Clock} value={form.oneDayInterest} onChange={(value) => update('oneDayInterest', value)} placeholder="0" inputMode="decimal" currencyPrefix="-$" green />
                      <Input label="Wire Fee" Icon={Waves} value={form.wireFee} onChange={(value) => update('wireFee', value)} placeholder="0" inputMode="decimal" currencyPrefix="-$" green />
                      <Input label="Underwriting Fee" Icon={FileCheck2} value={form.underwritingFee} onChange={(value) => update('underwritingFee', value)} placeholder="0" inputMode="decimal" currencyPrefix="-$" green />
                      <Input label="Lender Credit" Icon={DollarSign} value={form.lenderCredit} onChange={(value) => update('lenderCredit', value)} placeholder="0" inputMode="decimal" currencyPrefix="-$" green />
                      <Input label="Origination Fee" Icon={Percent} value={form.originationFee} onChange={(value) => update('originationFee', value)} placeholder="0" inputMode="decimal" currencyPrefix="-$" green />
                    </>
                  )}
                </div>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/80 to-white p-4">
                <p className="flex items-center gap-2 text-sm font-bold text-slate-900">
                  <FilePlus2 className="h-4 w-4 text-emerald-700" />
                  Post-Split Add-Backs
                </p>
                <p className="text-sm text-slate-600">These are added after the split is calculated, if needed.</p>
                <div className="mt-4 grid gap-4 md:grid-cols-3">
                  <Input label="Appraisal" Icon={Landmark} value={form.appraisalAddBack} onChange={(value) => update('appraisalAddBack', value)} placeholder="0" inputMode="decimal" currencyPrefix="$" green />
                  <Input label="Credit Report" Icon={ReceiptText} value={form.creditAddBack} onChange={(value) => update('creditAddBack', value)} placeholder="0" inputMode="decimal" currencyPrefix="$" green />
                  <Input label="VOE" Icon={FileCheck2} value={form.voeAddBack} onChange={(value) => update('voeAddBack', value)} placeholder="0" inputMode="decimal" currencyPrefix="$" green />
                  <Input label="Termite" Icon={Bug} value={form.termiteAddBack} onChange={(value) => update('termiteAddBack', value)} placeholder="0" inputMode="decimal" currencyPrefix="$" green />
                  <Input label="Appraisal Reinspection" Icon={RefreshCw} value={form.appraisalReinspectionAddBack} onChange={(value) => update('appraisalReinspectionAddBack', value)} placeholder="0" inputMode="decimal" currencyPrefix="$" green />
                  <Input label="Water Test" Icon={Droplets} value={form.waterTestAddBack} onChange={(value) => update('waterTestAddBack', value)} placeholder="0" inputMode="decimal" currencyPrefix="$" green />
                </div>
              </div>

              {figureNftyRequired && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-sm font-bold text-amber-900">Figure/NFTY Required Details</p>
                  <p className="text-sm text-amber-800">These fields are required before this lender can be submitted.</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-3">
                    <Input label="Loan Amount Prior to Fees" value={form.loanAmountPriorToFees} onChange={(value) => update('loanAmountPriorToFees', value)} placeholder="0" inputMode="decimal" helper="Use loan amount prior to fees." />
                    <Input label="Recession Date" value={form.recessionDate} onChange={(value) => update('recessionDate', value)} type="date" />
                    <Input label="Funded/Details Screenshot Name" value={form.figureNftyAttachmentName} onChange={(value) => update('figureNftyAttachmentName', value)} placeholder="Screenshot uploaded/available" />
                  </div>
                </div>
              )}

              <div className="grid gap-4 rounded-2xl border border-emerald-100 bg-gradient-to-br from-emerald-50/90 to-blue-50/70 p-4 md:grid-cols-2">
                <LeadSelect
                  label="Lead Source"
                  Icon={Megaphone}
                  value={form.leadSource}
                  options={LEAD_SOURCE_OPTIONS}
                  labels={LEAD_SOURCE_LABELS}
                  error={shouldHighlight('leadSource')}
                  onBlur={() => markTouched('leadSource')}
                  onChange={(value) => update('leadSource', value as PayrollLeadSource)}
                />
                <LeadSelect
                  label="Lead Provided By"
                  Icon={Building2}
                  value={form.leadProvidedBy}
                  options={LEAD_PROVIDED_BY_OPTIONS}
                  labels={LEAD_PROVIDED_BY_LABELS}
                  error={shouldHighlight('leadProvidedBy')}
                  onBlur={() => markTouched('leadProvidedBy')}
                  onChange={(value) => update('leadProvidedBy', value as PayrollLeadProvidedBy)}
                />
              </div>

              {error && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">
                  {error}
                </div>
              )}

              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-bold text-slate-900">Split Preview</p>
                    <p className="text-sm text-slate-500">Preview is based on your current payroll setup.</p>
                  </div>
                  <button type="button" className="app-btn-secondary" disabled={!canPreview || isPending} onClick={loadPreview}>
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Banknote className="h-4 w-4" />}
                    Preview
                  </button>
                </div>
                {preview && (
                  <div className="mt-4 space-y-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <SummaryPill label="Split Basis" value={formatCurrency(preview.calculation.splitBasisAmount)} tone="blue" />
                      <SummaryPill label="Post-Split Add-Backs" value={formatCurrency(preview.calculation.postSplitAddBackTotal)} tone="emerald" />
                      <SummaryPill label="Final Comp" value={formatCurrency(preview.calculation.netCompAmount)} tone="slate" />
                    </div>
                    {preview.calculation.warnings.length > 0 && (
                      <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                        {preview.calculation.warnings.map((warning) => <p key={warning}>{warning}</p>)}
                      </div>
                    )}
                    <div className="divide-y divide-slate-200 rounded-xl bg-white px-4">
                    {preview.splits.map((split) => (
                      <div key={`${split.recipientEmail ?? split.recipientName}:${split.roleLabel}`} className="flex items-center justify-between gap-4 py-3">
                        <div>
                          <p className="font-semibold text-slate-900">{split.recipientName}</p>
                          <p className="text-xs text-slate-500">
                            {split.roleLabel} · {split.payType !== PayrollSplitPayType.FLAT ? formatPercent(split.splitPercent) : 'Flat fee'}
                            {split.payType !== PayrollSplitPayType.PERCENT && split.flatAmount ? ` + ${formatCurrency(split.flatAmount)}` : ''}
                          </p>
                        </div>
                        <p className="font-bold text-slate-900">{formatCurrency(split.amount)}</p>
                      </div>
                    ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-3 border-t border-slate-100 pt-5">
                <button type="button" className="app-btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white transition hover:bg-emerald-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={isPending}
                  onClick={submit}
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Submit Request
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Input({
  label,
  Icon,
  value,
  onChange,
  onBlur,
  placeholder,
  inputMode,
  helper,
  type = 'text',
  currencyPrefix,
  green = false,
  error = false,
}: {
  label: string;
  Icon?: React.ComponentType<{ className?: string }>;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'];
  helper?: string;
  type?: React.HTMLInputTypeAttribute;
  currencyPrefix?: '$' | '+$' | '-$';
  green?: boolean;
  error?: boolean;
}) {
  return (
    <label className="block">
      <span className={`flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${error ? 'text-rose-600' : green ? 'text-slate-950' : 'text-slate-500'}`}>
        {Icon && <Icon className={`h-4 w-4 ${error ? 'text-rose-600' : green ? 'text-emerald-700' : 'text-slate-400'}`} />}
        {label}
      </span>
      <div className="relative mt-1">
        {currencyPrefix && (
          <span className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold ${
            currencyPrefix === '-$' ? 'text-rose-600' : currencyPrefix === '+$' ? 'text-emerald-700' : 'text-slate-500'
          }`}>
            {currencyPrefix}
          </span>
        )}
        <input
          value={value}
          type={type}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onBlur}
          placeholder={placeholder}
          inputMode={inputMode}
          aria-invalid={error}
          className={`w-full rounded-xl border bg-white py-3 text-sm font-semibold text-slate-950 shadow-sm outline-none focus:ring-2 ${
            currencyPrefix ? 'pl-9 pr-3' : 'px-3'
          } ${
            error
              ? 'border-rose-300 bg-rose-50 focus:border-rose-500 focus:ring-rose-500/20'
              : green
                ? 'border-emerald-200 focus:border-emerald-500 focus:ring-emerald-500/20'
                : 'border-slate-200 focus:border-blue-500 focus:ring-blue-500/20'
          }`}
        />
      </div>
      {helper && <span className={`mt-1 block text-xs ${error ? 'text-rose-600' : 'text-slate-500'}`}>{helper}</span>}
    </label>
  );
}

function SummaryPill({ label, value, tone }: { label: string; value: string; tone: 'blue' | 'emerald' | 'slate' }) {
  const classes = {
    blue: 'border-blue-100 bg-blue-50 text-blue-700',
    emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
    slate: 'border-slate-200 bg-slate-50 text-slate-800',
  }[tone];
  return (
    <div className={`rounded-xl border px-4 py-3 ${classes}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider opacity-80">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function LeadSelect<T extends string>({
  label,
  Icon,
  value,
  options,
  labels,
  onChange,
  onBlur,
  error = false,
}: {
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  value: T;
  options: T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
  onBlur?: () => void;
  error?: boolean;
}) {
  return (
    <label className="block">
      <span className={`mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider ${error ? 'text-rose-600' : 'text-emerald-800'}`}>
        <Icon className="h-4 w-4" />
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        onBlur={onBlur}
        aria-invalid={error}
        className={`w-full rounded-xl border bg-white px-3 py-3 text-sm font-semibold outline-none shadow-sm focus:ring-2 ${
          error
            ? 'border-rose-300 text-rose-700 focus:border-rose-500 focus:ring-rose-500/20'
            : 'border-emerald-200 text-slate-900 focus:border-emerald-500 focus:ring-emerald-500/20'
        }`}
      >
        {options.map((option) => (
          <option key={option} value={option}>{labels[option]}</option>
        ))}
      </select>
    </label>
  );
}
