'use server';

import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import {
  PayrollCompPlanType,
  PayrollCompRequestStatus,
  PayrollFeeRuleKind,
  PayrollLeadProvidedBy,
  PayrollLeadSource,
  PayrollLenderFeeRule,
  PayrollLenderRequirement,
  PayrollLoanChannel,
  PayrollProcessingType,
  PayrollSalaryFrequency,
  PayrollSettingValueType,
  PayrollSplitPayType,
  PayrollUserClassification,
  Prisma,
  UserRole,
} from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { canAccessPayroll } from '@/lib/adminTiers';
import { canAccessPayrollPortal } from '@/lib/payrollPilot';
import { prisma } from '@/lib/prisma';

const PAYROLL_ADMIN_PATHS = [
  '/admin/payroll',
  '/admin/payroll/users',
  '/admin/payroll/requests',
  '/admin/payroll/reporting',
  '/admin/payroll/settings',
];
const PAYROLL_PORTAL_PATH = '/payroll';

export type PayrollCompSplitInput = {
  recipientUserId?: string | null;
  recipientName?: string | null;
  recipientEmail?: string | null;
  roleLabel: string;
  payType?: PayrollSplitPayType;
  splitPercent: number;
  flatAmount?: number | null;
};

export type PayrollCompPlanInput = {
  loanOfficerId: string;
  userClassification?: PayrollUserClassification;
  planType?: PayrollCompPlanType;
  baseSplitPercent: number;
  active?: boolean;
  notes?: string;
  splits: PayrollCompSplitInput[];
};

export type PayrollCompPlanSettingsInput = {
  loanOfficerId: string;
  userClassification: PayrollUserClassification;
  salaryPerPaycheck?: number | null;
  salaryFrequency?: PayrollSalaryFrequency;
  salaryNotes?: string | null;
  brokerPlan: Omit<PayrollCompPlanInput, 'loanOfficerId' | 'userClassification' | 'planType'>;
  retailPlan?: Omit<PayrollCompPlanInput, 'loanOfficerId' | 'userClassification' | 'planType'> | null;
};

export type PayrollMismoDetails = {
  propertyAddress?: string;
  propertyCity?: string;
  propertyState?: string;
  propertyZip?: string;
  loanAmount?: number | null;
  homeValue?: number | null;
  purchasePrice?: number | null;
  appraisedValue?: number | null;
  occupancy?: string;
  loanPurpose?: string;
  lienPosition?: string;
  noteRate?: number | null;
  monthlyPayment?: number | null;
  borrowerCreditScore?: number | null;
};

export type PayrollCompRequestInput = {
  loanNumber: string;
  borrowerName: string;
  loanType: string;
  lender: string;
  loanChannel: PayrollLoanChannel;
  processingType: PayrollProcessingType;
  leadSource: PayrollLeadSource;
  leadProvidedBy: PayrollLeadProvidedBy;
  expectedRevenue?: number;
  brokerComp?: number | null;
  sectionAComp?: number | null;
  yspAmount?: number | null;
  toleranceCure?: number | null;
  oneDayInterest?: number | null;
  wireFee?: number | null;
  underwritingFee?: number | null;
  lenderCredit?: number | null;
  originationFee?: number | null;
  appraisalAddBack?: number | null;
  creditAddBack?: number | null;
  voeAddBack?: number | null;
  termiteAddBack?: number | null;
  appraisalReinspectionAddBack?: number | null;
  waterTestAddBack?: number | null;
  loanAmountPriorToFees?: number | null;
  recessionDate?: string | null;
  figureNftyAttachmentName?: string | null;
  figureNftyAttachmentUrl?: string | null;
  submitterNotes?: string;
  mismoDetails?: PayrollMismoDetails | null;
};

export type PayrollAdminEditRequestInput = PayrollCompRequestInput & {
  requestId: string;
  appliedPlanType: PayrollCompPlanType;
  adminNotes?: string;
};

export type PayrollRequestFilters = {
  status?: PayrollCompRequestStatus | 'ALL';
  loanOfficerId?: string;
  startDate?: string;
  endDate?: string;
  search?: string;
};

export type PayrollReportFilters = {
  startDate?: string;
  endDate?: string;
  loanOfficerId?: string;
  status?: PayrollCompRequestStatus | 'ALL';
};

export type PayrollSplitSnapshot = {
  id: string;
  recipientUserId: string | null;
  recipientName: string;
  recipientEmail: string | null;
  roleLabel: string;
  payType: PayrollSplitPayType;
  splitPercent: number;
  flatAmount: number | null;
  amount: number;
  sortOrder: number;
};

export type PayrollCalculationLine = {
  key: string;
  label: string;
  enteredAmount: number | null;
  calculatedAmount: number;
  stage: 'BASE' | 'PRE_SPLIT' | 'MISSING_FEE' | 'POST_SPLIT';
  treatment: 'BASE' | 'ADD_BACK' | 'DEDUCTION' | 'SATISFIED' | 'INFO';
  required?: boolean;
  missing?: boolean;
  note?: string;
};

export type PayrollCalculationSnapshot = {
  grossCompAmount: number;
  preSplitAddBackTotal: number;
  preSplitDeductionTotal: number;
  splitBasisAmount: number;
  postSplitAddBackTotal: number;
  netCompAmount: number;
  lines: PayrollCalculationLine[];
  warnings: string[];
  requirements: {
    figureNftyRequired: boolean;
    requiresLoanAmountPriorToFees: boolean;
    requiresFundedDetailsAttachment: boolean;
    requiresRecessionDate: boolean;
    recessionBlocksSubmission: boolean;
    recessionEligibleDate: string | null;
  };
};

export type PayrollRequestRow = {
  id: string;
  loanOfficerId: string;
  loanOfficerName: string;
  loanOfficerEmail: string;
  loanNumber: string;
  borrowerName: string;
  loanType: string;
  lender: string;
  loanChannel: PayrollLoanChannel;
  processingType: PayrollProcessingType;
  leadSource: PayrollLeadSource;
  leadProvidedBy: PayrollLeadProvidedBy;
  appliedPlanType: PayrollCompPlanType;
  expectedRevenue: number;
  brokerComp: number | null;
  sectionAComp: number | null;
  yspAmount: number | null;
  toleranceCure: number | null;
  oneDayInterest: number | null;
  wireFee: number | null;
  underwritingFee: number | null;
  lenderCredit: number | null;
  originationFee: number | null;
  appraisalAddBack: number | null;
  creditAddBack: number | null;
  voeAddBack: number | null;
  termiteAddBack: number | null;
  appraisalReinspectionAddBack: number | null;
  waterTestAddBack: number | null;
  loanAmountPriorToFees: number | null;
  recessionDate: string | null;
  figureNftyAttachmentName: string | null;
  figureNftyAttachmentUrl: string | null;
  grossCompAmount: number | null;
  preSplitAddBackTotal: number | null;
  preSplitDeductionTotal: number | null;
  splitBasisAmount: number | null;
  postSplitAddBackTotal: number | null;
  netCompAmount: number | null;
  calculationSnapshot: PayrollCalculationSnapshot | null;
  status: PayrollCompRequestStatus;
  submittedAt: string;
  reviewedAt: string | null;
  paidAt: string | null;
  editedAt: string | null;
  submitterNotes: string | null;
  adminNotes: string | null;
  rejectionReason: string | null;
  mismoDetails: PayrollMismoDetails | null;
  splits: PayrollSplitSnapshot[];
};

export type PayrollSettingsDatabase = {
  settings: Array<{
    id: string;
    key: string;
    label: string;
    description: string | null;
    valueType: PayrollSettingValueType;
    value: string;
    active: boolean;
  }>;
  feeRules: Array<{
    id: string;
    lender: string;
    loanChannel: PayrollLoanChannel | null;
    feeKind: PayrollFeeRuleKind;
    label: string;
    amount: number;
    required: boolean;
    active: boolean;
    notes: string | null;
  }>;
  lenderRequirements: Array<{
    id: string;
    lender: string;
    requiresLoanAmountPriorToFees: boolean;
    requiresFundedDetailsAttachment: boolean;
    requiresRecessionDate: boolean;
    active: boolean;
    notes: string | null;
  }>;
};

export type PayrollUserPlanDetail = {
    id: string;
    planType: PayrollCompPlanType;
    salaryPerPaycheck: number | null;
    salaryFrequency: PayrollSalaryFrequency;
    salaryNotes: string | null;
    baseSplitPercent: number;
    active: boolean;
    notes: string | null;
    updatedAt: string;
    splits: Array<{
      id: string;
      recipientUserId: string | null;
      recipientName: string;
      recipientEmail: string | null;
      roleLabel: string;
      payType: PayrollSplitPayType;
      splitPercent: number;
      flatAmount: number | null;
      sortOrder: number;
    }>;
};

export type PayrollUserPlanRow = {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  userClassification: PayrollUserClassification;
  plan: PayrollUserPlanDetail | null;
  retailPlan: PayrollUserPlanDetail | null;
};

export type PayrollNextPaycheckSummary = {
  paycheckDate: string;
  periodStart: string;
  periodEnd: string;
  salaryAmount: number;
  commissionAmount: number;
  totalAmount: number;
};

type SessionActor = {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  roles: UserRole[];
};

const requestInclude = {
  loanOfficer: { select: { id: true, name: true, email: true } },
  splits: {
    orderBy: { sortOrder: 'asc' as const },
    select: {
      id: true,
      recipientUserId: true,
      recipientName: true,
      recipientEmail: true,
      roleLabel: true,
      payType: true,
      splitPercent: true,
      flatAmount: true,
      amount: true,
      sortOrder: true,
    },
  },
};

function normalizeMismoDetails(details?: PayrollMismoDetails | null): Prisma.InputJsonValue | undefined {
  if (!details) return undefined;
  const cleaned = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined && value !== null && value !== '')
  );
  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

const RETAIL_TRIGGER_LEAD_SOURCES = new Set<PayrollLeadSource>([
  PayrollLeadSource.LEAD_BUY,
  PayrollLeadSource.MAILER,
  PayrollLeadSource.WARM_TRANSFER,
]);
const RETAIL_TRIGGER_PROVIDERS = new Set<PayrollLeadProvidedBy>([
  PayrollLeadProvidedBy.COMPANY_PROVIDED,
  PayrollLeadProvidedBy.BRANCH_PROVIDED,
]);

function normalizeRoleList(role?: string, roles?: string[]): UserRole[] {
  const values = roles && roles.length > 0 ? roles : role ? [role] : [];
  const allowed = new Set(Object.values(UserRole) as string[]);
  return Array.from(new Set(values.filter((value) => allowed.has(value)))) as UserRole[];
}

async function getActor(): Promise<SessionActor | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const roles = normalizeRoleList(session?.user?.role, session?.user?.roles);
  if (!userId || roles.length === 0) return null;
  return {
    userId,
    name: session?.user?.name || 'User',
    email: session?.user?.email || '',
    role: (session?.user?.role as UserRole | undefined) ?? roles[0],
    roles,
  };
}

async function assertPayrollAdmin() {
  const actor = await getActor();
  if (!actor || !canAccessPayroll(actor.roles)) throw new Error('Unauthorized');
  return actor;
}

async function assertPayrollPortalUser() {
  const actor = await getActor();
  if (
    !actor ||
    !canAccessPayrollPortal({
      role: actor.role,
      email: actor.email,
      name: actor.name,
    })
  ) {
    throw new Error('Unauthorized');
  }
  return actor;
}

function revalidatePayroll() {
  for (const path of PAYROLL_ADMIN_PATHS) revalidatePath(path);
  revalidatePath(PAYROLL_PORTAL_PATH);
}

function decimalToNumber(value: Prisma.Decimal | number | string | null | undefined) {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

function money(value: number) {
  return Math.round(value * 100) / 100;
}

function percent(value: number) {
  return Math.round(value * 10000) / 10000;
}

function cleanText(value: string, label: string) {
  const cleaned = value.trim();
  if (!cleaned) throw new Error(`${label} is required.`);
  return cleaned;
}

function ensurePercent(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }
  return percent(value);
}

function ensureMoney(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return money(value);
}

function ensureSignedMoney(value: number | null | undefined, label: string) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a valid amount.`);
  }
  return money(value);
}

function ensureOptionalMoney(value: number | null | undefined, label: string) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be zero or greater.`);
  }
  return money(value);
}

function parseOptionalDate(value?: string | null, label = 'Date') {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid.`);
  return date;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isFigureNftyLender(lender: string) {
  const normalized = lender.trim().toUpperCase();
  return normalized.includes('FIGURE') || normalized.includes('NFTY');
}

function nextPaycheckWindow(now = new Date()): PayrollNextPaycheckSummary {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const paycheckDate = day < 16 ? new Date(year, month, 16) : new Date(year, month + 1, 1);
  const periodStart = day < 16 ? new Date(year, month, 1) : new Date(year, month, 16);
  const periodEnd = paycheckDate;
  return {
    paycheckDate: paycheckDate.toISOString(),
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    salaryAmount: 0,
    commissionAmount: 0,
    totalAmount: 0,
  };
}

function salaryPerPaycheckAmount(amount: number, frequency: PayrollSalaryFrequency) {
  if (amount <= 0) return 0;
  if (frequency === PayrollSalaryFrequency.MONTHLY) return money(amount / 2);
  if (frequency === PayrollSalaryFrequency.ANNUALLY) return money(amount / 24);
  return money(amount);
}

function requiresPercent(payType: PayrollSplitPayType) {
  return payType === PayrollSplitPayType.PERCENT || payType === PayrollSplitPayType.BOTH;
}

function requiresFlatAmount(payType: PayrollSplitPayType) {
  return payType === PayrollSplitPayType.FLAT || payType === PayrollSplitPayType.BOTH;
}

function resolveAppliedPlanType({
  userClassification,
  leadSource,
  leadProvidedBy,
  override,
}: {
  userClassification: PayrollUserClassification;
  leadSource: PayrollLeadSource;
  leadProvidedBy: PayrollLeadProvidedBy;
  override?: PayrollCompPlanType | null;
}) {
  if (override) return override;
  if (userClassification !== PayrollUserClassification.BROKER) return PayrollCompPlanType.BROKER;
  if (RETAIL_TRIGGER_LEAD_SOURCES.has(leadSource) || RETAIL_TRIGGER_PROVIDERS.has(leadProvidedBy)) {
    return PayrollCompPlanType.RETAIL;
  }
  return PayrollCompPlanType.BROKER;
}

function datesFromFilters(filters: PayrollRequestFilters | PayrollReportFilters) {
  const start = filters.startDate ? new Date(`${filters.startDate}T00:00:00`) : null;
  const end = filters.endDate ? new Date(`${filters.endDate}T23:59:59.999`) : null;
  return {
    start: start && !Number.isNaN(start.getTime()) ? start : null,
    end: end && !Number.isNaN(end.getTime()) ? end : null,
  };
}

async function getPayrollRulesForRequest(input: Pick<PayrollCompRequestInput, 'lender' | 'loanChannel'>) {
  const [feeRules, requirement] = await Promise.all([
    prisma.payrollLenderFeeRule.findMany({
      where: {
        lender: { equals: input.lender, mode: 'insensitive' },
        active: true,
        OR: [{ loanChannel: input.loanChannel }, { loanChannel: null }],
      },
    }),
    prisma.payrollLenderRequirement.findFirst({
      where: {
        lender: { equals: input.lender, mode: 'insensitive' },
        active: true,
      },
    }),
  ]);
  return { feeRules, requirement };
}

function missingRequiredFeeLine(
  rule: PayrollLenderFeeRule,
  enteredAmount: number | null,
  key: string
): PayrollCalculationLine {
  const missing = rule.required && (!enteredAmount || enteredAmount <= 0);
  return {
    key,
    label: rule.label,
    enteredAmount,
    calculatedAmount: missing ? -money(decimalToNumber(rule.amount)) : -money(enteredAmount ?? 0),
    stage: 'MISSING_FEE',
    treatment: 'DEDUCTION',
    required: rule.required,
    missing,
    note: missing
      ? `${rule.label} is required for this lender and is reducing the split basis.`
      : `${rule.label} is included in Section A and reduces the split basis.`,
  };
}

function feeAmountForKind(rules: PayrollLenderFeeRule[], kind: PayrollFeeRuleKind) {
  return rules.find((rule) => rule.feeKind === kind && rule.required);
}

function calculatePayrollCompensation(
  input: PayrollCompRequestInput,
  rules: {
    feeRules: PayrollLenderFeeRule[];
    requirement: PayrollLenderRequirement | null;
  },
  now = new Date()
): PayrollCalculationSnapshot {
  const brokerComp = ensureOptionalMoney(input.brokerComp, 'Broker comp');
  const sectionAComp = ensureOptionalMoney(input.sectionAComp, 'Section A');
  const baseAmount = input.loanChannel === PayrollLoanChannel.BROKER
    ? brokerComp
    : sectionAComp;
  if (!baseAmount || baseAmount <= 0) {
    throw new Error(input.loanChannel === PayrollLoanChannel.BROKER ? 'Broker Comp is required.' : 'Section A is required.');
  }

  const yspAmount = input.loanChannel === PayrollLoanChannel.NON_DELEGATED
    ? ensureSignedMoney(input.yspAmount, 'YSP')
    : null;
  if (yspAmount !== null && yspAmount > 0) {
    throw new Error('YSP should be entered as a negative amount because that is how it appears in the loan file.');
  }
  const toleranceCure = ensureOptionalMoney(input.toleranceCure, 'Tolerance cure');
  const oneDayInterest = ensureOptionalMoney(input.oneDayInterest, '1 day of interest');
  const wireFee = ensureOptionalMoney(input.wireFee, 'Wire fee');
  const underwritingFee = ensureOptionalMoney(input.underwritingFee, 'Underwriting fee');
  const lenderCredit = ensureOptionalMoney(input.lenderCredit, 'Lender credit');
  const originationFee = ensureOptionalMoney(input.originationFee, 'Origination fee');
  const appraisalAddBack = ensureOptionalMoney(input.appraisalAddBack, 'Appraisal add-back');
  const creditAddBack = ensureOptionalMoney(input.creditAddBack, 'Credit add-back');
  const voeAddBack = ensureOptionalMoney(input.voeAddBack, 'VOE add-back');
  const termiteAddBack = ensureOptionalMoney(input.termiteAddBack, 'Termite add-back');
  const appraisalReinspectionAddBack = ensureOptionalMoney(input.appraisalReinspectionAddBack, 'Appraisal reinspection add-back');
  const waterTestAddBack = ensureOptionalMoney(input.waterTestAddBack, 'Water test add-back');
  const loanAmountPriorToFees = ensureOptionalMoney(input.loanAmountPriorToFees, 'Loan amount prior to fees');
  const recessionDate = parseOptionalDate(input.recessionDate, 'Recession date');

  const lines: PayrollCalculationLine[] = [
    {
      key: input.loanChannel === PayrollLoanChannel.BROKER ? 'brokerComp' : 'sectionAComp',
      label: input.loanChannel === PayrollLoanChannel.BROKER ? 'Broker Comp' : 'Section A',
      enteredAmount: baseAmount,
      calculatedAmount: baseAmount,
      stage: 'BASE',
      treatment: 'BASE',
      required: true,
    },
  ];
  if (yspAmount !== null && yspAmount < 0) {
    lines.push({
      key: 'yspAmount',
      label: 'YSP Credit / Additional Comp',
      enteredAmount: yspAmount,
      calculatedAmount: Math.abs(yspAmount),
      stage: 'PRE_SPLIT',
      treatment: 'ADD_BACK',
      note: 'Displayed as negative from the loan file, treated as positive compensation.',
    });
  }
  if (toleranceCure) {
    lines.push({ key: 'toleranceCure', label: 'Tolerance Cure', enteredAmount: toleranceCure, calculatedAmount: -toleranceCure, stage: 'PRE_SPLIT', treatment: 'DEDUCTION' });
  }
  if (oneDayInterest) {
    lines.push({ key: 'oneDayInterest', label: '1 Day of Interest', enteredAmount: oneDayInterest, calculatedAmount: -oneDayInterest, stage: 'PRE_SPLIT', treatment: 'DEDUCTION' });
  }
  if (lenderCredit) {
    lines.push({ key: 'lenderCredit', label: 'Lender Credit', enteredAmount: lenderCredit, calculatedAmount: -lenderCredit, stage: 'PRE_SPLIT', treatment: 'DEDUCTION' });
  }

  const feeLines = [
    { kind: PayrollFeeRuleKind.WIRE_FEE, value: wireFee, key: 'wireFee', fallbackLabel: 'Wire Fee' },
    { kind: PayrollFeeRuleKind.UNDERWRITING_FEE, value: underwritingFee, key: 'underwritingFee', fallbackLabel: 'Underwriting Fee' },
    { kind: PayrollFeeRuleKind.ORIGINATION_FEE, value: originationFee, key: 'originationFee', fallbackLabel: 'Origination Fee' },
  ].map((item) => {
    const rule = feeAmountForKind(rules.feeRules, item.kind);
    if (rule) return missingRequiredFeeLine(rule, item.value, item.key);
    if (!item.value) return null;
    return {
      key: item.key,
      label: item.fallbackLabel,
      enteredAmount: item.value,
      calculatedAmount: -item.value,
      stage: 'MISSING_FEE' as const,
      treatment: 'DEDUCTION' as const,
      note: `${item.fallbackLabel} is included in Section A and reduces the split basis.`,
    };
  }).filter(Boolean) as PayrollCalculationLine[];
  lines.push(...feeLines);

  const preSplitAddBackTotal = money(lines
    .filter((line) => line.stage === 'PRE_SPLIT' && line.calculatedAmount > 0)
    .reduce((sum, line) => sum + line.calculatedAmount, 0));
  const preSplitDeductionTotal = money(Math.abs(lines
    .filter((line) => (line.stage === 'PRE_SPLIT' || line.stage === 'MISSING_FEE') && line.calculatedAmount < 0)
    .reduce((sum, line) => sum + line.calculatedAmount, 0)));

  const postSplitFields = [
    { key: 'appraisalAddBack', label: 'Appraisal', value: appraisalAddBack },
    { key: 'creditAddBack', label: 'Credit', value: creditAddBack },
    { key: 'voeAddBack', label: 'VOE', value: voeAddBack },
    { key: 'termiteAddBack', label: 'Termite', value: termiteAddBack },
    { key: 'appraisalReinspectionAddBack', label: 'Appraisal Reinspection', value: appraisalReinspectionAddBack },
    { key: 'waterTestAddBack', label: 'Water Test', value: waterTestAddBack },
  ];
  for (const field of postSplitFields) {
    if (!field.value) continue;
    lines.push({
      key: field.key,
      label: field.label,
      enteredAmount: field.value,
      calculatedAmount: field.value,
      stage: 'POST_SPLIT',
      treatment: 'ADD_BACK',
      note: 'Applied after split calculation.',
    });
  }
  const postSplitAddBackTotal = money(postSplitFields.reduce((sum, field) => sum + (field.value ?? 0), 0));

  const splitBasisAmount = money(baseAmount + preSplitAddBackTotal - preSplitDeductionTotal);
  if (splitBasisAmount <= 0) {
    throw new Error('Split basis must be greater than 0 after pre-split adjustments.');
  }
  const netCompAmount = money(splitBasisAmount + postSplitAddBackTotal);

  const figureNftyRequired = isFigureNftyLender(input.lender);
  const requirement = rules.requirement;
  const requiresLoanAmountPriorToFees = figureNftyRequired || Boolean(requirement?.requiresLoanAmountPriorToFees);
  const requiresFundedDetailsAttachment = figureNftyRequired || Boolean(requirement?.requiresFundedDetailsAttachment);
  const requiresRecessionDate = figureNftyRequired || Boolean(requirement?.requiresRecessionDate);
  const recessionEligibleDate = recessionDate ? addDays(recessionDate, 3) : null;
  const currentWindow = nextPaycheckWindow(now);
  const recessionBlocksSubmission = Boolean(
    requiresRecessionDate &&
    recessionEligibleDate &&
    recessionEligibleDate >= new Date(currentWindow.periodEnd)
  );
  const warnings: string[] = [];
  if (requiresLoanAmountPriorToFees && !loanAmountPriorToFees) warnings.push('Loan amount prior to fees is required for this lender.');
  if (requiresFundedDetailsAttachment && !input.figureNftyAttachmentName && !input.figureNftyAttachmentUrl) warnings.push('Funded/details screenshot attachment is required for this lender.');
  if (requiresRecessionDate && !recessionDate) warnings.push('Recession date is required for this lender.');
  if (recessionBlocksSubmission) warnings.push('The recession period pushes this file into the next pay period.');
  for (const line of lines) {
    if (line.missing) warnings.push(`${line.label} is missing and reducing compensation.`);
  }

  return {
    grossCompAmount: baseAmount,
    preSplitAddBackTotal,
    preSplitDeductionTotal,
    splitBasisAmount,
    postSplitAddBackTotal,
    netCompAmount,
    lines,
    warnings,
    requirements: {
      figureNftyRequired,
      requiresLoanAmountPriorToFees,
      requiresFundedDetailsAttachment,
      requiresRecessionDate,
      recessionBlocksSubmission,
      recessionEligibleDate: recessionEligibleDate?.toISOString() ?? null,
    },
  };
}

function serializeRequest(request: Prisma.PayrollCompRequestGetPayload<{ include: typeof requestInclude }>): PayrollRequestRow {
  const calculationSnapshot = (request.calculationSnapshot as PayrollCalculationSnapshot | null) ?? null;
  const splitBasisAmount = decimalToNumber(request.splitBasisAmount) || decimalToNumber(request.expectedRevenue);
  const netCompAmount = decimalToNumber(request.netCompAmount) || splitBasisAmount;
  return {
    id: request.id,
    loanOfficerId: request.loanOfficerId,
    loanOfficerName: request.loanOfficer.name,
    loanOfficerEmail: request.loanOfficer.email,
    loanNumber: request.loanNumber,
    borrowerName: request.borrowerName,
    loanType: request.loanType,
    lender: request.lender,
    loanChannel: request.loanChannel,
    processingType: request.processingType,
    leadSource: request.leadSource,
    leadProvidedBy: request.leadProvidedBy,
    appliedPlanType: request.appliedPlanType,
    expectedRevenue: decimalToNumber(request.expectedRevenue),
    brokerComp: decimalToNumber(request.brokerComp) || null,
    sectionAComp: decimalToNumber(request.sectionAComp) || null,
    yspAmount: decimalToNumber(request.yspAmount) || null,
    toleranceCure: decimalToNumber(request.toleranceCure) || null,
    oneDayInterest: decimalToNumber(request.oneDayInterest) || null,
    wireFee: decimalToNumber(request.wireFee) || null,
    underwritingFee: decimalToNumber(request.underwritingFee) || null,
    lenderCredit: decimalToNumber(request.lenderCredit) || null,
    originationFee: decimalToNumber(request.originationFee) || null,
    appraisalAddBack: decimalToNumber(request.appraisalAddBack) || null,
    creditAddBack: decimalToNumber(request.creditAddBack) || null,
    voeAddBack: decimalToNumber(request.voeAddBack) || null,
    termiteAddBack: decimalToNumber(request.termiteAddBack) || null,
    appraisalReinspectionAddBack: decimalToNumber(request.appraisalReinspectionAddBack) || null,
    waterTestAddBack: decimalToNumber(request.waterTestAddBack) || null,
    loanAmountPriorToFees: decimalToNumber(request.loanAmountPriorToFees) || null,
    recessionDate: request.recessionDate?.toISOString() ?? null,
    figureNftyAttachmentName: request.figureNftyAttachmentName,
    figureNftyAttachmentUrl: request.figureNftyAttachmentUrl,
    grossCompAmount: request.grossCompAmount !== null ? decimalToNumber(request.grossCompAmount) : calculationSnapshot?.grossCompAmount ?? null,
    preSplitAddBackTotal: request.preSplitAddBackTotal !== null ? decimalToNumber(request.preSplitAddBackTotal) : calculationSnapshot?.preSplitAddBackTotal ?? null,
    preSplitDeductionTotal: request.preSplitDeductionTotal !== null ? decimalToNumber(request.preSplitDeductionTotal) : calculationSnapshot?.preSplitDeductionTotal ?? null,
    splitBasisAmount,
    postSplitAddBackTotal: request.postSplitAddBackTotal !== null ? decimalToNumber(request.postSplitAddBackTotal) : calculationSnapshot?.postSplitAddBackTotal ?? null,
    netCompAmount,
    calculationSnapshot,
    status: request.status,
    submittedAt: request.submittedAt.toISOString(),
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    paidAt: request.paidAt?.toISOString() ?? null,
    editedAt: request.editedAt?.toISOString() ?? null,
    submitterNotes: request.submitterNotes,
    adminNotes: request.adminNotes,
    rejectionReason: request.rejectionReason,
    mismoDetails: (request.mismoDetails as PayrollMismoDetails | null) ?? null,
    splits: request.splits.map((split) => ({
      id: split.id,
      recipientUserId: split.recipientUserId,
      recipientName: split.recipientName,
      recipientEmail: split.recipientEmail,
      roleLabel: split.roleLabel,
      payType: split.payType,
      splitPercent: decimalToNumber(split.splitPercent),
      flatAmount: decimalToNumber(split.flatAmount) || null,
      amount: decimalToNumber(split.amount),
      sortOrder: split.sortOrder,
    })),
  };
}

async function buildSplitSnapshots(
  loanOfficerId: string,
  expectedRevenue: number,
  context?: {
    leadSource?: PayrollLeadSource;
    leadProvidedBy?: PayrollLeadProvidedBy;
    appliedPlanType?: PayrollCompPlanType | null;
  }
) {
  const [loanOfficer, plans] = await Promise.all([
    prisma.user.findUnique({
      where: { id: loanOfficerId },
      select: { id: true, name: true, email: true },
    }),
    prisma.payrollCompPlan.findMany({
      where: { loanOfficerId, active: true },
      orderBy: { effectiveStart: 'desc' },
      include: {
        splits: {
          where: { active: true },
          orderBy: { sortOrder: 'asc' },
          include: { recipientUser: { select: { id: true, name: true, email: true } } },
        },
      },
    }),
  ]);

  if (!loanOfficer) throw new Error('Loan officer was not found.');
  const classification = plans[0]?.userClassification ?? PayrollUserClassification.BROKER;
  const selectedPlanType = resolveAppliedPlanType({
    userClassification: classification,
    leadSource: context?.leadSource ?? PayrollLeadSource.OTHER,
    leadProvidedBy: context?.leadProvidedBy ?? PayrollLeadProvidedBy.SELF_SOURCED,
    override: context?.appliedPlanType,
  });
  const selectedPlan =
    plans.find((item) => item.planType === selectedPlanType) ??
    plans.find((item) => item.planType === PayrollCompPlanType.BROKER) ??
    plans[0] ??
    null;
  const effectivePlanType = selectedPlan?.planType ?? selectedPlanType;

  const rawSplits = selectedPlan
    ? [
        {
          planId: selectedPlan.id,
          recipientUserId: loanOfficer.id,
          recipientName: loanOfficer.name,
          recipientEmail: loanOfficer.email,
          roleLabel: 'Loan Officer',
          payType: PayrollSplitPayType.PERCENT,
          splitPercent: decimalToNumber(selectedPlan.baseSplitPercent),
          flatAmount: null,
          sortOrder: 0,
        },
        ...selectedPlan.splits.map((split, index) => ({
          planId: selectedPlan.id,
          recipientUserId: split.recipientUser?.id ?? null,
          recipientName: split.recipientUser?.name ?? split.recipientName ?? 'Unknown recipient',
          recipientEmail: split.recipientUser?.email ?? split.recipientEmail ?? null,
          roleLabel: split.roleLabel,
          payType: split.payType,
          splitPercent: decimalToNumber(split.splitPercent),
          flatAmount: decimalToNumber(split.flatAmount) || null,
          sortOrder: index + 1,
        })),
      ]
    : [
        {
          planId: null,
          recipientUserId: loanOfficer.id,
          recipientName: loanOfficer.name,
          recipientEmail: loanOfficer.email,
          roleLabel: 'Loan Officer',
          payType: PayrollSplitPayType.PERCENT,
          splitPercent: 100,
          flatAmount: null,
          sortOrder: 0,
        },
      ];

  const totalPercent = percent(rawSplits.reduce((sum, split) => sum + (requiresPercent(split.payType) ? split.splitPercent : 0), 0));
  if (Math.abs(totalPercent - 100) > 0.0001) {
    throw new Error('Compensation split percentages must add up to 100%.');
  }

  let assigned = 0;
  return rawSplits.map((split, index) => {
    const isLast = index === rawSplits.length - 1;
    const percentAmount = isLast
      ? money(expectedRevenue - assigned)
      : money((expectedRevenue * split.splitPercent) / 100);
    const calculated = money((requiresPercent(split.payType) ? percentAmount : 0) + (split.flatAmount ?? 0));
    if (requiresPercent(split.payType)) assigned += percentAmount;
    return {
      ...split,
      amount: calculated,
      appliedPlanType: effectivePlanType,
    };
  });
}

export async function getPayrollEligibleUsers() {
  await assertPayrollAdmin();
  const users = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: { in: [UserRole.LOAN_OFFICER, UserRole.LOA, UserRole.MANAGER] } },
        { roles: { hasSome: [UserRole.LOAN_OFFICER, UserRole.LOA, UserRole.MANAGER] } },
      ],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true, role: true },
  });
  return users;
}

export async function getPayrollUsersWithPlans(): Promise<PayrollUserPlanRow[]> {
  await assertPayrollAdmin();
  const users = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: UserRole.LOAN_OFFICER },
        { roles: { has: UserRole.LOAN_OFFICER } },
      ],
    },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      payrollCompPlans: {
        where: { active: true },
        orderBy: { effectiveStart: 'desc' },
        include: {
          splits: {
            where: { active: true },
            orderBy: { sortOrder: 'asc' },
            include: { recipientUser: { select: { id: true, name: true, email: true } } },
          },
        },
      },
    },
  });

  const serializePlan = (plan: (typeof users)[number]['payrollCompPlans'][number] | null): PayrollUserPlanDetail | null =>
    plan
      ? {
          id: plan.id,
          planType: plan.planType,
          salaryPerPaycheck: decimalToNumber(plan.salaryPerPaycheck) || null,
          salaryFrequency: plan.salaryFrequency,
          salaryNotes: plan.salaryNotes,
          baseSplitPercent: decimalToNumber(plan.baseSplitPercent),
          active: plan.active,
          notes: plan.notes,
          updatedAt: plan.updatedAt.toISOString(),
          splits: plan.splits.map((split) => ({
            id: split.id,
            recipientUserId: split.recipientUserId,
            recipientName: split.recipientUser?.name ?? split.recipientName ?? 'Unknown recipient',
            recipientEmail: split.recipientUser?.email ?? split.recipientEmail,
            roleLabel: split.roleLabel,
            payType: split.payType,
            splitPercent: decimalToNumber(split.splitPercent),
            flatAmount: decimalToNumber(split.flatAmount) || null,
            sortOrder: split.sortOrder,
          })),
        }
      : null;

  return users.map((user) => {
    const brokerPlan = user.payrollCompPlans.find((plan) => plan.planType === PayrollCompPlanType.BROKER) ?? user.payrollCompPlans[0] ?? null;
    const retailPlan = user.payrollCompPlans.find((plan) => plan.planType === PayrollCompPlanType.RETAIL) ?? null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      userClassification: brokerPlan?.userClassification ?? retailPlan?.userClassification ?? PayrollUserClassification.BROKER,
      plan: serializePlan(brokerPlan),
      retailPlan: serializePlan(retailPlan),
    };
  });
}

function normalizePlanInput(input: Omit<PayrollCompPlanInput, 'loanOfficerId' | 'userClassification' | 'planType'>) {
  const baseSplitPercent = ensurePercent(input.baseSplitPercent, 'Base split');
  const splits = input.splits.map((split, index) => ({
    recipientUserId: split.recipientUserId?.trim() || null,
    recipientName: cleanText(split.recipientName ?? '', 'Split recipient'),
    recipientEmail: split.recipientEmail?.trim() || null,
    roleLabel: cleanText(split.roleLabel, 'Split role'),
    payType: split.payType ?? PayrollSplitPayType.PERCENT,
    splitPercent: ensurePercent(requiresPercent(split.payType ?? PayrollSplitPayType.PERCENT) ? split.splitPercent : 0, 'Split percent'),
    flatAmount: ensureOptionalMoney(split.flatAmount, 'Flat fee'),
    sortOrder: index + 1,
  }));
  for (const split of splits) {
    if (requiresFlatAmount(split.payType) && (!split.flatAmount || split.flatAmount <= 0)) {
      throw new Error(`${split.roleLabel} flat fee must be greater than 0.`);
    }
  }
  const total = percent(baseSplitPercent + splits.reduce((sum, split) => sum + (requiresPercent(split.payType) ? split.splitPercent : 0), 0));
  if (Math.abs(total - 100) > 0.0001) {
    throw new Error('Compensation split percentages must add up to 100%.');
  }
  return { baseSplitPercent, splits, notes: input.notes?.trim() || null, active: input.active ?? true };
}

export async function savePayrollCompPlan(input: PayrollCompPlanInput) {
  return savePayrollCompPlanSettings({
    loanOfficerId: input.loanOfficerId,
    userClassification: input.userClassification ?? PayrollUserClassification.BROKER,
    brokerPlan: {
      baseSplitPercent: input.baseSplitPercent,
      active: input.active,
      notes: input.notes,
      splits: input.splits,
    },
    retailPlan: input.planType === PayrollCompPlanType.RETAIL
      ? {
          baseSplitPercent: input.baseSplitPercent,
          active: input.active,
          notes: input.notes,
          splits: input.splits,
        }
      : null,
  });
}

export async function savePayrollCompPlanSettings(input: PayrollCompPlanSettingsInput) {
  await assertPayrollAdmin();

  const loanOfficerId = cleanText(input.loanOfficerId, 'Loan officer');
  const userClassification = input.userClassification;
  const salaryPerPaycheck = ensureOptionalMoney(input.salaryPerPaycheck, 'Salary per paycheck');
  const salaryFrequency = input.salaryFrequency ?? PayrollSalaryFrequency.SEMI_MONTHLY;
  const salaryNotes = input.salaryNotes?.trim() || null;
  const brokerPlan = normalizePlanInput(input.brokerPlan);
  const retailPlan = userClassification === PayrollUserClassification.BROKER && input.retailPlan
    ? normalizePlanInput(input.retailPlan)
    : null;

  const user = await prisma.user.findUnique({
    where: { id: loanOfficerId },
    select: { id: true },
  });
  if (!user) throw new Error('Loan officer was not found.');

  await prisma.$transaction(async (tx) => {
    await tx.payrollCompPlan.updateMany({
      where: { loanOfficerId, active: true },
      data: { active: false, effectiveEnd: new Date() },
    });

    const createPlan = (planType: PayrollCompPlanType, plan: typeof brokerPlan) =>
      tx.payrollCompPlan.create({
        data: {
          loanOfficerId,
          userClassification,
          planType,
          salaryPerPaycheck,
          salaryFrequency,
          salaryNotes,
          baseSplitPercent: plan.baseSplitPercent,
          active: plan.active,
          notes: plan.notes,
          splits: {
            create: plan.splits.map((split) => ({
              recipientUserId: split.recipientUserId,
              recipientName: split.recipientName,
              recipientEmail: split.recipientEmail,
              roleLabel: split.roleLabel,
              payType: split.payType,
              splitPercent: split.splitPercent,
              flatAmount: split.flatAmount,
              sortOrder: split.sortOrder,
            })),
          },
        },
      });

    await createPlan(PayrollCompPlanType.BROKER, brokerPlan);
    if (retailPlan) {
      await createPlan(PayrollCompPlanType.RETAIL, retailPlan);
    }
  });

  revalidatePayroll();
}

export async function getPayrollRequestPreview(input: PayrollCompRequestInput) {
  const actor = await assertPayrollPortalUser();
  const rules = await getPayrollRulesForRequest(input);
  const calculation = calculatePayrollCompensation(input, rules);
  const snapshots = await buildSplitSnapshots(actor.userId, calculation.splitBasisAmount, {
    leadSource: input.leadSource,
    leadProvidedBy: input.leadProvidedBy,
  });
  return {
    calculation,
    splits: snapshots.map((split) => ({
      recipientName: split.recipientName,
      recipientEmail: split.recipientEmail,
      roleLabel: split.roleLabel,
      payType: split.payType,
      splitPercent: split.splitPercent,
      flatAmount: split.flatAmount,
      amount: split.amount,
      sortOrder: split.sortOrder,
    })),
  };
}

export async function submitPayrollCompRequest(input: PayrollCompRequestInput) {
  const actor = await assertPayrollPortalUser();
  const loanNumber = cleanText(input.loanNumber, 'Loan number');
  const existingRequest = await prisma.payrollCompRequest.findFirst({
    where: {
      loanOfficerId: actor.userId,
      loanNumber: { equals: loanNumber, mode: 'insensitive' },
      status: { not: PayrollCompRequestStatus.REJECTED },
    },
    select: { id: true, status: true },
  });
  if (existingRequest) {
    throw new Error('A compensation request for this Arive loan number already exists. Delete or reject the existing request before submitting another one.');
  }
  const rules = await getPayrollRulesForRequest(input);
  const calculation = calculatePayrollCompensation(input, rules);
  if (calculation.requirements.recessionBlocksSubmission) {
    throw new Error('This Figure/NFTY file cannot be submitted until the recession period falls into the eligible pay period.');
  }
  if (calculation.requirements.requiresLoanAmountPriorToFees && !input.loanAmountPriorToFees) {
    throw new Error('Loan amount prior to fees is required for this lender.');
  }
  if (calculation.requirements.requiresFundedDetailsAttachment && !input.figureNftyAttachmentName && !input.figureNftyAttachmentUrl) {
    throw new Error('Funded/details screenshot is required for this lender.');
  }
  if (calculation.requirements.requiresRecessionDate && !input.recessionDate) {
    throw new Error('Recession date is required for this lender.');
  }
  const snapshots = await buildSplitSnapshots(actor.userId, calculation.splitBasisAmount, {
    leadSource: input.leadSource,
    leadProvidedBy: input.leadProvidedBy,
  });
  const appliedPlanType = snapshots[0]?.appliedPlanType ?? PayrollCompPlanType.BROKER;
  const recessionDate = parseOptionalDate(input.recessionDate, 'Recession date');

  await prisma.payrollCompRequest.create({
    data: {
      loanOfficerId: actor.userId,
      loanNumber,
      borrowerName: cleanText(input.borrowerName, "Borrower's name"),
      loanType: cleanText(input.loanType, 'Loan type'),
      lender: cleanText(input.lender, 'Lender'),
      loanChannel: input.loanChannel,
      processingType: input.processingType,
      leadSource: input.leadSource,
      leadProvidedBy: input.leadProvidedBy,
      appliedPlanType,
      expectedRevenue: calculation.splitBasisAmount,
      brokerComp: ensureOptionalMoney(input.brokerComp, 'Broker comp'),
      sectionAComp: ensureOptionalMoney(input.sectionAComp, 'Section A'),
      yspAmount: ensureSignedMoney(input.yspAmount, 'YSP'),
      toleranceCure: ensureOptionalMoney(input.toleranceCure, 'Tolerance cure'),
      oneDayInterest: ensureOptionalMoney(input.oneDayInterest, '1 day of interest'),
      wireFee: ensureOptionalMoney(input.wireFee, 'Wire fee'),
      underwritingFee: ensureOptionalMoney(input.underwritingFee, 'Underwriting fee'),
      lenderCredit: ensureOptionalMoney(input.lenderCredit, 'Lender credit'),
      originationFee: ensureOptionalMoney(input.originationFee, 'Origination fee'),
      appraisalAddBack: ensureOptionalMoney(input.appraisalAddBack, 'Appraisal add-back'),
      creditAddBack: ensureOptionalMoney(input.creditAddBack, 'Credit add-back'),
      voeAddBack: ensureOptionalMoney(input.voeAddBack, 'VOE add-back'),
      termiteAddBack: ensureOptionalMoney(input.termiteAddBack, 'Termite add-back'),
      appraisalReinspectionAddBack: ensureOptionalMoney(input.appraisalReinspectionAddBack, 'Appraisal reinspection add-back'),
      waterTestAddBack: ensureOptionalMoney(input.waterTestAddBack, 'Water test add-back'),
      loanAmountPriorToFees: ensureOptionalMoney(input.loanAmountPriorToFees, 'Loan amount prior to fees'),
      recessionDate,
      figureNftyAttachmentName: input.figureNftyAttachmentName?.trim() || null,
      figureNftyAttachmentUrl: input.figureNftyAttachmentUrl?.trim() || null,
      grossCompAmount: calculation.grossCompAmount,
      preSplitAddBackTotal: calculation.preSplitAddBackTotal,
      preSplitDeductionTotal: calculation.preSplitDeductionTotal,
      splitBasisAmount: calculation.splitBasisAmount,
      postSplitAddBackTotal: calculation.postSplitAddBackTotal,
      netCompAmount: calculation.netCompAmount,
      calculationSnapshot: calculation as unknown as Prisma.InputJsonValue,
      mismoDetails: normalizeMismoDetails(input.mismoDetails),
      submitterNotes: input.submitterNotes?.trim() || null,
      splits: {
        create: snapshots.map((split) => ({
          planId: split.planId,
          recipientUserId: split.recipientUserId,
          recipientName: split.recipientName,
          recipientEmail: split.recipientEmail,
          roleLabel: split.roleLabel,
          payType: split.payType,
          splitPercent: split.splitPercent,
          flatAmount: split.flatAmount,
          amount: split.amount,
          sortOrder: split.sortOrder,
        })),
      },
    },
  });

  revalidatePayroll();
}

export async function getMyPayrollPortalData() {
  const actor = await assertPayrollPortalUser();
  const window = nextPaycheckWindow();
  const [requests, plan, nextSplits] = await Promise.all([
    prisma.payrollCompRequest.findMany({
      where: { loanOfficerId: actor.userId },
      orderBy: { submittedAt: 'desc' },
      include: requestInclude,
    }),
    prisma.payrollCompPlan.findFirst({
      where: { loanOfficerId: actor.userId, active: true, planType: PayrollCompPlanType.BROKER },
      orderBy: { effectiveStart: 'desc' },
      select: { salaryPerPaycheck: true, salaryFrequency: true },
    }),
    prisma.payrollCompRequestSplit.findMany({
      where: {
        recipientUserId: actor.userId,
        request: {
          status: { in: [PayrollCompRequestStatus.APPROVED, PayrollCompRequestStatus.PAID] },
          submittedAt: {
            gte: new Date(window.periodStart),
            lt: new Date(window.periodEnd),
          },
        },
      },
      select: { amount: true },
    }),
  ]);
  const rows = requests.map(serializeRequest);
  const summary = summarizeRequests(rows);
  const salaryAmount = salaryPerPaycheckAmount(decimalToNumber(plan?.salaryPerPaycheck), plan?.salaryFrequency ?? PayrollSalaryFrequency.SEMI_MONTHLY);
  const commissionAmount = money(nextSplits.reduce((sum, split) => sum + decimalToNumber(split.amount), 0));
  return {
    rows,
    summary,
    nextPaycheck: {
      ...window,
      salaryAmount,
      commissionAmount,
      totalAmount: money(salaryAmount + commissionAmount),
    },
  };
}

export async function getPayrollRequests(filters: PayrollRequestFilters = {}) {
  await assertPayrollAdmin();
  const { start, end } = datesFromFilters(filters);
  const search = filters.search?.trim();
  const where: Prisma.PayrollCompRequestWhereInput = {
    ...(filters.status && filters.status !== 'ALL' ? { status: filters.status } : {}),
    ...(filters.loanOfficerId ? { loanOfficerId: filters.loanOfficerId } : {}),
    ...(start || end
      ? {
          submittedAt: {
            ...(start ? { gte: start } : {}),
            ...(end ? { lte: end } : {}),
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { loanNumber: { contains: search, mode: 'insensitive' } },
            { borrowerName: { contains: search, mode: 'insensitive' } },
            { lender: { contains: search, mode: 'insensitive' } },
            { loanOfficer: { name: { contains: search, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const requests = await prisma.payrollCompRequest.findMany({
    where,
    orderBy: { submittedAt: 'desc' },
    take: 500,
    include: requestInclude,
  });
  return requests.map(serializeRequest);
}

export async function getPayrollSettingsDatabase(): Promise<PayrollSettingsDatabase> {
  await assertPayrollAdmin();
  const [settings, feeRules, lenderRequirements] = await Promise.all([
    prisma.payrollSetting.findMany({ orderBy: [{ active: 'desc' }, { label: 'asc' }] }),
    prisma.payrollLenderFeeRule.findMany({ orderBy: [{ active: 'desc' }, { lender: 'asc' }, { label: 'asc' }] }),
    prisma.payrollLenderRequirement.findMany({ orderBy: [{ active: 'desc' }, { lender: 'asc' }] }),
  ]);
  return {
    settings: settings.map((setting) => ({
      id: setting.id,
      key: setting.key,
      label: setting.label,
      description: setting.description,
      valueType: setting.valueType,
      value: setting.value,
      active: setting.active,
    })),
    feeRules: feeRules.map((rule) => ({
      id: rule.id,
      lender: rule.lender,
      loanChannel: rule.loanChannel,
      feeKind: rule.feeKind,
      label: rule.label,
      amount: decimalToNumber(rule.amount),
      required: rule.required,
      active: rule.active,
      notes: rule.notes,
    })),
    lenderRequirements: lenderRequirements.map((requirement) => ({
      id: requirement.id,
      lender: requirement.lender,
      requiresLoanAmountPriorToFees: requirement.requiresLoanAmountPriorToFees,
      requiresFundedDetailsAttachment: requirement.requiresFundedDetailsAttachment,
      requiresRecessionDate: requirement.requiresRecessionDate,
      active: requirement.active,
      notes: requirement.notes,
    })),
  };
}

export type PayrollLenderFeeRuleInput = {
  id?: string;
  lender: string;
  loanChannel?: PayrollLoanChannel | null;
  feeKind: PayrollFeeRuleKind;
  label: string;
  amount: number;
  required?: boolean;
  active?: boolean;
  notes?: string | null;
};

export async function savePayrollLenderFeeRule(input: PayrollLenderFeeRuleInput) {
  await assertPayrollAdmin();
  const data = {
    lender: cleanText(input.lender, 'Lender'),
    loanChannel: input.loanChannel ?? null,
    feeKind: input.feeKind,
    label: cleanText(input.label, 'Fee label'),
    amount: ensureOptionalMoney(input.amount, 'Fee amount') ?? 0,
    required: input.required ?? true,
    active: input.active ?? true,
    notes: input.notes?.trim() || null,
  };
  if (input.id) {
    await prisma.payrollLenderFeeRule.update({ where: { id: input.id }, data });
  } else {
    const existing = await prisma.payrollLenderFeeRule.findFirst({
      where: { lender: data.lender, loanChannel: data.loanChannel, feeKind: data.feeKind },
      select: { id: true },
    });
    if (existing) {
      await prisma.payrollLenderFeeRule.update({ where: { id: existing.id }, data });
    } else {
      await prisma.payrollLenderFeeRule.create({ data });
    }
  }
  revalidatePayroll();
}

export type PayrollLenderRequirementInput = {
  id?: string;
  lender: string;
  requiresLoanAmountPriorToFees?: boolean;
  requiresFundedDetailsAttachment?: boolean;
  requiresRecessionDate?: boolean;
  active?: boolean;
  notes?: string | null;
};

export async function savePayrollLenderRequirement(input: PayrollLenderRequirementInput) {
  await assertPayrollAdmin();
  const data = {
    lender: cleanText(input.lender, 'Lender'),
    requiresLoanAmountPriorToFees: input.requiresLoanAmountPriorToFees ?? false,
    requiresFundedDetailsAttachment: input.requiresFundedDetailsAttachment ?? false,
    requiresRecessionDate: input.requiresRecessionDate ?? false,
    active: input.active ?? true,
    notes: input.notes?.trim() || null,
  };
  if (input.id) {
    await prisma.payrollLenderRequirement.update({ where: { id: input.id }, data });
  } else {
    await prisma.payrollLenderRequirement.upsert({
      where: { lender: data.lender },
      update: data,
      create: data,
    });
  }
  revalidatePayroll();
}

async function replaceRequestSplits(requestId: string) {
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      loanOfficerId: true,
      expectedRevenue: true,
      splitBasisAmount: true,
      leadSource: true,
      leadProvidedBy: true,
      appliedPlanType: true,
    },
  });
  if (!request) throw new Error('Payroll request was not found.');
  const snapshots = await buildSplitSnapshots(request.loanOfficerId, decimalToNumber(request.splitBasisAmount) || decimalToNumber(request.expectedRevenue), {
    leadSource: request.leadSource,
    leadProvidedBy: request.leadProvidedBy,
    appliedPlanType: request.appliedPlanType,
  });
  await prisma.$transaction([
    prisma.payrollCompRequestSplit.deleteMany({ where: { requestId } }),
    prisma.payrollCompRequestSplit.createMany({
      data: snapshots.map((split) => ({
        requestId,
        planId: split.planId,
        recipientUserId: split.recipientUserId,
        recipientName: split.recipientName,
        recipientEmail: split.recipientEmail,
        roleLabel: split.roleLabel,
        payType: split.payType,
        splitPercent: split.splitPercent,
        flatAmount: split.flatAmount,
        amount: split.amount,
        sortOrder: split.sortOrder,
      })),
    }),
  ]);
}

export async function editPayrollRequest(input: PayrollAdminEditRequestInput) {
  const actor = await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: input.requestId },
    select: { id: true, loanOfficerId: true, status: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  if (request.status === PayrollCompRequestStatus.PAID) {
    throw new Error('Paid requests cannot be edited.');
  }

  const rules = await getPayrollRulesForRequest(input);
  const calculation = calculatePayrollCompensation(input, rules);
  const snapshots = await buildSplitSnapshots(request.loanOfficerId, calculation.splitBasisAmount, {
    leadSource: input.leadSource,
    leadProvidedBy: input.leadProvidedBy,
    appliedPlanType: input.appliedPlanType,
  });
  const recessionDate = parseOptionalDate(input.recessionDate, 'Recession date');

  await prisma.$transaction(async (tx) => {
    await tx.payrollCompRequest.update({
      where: { id: input.requestId },
      data: {
        loanNumber: cleanText(input.loanNumber, 'Loan number'),
        borrowerName: cleanText(input.borrowerName, "Borrower's name"),
        loanType: cleanText(input.loanType, 'Loan type'),
        lender: cleanText(input.lender, 'Lender'),
        loanChannel: input.loanChannel,
        processingType: input.processingType,
        leadSource: input.leadSource,
        leadProvidedBy: input.leadProvidedBy,
        appliedPlanType: input.appliedPlanType,
        expectedRevenue: calculation.splitBasisAmount,
        brokerComp: ensureOptionalMoney(input.brokerComp, 'Broker comp'),
        sectionAComp: ensureOptionalMoney(input.sectionAComp, 'Section A'),
        yspAmount: ensureSignedMoney(input.yspAmount, 'YSP'),
        toleranceCure: ensureOptionalMoney(input.toleranceCure, 'Tolerance cure'),
        oneDayInterest: ensureOptionalMoney(input.oneDayInterest, '1 day of interest'),
        wireFee: ensureOptionalMoney(input.wireFee, 'Wire fee'),
        underwritingFee: ensureOptionalMoney(input.underwritingFee, 'Underwriting fee'),
        lenderCredit: ensureOptionalMoney(input.lenderCredit, 'Lender credit'),
        originationFee: ensureOptionalMoney(input.originationFee, 'Origination fee'),
        appraisalAddBack: ensureOptionalMoney(input.appraisalAddBack, 'Appraisal add-back'),
        creditAddBack: ensureOptionalMoney(input.creditAddBack, 'Credit add-back'),
        voeAddBack: ensureOptionalMoney(input.voeAddBack, 'VOE add-back'),
        termiteAddBack: ensureOptionalMoney(input.termiteAddBack, 'Termite add-back'),
        appraisalReinspectionAddBack: ensureOptionalMoney(input.appraisalReinspectionAddBack, 'Appraisal reinspection add-back'),
        waterTestAddBack: ensureOptionalMoney(input.waterTestAddBack, 'Water test add-back'),
        loanAmountPriorToFees: ensureOptionalMoney(input.loanAmountPriorToFees, 'Loan amount prior to fees'),
        recessionDate,
        figureNftyAttachmentName: input.figureNftyAttachmentName?.trim() || null,
        figureNftyAttachmentUrl: input.figureNftyAttachmentUrl?.trim() || null,
        grossCompAmount: calculation.grossCompAmount,
        preSplitAddBackTotal: calculation.preSplitAddBackTotal,
        preSplitDeductionTotal: calculation.preSplitDeductionTotal,
        splitBasisAmount: calculation.splitBasisAmount,
        postSplitAddBackTotal: calculation.postSplitAddBackTotal,
        netCompAmount: calculation.netCompAmount,
        calculationSnapshot: calculation as unknown as Prisma.InputJsonValue,
        mismoDetails: normalizeMismoDetails(input.mismoDetails) ?? Prisma.JsonNull,
        submitterNotes: input.submitterNotes?.trim() || null,
        adminNotes: input.adminNotes?.trim() || null,
        editedAt: new Date(),
        editedById: actor.userId,
      },
    });
    await tx.payrollCompRequestSplit.deleteMany({ where: { requestId: input.requestId } });
    await tx.payrollCompRequestSplit.createMany({
      data: snapshots.map((split) => ({
        requestId: input.requestId,
        planId: split.planId,
        recipientUserId: split.recipientUserId,
        recipientName: split.recipientName,
        recipientEmail: split.recipientEmail,
        roleLabel: split.roleLabel,
        payType: split.payType,
        splitPercent: split.splitPercent,
        flatAmount: split.flatAmount,
        amount: split.amount,
        sortOrder: split.sortOrder,
      })),
    });
  });

  revalidatePayroll();
}

export async function approvePayrollRequest(requestId: string, adminNotes?: string, recalculate = false) {
  const actor = await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  if (
    request.status !== PayrollCompRequestStatus.PENDING_REVIEW &&
    request.status !== PayrollCompRequestStatus.REJECTED
  ) {
    throw new Error('Only pending or rejected requests can be approved.');
  }
  if (recalculate) await replaceRequestSplits(requestId);
  await prisma.payrollCompRequest.update({
    where: { id: requestId },
    data: {
      status: PayrollCompRequestStatus.APPROVED,
      reviewedAt: new Date(),
      reviewedById: actor.userId,
      adminNotes: adminNotes?.trim() || null,
      rejectionReason: null,
    },
  });
  revalidatePayroll();
}

export async function rejectPayrollRequest(requestId: string, rejectionReason: string, adminNotes?: string) {
  const actor = await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  if (request.status === PayrollCompRequestStatus.PAID) {
    throw new Error('Paid requests cannot be rejected.');
  }
  await prisma.payrollCompRequest.update({
    where: { id: requestId },
    data: {
      status: PayrollCompRequestStatus.REJECTED,
      reviewedAt: new Date(),
      reviewedById: actor.userId,
      rejectionReason: cleanText(rejectionReason, 'Rejection reason'),
      adminNotes: adminNotes?.trim() || null,
    },
  });
  revalidatePayroll();
}

export async function deletePayrollRequest(requestId: string) {
  await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { id: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  await prisma.payrollCompRequest.delete({ where: { id: requestId } });
  revalidatePayroll();
}

export async function markPayrollRequestPaid(requestId: string, adminNotes?: string) {
  const actor = await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  if (request.status !== PayrollCompRequestStatus.APPROVED) {
    throw new Error('Only approved requests can be marked paid.');
  }
  await prisma.payrollCompRequest.update({
    where: { id: requestId },
    data: {
      status: PayrollCompRequestStatus.PAID,
      paidAt: new Date(),
      paidById: actor.userId,
      adminNotes: adminNotes?.trim() || undefined,
    },
  });
  revalidatePayroll();
}

export async function reopenPayrollRequest(requestId: string) {
  await assertPayrollAdmin();
  const request = await prisma.payrollCompRequest.findUnique({
    where: { id: requestId },
    select: { status: true },
  });
  if (!request) throw new Error('Payroll request was not found.');
  if (request.status !== PayrollCompRequestStatus.APPROVED) {
    throw new Error('Only approved requests can be reopened before payment.');
  }
  await prisma.payrollCompRequest.update({
    where: { id: requestId },
    data: {
      status: PayrollCompRequestStatus.PENDING_REVIEW,
      reviewedAt: null,
      reviewedById: null,
    },
  });
  revalidatePayroll();
}

function summarizeRequests(rows: PayrollRequestRow[]) {
  const empty = {
    totalRequests: rows.length,
    pendingCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    paidCount: 0,
    submittedRevenue: 0,
    pendingRevenue: 0,
    approvedRevenue: 0,
    paidRevenue: 0,
  };

  for (const row of rows) {
    empty.submittedRevenue = money(empty.submittedRevenue + row.expectedRevenue);
    if (row.status === PayrollCompRequestStatus.PENDING_REVIEW) {
      empty.pendingCount += 1;
      empty.pendingRevenue = money(empty.pendingRevenue + row.expectedRevenue);
    }
    if (row.status === PayrollCompRequestStatus.APPROVED) {
      empty.approvedCount += 1;
      empty.approvedRevenue = money(empty.approvedRevenue + row.expectedRevenue);
    }
    if (row.status === PayrollCompRequestStatus.REJECTED) empty.rejectedCount += 1;
    if (row.status === PayrollCompRequestStatus.PAID) {
      empty.paidCount += 1;
      empty.paidRevenue = money(empty.paidRevenue + row.expectedRevenue);
    }
  }
  return empty;
}

export async function getPayrollAdminDashboardData() {
  await assertPayrollAdmin();
  const rows = await getPayrollRequests({});
  return {
    summary: summarizeRequests(rows),
    pendingRequests: rows.filter((row) => row.status === PayrollCompRequestStatus.PENDING_REVIEW).slice(0, 8),
    recentRequests: rows.slice(0, 8),
  };
}

export async function getPayrollReport(filters: PayrollReportFilters = {}) {
  await assertPayrollAdmin();
  const rows = await getPayrollRequests(filters);
  const summary = summarizeRequests(rows);
  const byLoanOfficer = new Map<string, {
    loanOfficerId: string;
    loanOfficerName: string;
    requestCount: number;
    expectedRevenue: number;
    paidRevenue: number;
  }>();
  const splitRows = new Map<string, {
    recipientName: string;
    recipientEmail: string | null;
    roleLabel: string;
    amount: number;
    requestCount: number;
  }>();
  const byLender = new Map<string, {
    label: string;
    requestCount: number;
    expectedRevenue: number;
    paidRevenue: number;
  }>();
  const byLoanType = new Map<string, {
    label: string;
    requestCount: number;
    expectedRevenue: number;
    paidRevenue: number;
  }>();
  const byChannel = new Map<PayrollLoanChannel, {
    label: PayrollLoanChannel;
    requestCount: number;
    expectedRevenue: number;
    paidRevenue: number;
  }>();

  for (const row of rows) {
    const officer = byLoanOfficer.get(row.loanOfficerId) ?? {
      loanOfficerId: row.loanOfficerId,
      loanOfficerName: row.loanOfficerName,
      requestCount: 0,
      expectedRevenue: 0,
      paidRevenue: 0,
    };
    officer.requestCount += 1;
    officer.expectedRevenue = money(officer.expectedRevenue + row.expectedRevenue);
    if (row.status === PayrollCompRequestStatus.PAID) {
      officer.paidRevenue = money(officer.paidRevenue + row.expectedRevenue);
    }
    byLoanOfficer.set(row.loanOfficerId, officer);

    const lender = byLender.get(row.lender) ?? {
      label: row.lender,
      requestCount: 0,
      expectedRevenue: 0,
      paidRevenue: 0,
    };
    lender.requestCount += 1;
    lender.expectedRevenue = money(lender.expectedRevenue + row.expectedRevenue);
    if (row.status === PayrollCompRequestStatus.PAID) {
      lender.paidRevenue = money(lender.paidRevenue + row.expectedRevenue);
    }
    byLender.set(row.lender, lender);

    const loanType = byLoanType.get(row.loanType) ?? {
      label: row.loanType,
      requestCount: 0,
      expectedRevenue: 0,
      paidRevenue: 0,
    };
    loanType.requestCount += 1;
    loanType.expectedRevenue = money(loanType.expectedRevenue + row.expectedRevenue);
    if (row.status === PayrollCompRequestStatus.PAID) {
      loanType.paidRevenue = money(loanType.paidRevenue + row.expectedRevenue);
    }
    byLoanType.set(row.loanType, loanType);

    const channel = byChannel.get(row.loanChannel) ?? {
      label: row.loanChannel,
      requestCount: 0,
      expectedRevenue: 0,
      paidRevenue: 0,
    };
    channel.requestCount += 1;
    channel.expectedRevenue = money(channel.expectedRevenue + row.expectedRevenue);
    if (row.status === PayrollCompRequestStatus.PAID) {
      channel.paidRevenue = money(channel.paidRevenue + row.expectedRevenue);
    }
    byChannel.set(row.loanChannel, channel);

    for (const split of row.splits) {
      const key = `${split.recipientEmail ?? split.recipientName}:${split.roleLabel}`;
      const current = splitRows.get(key) ?? {
        recipientName: split.recipientName,
        recipientEmail: split.recipientEmail,
        roleLabel: split.roleLabel,
        amount: 0,
        requestCount: 0,
      };
      current.amount = money(current.amount + split.amount);
      current.requestCount += 1;
      splitRows.set(key, current);
    }
  }

  return {
    summary,
    byLoanOfficer: Array.from(byLoanOfficer.values()).sort((a, b) => b.expectedRevenue - a.expectedRevenue),
    splitRows: Array.from(splitRows.values()).sort((a, b) => b.amount - a.amount),
    byLender: Array.from(byLender.values()).sort((a, b) => b.expectedRevenue - a.expectedRevenue),
    byLoanType: Array.from(byLoanType.values()).sort((a, b) => b.expectedRevenue - a.expectedRevenue),
    byChannel: Array.from(byChannel.values()).sort((a, b) => b.expectedRevenue - a.expectedRevenue),
    detailRows: rows,
  };
}

export async function getPayrollFilterOptions() {
  await assertPayrollAdmin();
  const loanOfficers = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: UserRole.LOAN_OFFICER },
        { roles: { has: UserRole.LOAN_OFFICER } },
      ],
    },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true },
  });
  return { loanOfficers };
}
