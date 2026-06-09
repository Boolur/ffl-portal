'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { Database, Loader2, Plus, Save, Settings2, Split } from 'lucide-react';
import { PayrollFeeRuleKind, PayrollLeadProvidedBy, PayrollLeadSource, PayrollLoanChannel } from '@prisma/client';
import {
  savePayrollBrokerRetailRouting,
  savePayrollLenderFeeRule,
  savePayrollLenderRequirement,
  type PayrollSettingsDatabase,
} from '@/app/actions/payrollActions';
import { PAYROLL_COMPANY_DEFAULT_FEE_LENDER } from '@/lib/payrollFeeRules';
import { PAYROLL_LENDER_OPTIONS } from '@/components/payroll/payrollOptions';
import { formatCurrency, loanChannelLabel, payrollLeadProvidedByLabel, payrollLeadSourceLabel } from './payrollFormat';

type Props = {
  data: PayrollSettingsDatabase;
};

type FeeForm = {
  id?: string;
  lender: string;
  loanChannel: PayrollLoanChannel;
  feeKind: PayrollFeeRuleKind;
  label: string;
  amount: string;
  required: boolean;
  active: boolean;
  notes: string;
};

type RequirementForm = {
  lender: string;
  requiresLoanAmountPriorToFees: boolean;
  requiresFundedDetailsAttachment: boolean;
  requiresRecessionDate: boolean;
  active: boolean;
  notes: string;
};

type FeeRuleRow = PayrollSettingsDatabase['feeRules'][number];

const FEE_KIND_LABELS: Record<PayrollFeeRuleKind, string> = {
  WIRE_FEE: 'Wire Fee',
  UNDERWRITING_FEE: 'Underwriting Fee',
  ORIGINATION_FEE: 'Origination Fee',
  ONE_DAY_INTEREST: '1 Day of Interest',
  LENDER_CREDIT: 'Lender Credit',
  OTHER: 'Other',
};
const LEAD_SOURCE_OPTIONS = Object.values(PayrollLeadSource).filter(
  (source) => source !== PayrollLeadSource.LEAD_BUY
);
const LEAD_PROVIDED_BY_OPTIONS = Object.values(PayrollLeadProvidedBy);

const initialFee: FeeForm = {
  lender: '',
  loanChannel: PayrollLoanChannel.NON_DELEGATED,
  feeKind: PayrollFeeRuleKind.UNDERWRITING_FEE,
  label: 'Underwriting Fee',
  amount: '',
  required: true,
  active: true,
  notes: '',
};

const companyDefaultFee: FeeForm = {
  lender: PAYROLL_COMPANY_DEFAULT_FEE_LENDER,
  loanChannel: PayrollLoanChannel.NON_DELEGATED,
  feeKind: PayrollFeeRuleKind.WIRE_FEE,
  label: 'Wire Fee',
  amount: '180',
  required: true,
  active: true,
  notes: 'Company-wide cure when Wire Fee is entered as $0.',
};

const initialRequirement: RequirementForm = {
  lender: '',
  requiresLoanAmountPriorToFees: true,
  requiresFundedDetailsAttachment: true,
  requiresRecessionDate: true,
  active: true,
  notes: '',
};

export function PayrollSettingsDatabase({ data }: Props) {
  const [feeForm, setFeeForm] = useState(initialFee);
  const [requirementForm, setRequirementForm] = useState(initialRequirement);
  const [routingLeadSources, setRoutingLeadSources] = useState<PayrollLeadSource[]>(
    data.brokerRetailRouting.leadSources.filter((source) => source !== PayrollLeadSource.LEAD_BUY)
  );
  const [routingLeadProvidedBy, setRoutingLeadProvidedBy] = useState<PayrollLeadProvidedBy[]>(data.brokerRetailRouting.leadProvidedBy);
  const [feeLenderOpen, setFeeLenderOpen] = useState(false);
  const [requirementLenderOpen, setRequirementLenderOpen] = useState(false);
  const [feeLenderSearch, setFeeLenderSearch] = useState('');
  const [requirementLenderSearch, setRequirementLenderSearch] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const companyDefaultFees = useMemo(
    () => data.feeRules.filter((rule) => rule.lender === PAYROLL_COMPANY_DEFAULT_FEE_LENDER),
    [data.feeRules]
  );
  const lenderFees = useMemo(
    () => data.feeRules.filter((rule) => rule.lender !== PAYROLL_COMPANY_DEFAULT_FEE_LENDER),
    [data.feeRules]
  );
  const activeLenderFees = useMemo(() => lenderFees.filter((rule) => rule.active), [lenderFees]);
  const inactiveLenderFees = useMemo(() => lenderFees.filter((rule) => !rule.active), [lenderFees]);
  const wireFeeDefault = companyDefaultFees.find((rule) => rule.feeKind === PayrollFeeRuleKind.WIRE_FEE);
  const filteredFeeLenders = useMemo(() => {
    const term = feeLenderSearch.trim().toLowerCase();
    if (!term) return PAYROLL_LENDER_OPTIONS;
    return PAYROLL_LENDER_OPTIONS.filter((lender) => lender.toLowerCase().includes(term));
  }, [feeLenderSearch]);
  const filteredRequirementLenders = useMemo(() => {
    const term = requirementLenderSearch.trim().toLowerCase();
    if (!term) return PAYROLL_LENDER_OPTIONS;
    return PAYROLL_LENDER_OPTIONS.filter((lender) => lender.toLowerCase().includes(term));
  }, [requirementLenderSearch]);

  const saveFee = () => {
    startTransition(async () => {
      setMessage(null);
      await savePayrollLenderFeeRule({
        id: feeForm.id,
        lender: feeForm.lender,
        loanChannel: feeForm.loanChannel,
        feeKind: feeForm.feeKind,
        label: feeForm.label,
        amount: Number(feeForm.amount),
        required: feeForm.required,
        active: feeForm.active,
        notes: feeForm.notes,
      });
      setFeeForm(initialFee);
      setMessage('Fee rule saved.');
    });
  };
  const saveCompanyDefaultFee = () => {
    startTransition(async () => {
      setMessage(null);
      await savePayrollLenderFeeRule({
        id: wireFeeDefault?.id,
        lender: PAYROLL_COMPANY_DEFAULT_FEE_LENDER,
        loanChannel: PayrollLoanChannel.NON_DELEGATED,
        feeKind: PayrollFeeRuleKind.WIRE_FEE,
        label: 'Wire Fee',
        amount: wireFeeDefault?.amount ?? 180,
        required: true,
        active: true,
        notes: wireFeeDefault?.notes ?? 'Company-wide cure when Wire Fee is entered as $0.',
      });
      setMessage('Company default Wire Fee cure saved.');
    });
  };
  const editFeeRule = (rule: FeeRuleRow) => {
    setFeeForm({
      id: rule.id,
      lender: rule.lender,
      loanChannel: rule.loanChannel ?? PayrollLoanChannel.NON_DELEGATED,
      feeKind: rule.feeKind,
      label: rule.label,
      amount: String(rule.amount),
      required: rule.required,
      active: rule.active,
      notes: rule.notes ?? '',
    });
    setFeeLenderSearch('');
    setMessage('Loaded fee rule for editing.');
  };

  const saveRequirement = () => {
    startTransition(async () => {
      setMessage(null);
      await savePayrollLenderRequirement(requirementForm);
      setRequirementForm(initialRequirement);
      setMessage('Lender requirement saved.');
    });
  };
  const saveRouting = () => {
    startTransition(async () => {
      setMessage(null);
      await savePayrollBrokerRetailRouting({
        leadSources: routingLeadSources,
        leadProvidedBy: routingLeadProvidedBy,
      });
      setMessage('Broker split routing saved.');
    });
  };

  return (
    <div className="space-y-6">
      {message && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
          {message}
        </div>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 font-bold text-slate-900">
            <Split className="h-5 w-5 text-emerald-600" />
            Broker Split Routing
          </h2>
          <p className="text-sm text-slate-500">Choose which lead values force Broker loan officers onto their Retail split.</p>
        </div>
        <div className="grid gap-5 p-5 xl:grid-cols-2">
          <RoutingPicker
            title="Retail Split Lead Sources"
            options={LEAD_SOURCE_OPTIONS}
            selected={routingLeadSources}
            labelFor={payrollLeadSourceLabel}
            onToggle={(value) => setRoutingLeadSources((current) => toggleValue(current, value))}
          />
          <RoutingPicker
            title="Retail Split Lead Provided By"
            options={LEAD_PROVIDED_BY_OPTIONS}
            selected={routingLeadProvidedBy}
            labelFor={payrollLeadProvidedByLabel}
            onToggle={(value) => setRoutingLeadProvidedBy((current) => toggleValue(current, value))}
          />
        </div>
        <div className="flex justify-end border-t border-slate-100 px-5 py-4">
          <button type="button" className="app-btn-primary" disabled={isPending} onClick={saveRouting}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save Broker Routing
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-slate-900">
              <Database className="h-5 w-5 text-purple-600" />
              Lender Fee Database
            </h2>
            <p className="text-sm text-slate-500">Set company default cures and lender-specific fees. Missing required fees reduce the split basis before splits.</p>
          </div>
        </div>
        <div className="space-y-5 p-5">
          <div className="rounded-2xl border border-purple-200 bg-purple-50/60 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-bold text-slate-900">Company Default Fee Cures</p>
                <p className="text-sm text-slate-600">These apply when no lender-specific rule exists. Wire Fee is the shared cure used when an LO enters $0.</p>
              </div>
              <button type="button" className="app-btn-primary" disabled={isPending} onClick={saveCompanyDefaultFee}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Ensure Wire Fee Default
              </button>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <DefaultFeeCard
                title="Wire Fee Cure"
                description="Company-wide default when Wire Fee is entered as $0."
                amount={wireFeeDefault?.amount ?? 180}
                active={wireFeeDefault?.active ?? true}
                onEdit={() => {
                  if (wireFeeDefault) {
                    editFeeRule(wireFeeDefault);
                    return;
                  }
                  setFeeForm(companyDefaultFee);
                  setMessage('Loaded company Wire Fee default for editing.');
                }}
              />
              <DefaultFeeCard
                title="Underwriting Fee"
                description="Usually lender-specific. Add rules below for each lender that requires it."
                amount={null}
                active={false}
                onEdit={() => setFeeForm({ ...initialFee, feeKind: PayrollFeeRuleKind.UNDERWRITING_FEE, label: 'Underwriting Fee' })}
              />
              <DefaultFeeCard
                title="Origination Fee"
                description="Usually lender-specific. Add rules below when a lender requires this cure."
                amount={null}
                active={false}
                onEdit={() => setFeeForm({ ...initialFee, feeKind: PayrollFeeRuleKind.ORIGINATION_FEE, label: 'Origination Fee' })}
              />
            </div>
          </div>

          <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-bold text-slate-900">{feeForm.id ? 'Edit Fee Rule' : 'Add Lender-Specific Fee Rule'}</p>
                  <p className="text-sm text-slate-500">Use this for underwriting, origination, and lender-specific overrides.</p>
                </div>
                {feeForm.id && (
                  <button type="button" className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 transition hover:border-purple-300 hover:text-purple-700" onClick={() => setFeeForm(initialFee)}>
                    Cancel Edit
                  </button>
                )}
              </div>
              <div className="mt-4 grid gap-3">
                <SearchableLenderSelect
                  label="Lender"
                  value={feeForm.lender}
                  open={feeLenderOpen}
                  search={feeLenderSearch}
                  options={filteredFeeLenders}
                  onOpenChange={setFeeLenderOpen}
                  onSearchChange={setFeeLenderSearch}
                  onChange={(value) => setFeeForm((current) => ({ ...current, lender: value }))}
                />
                <Input label="Fee Label" value={feeForm.label} onChange={(value) => setFeeForm((current) => ({ ...current, label: value }))} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Select label="Channel" value={feeForm.loanChannel} onChange={(value) => setFeeForm((current) => ({ ...current, loanChannel: value as PayrollLoanChannel }))} options={[PayrollLoanChannel.BROKER, PayrollLoanChannel.NON_DELEGATED]} labels={{ BROKER: 'Broker', NON_DELEGATED: 'Non-Del' }} />
                  <Select label="Fee Type" value={feeForm.feeKind} onChange={(value) => setFeeForm((current) => ({ ...current, feeKind: value as PayrollFeeRuleKind, label: FEE_KIND_LABELS[value as PayrollFeeRuleKind] }))} options={Object.values(PayrollFeeRuleKind)} labels={FEE_KIND_LABELS} />
                </div>
                <Input label="Expected Amount" value={feeForm.amount} onChange={(value) => setFeeForm((current) => ({ ...current, amount: value }))} inputMode="decimal" />
                <Input label="Notes" value={feeForm.notes} onChange={(value) => setFeeForm((current) => ({ ...current, notes: value }))} />
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={feeForm.required} onChange={(event) => setFeeForm((current) => ({ ...current, required: event.target.checked }))} />
                  Required for this lender/default
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input type="checkbox" checked={feeForm.active} onChange={(event) => setFeeForm((current) => ({ ...current, active: event.target.checked }))} />
                  Active
                </label>
                <button type="button" className="app-btn-primary justify-center" disabled={isPending} onClick={saveFee}>
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Fee Rule
                </button>
              </div>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">Lender-Specific Fee Rules</div>
              <div className="divide-y divide-slate-100">
                {activeLenderFees.length === 0 ? (
                  <p className="p-6 text-center text-sm text-slate-500">No active lender-specific fee rules yet.</p>
                ) : activeLenderFees.map((rule) => (
                  <div key={rule.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
                    <div>
                      <p className="font-semibold text-slate-900">{rule.lender} · {rule.label}</p>
                      <p className="text-xs text-slate-500">{rule.loanChannel ? loanChannelLabel(rule.loanChannel) : 'All channels'} · {FEE_KIND_LABELS[rule.feeKind]} · {rule.required ? 'Required' : 'Optional'}</p>
                      {rule.notes && <p className="mt-1 text-xs text-slate-500">{rule.notes}</p>}
                    </div>
                    <div className="flex items-center justify-between gap-3 sm:justify-end">
                      <p className="font-bold text-slate-900">{formatCurrency(rule.amount)}</p>
                      <button type="button" className="rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs font-bold text-purple-700 transition hover:bg-purple-50" onClick={() => editFeeRule(rule)}>
                        Edit
                      </button>
                    </div>
                  </div>
                ))}
                {inactiveLenderFees.length > 0 && <p className="bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">{inactiveLenderFees.length} inactive lender rules hidden from active list.</p>}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="flex items-center gap-2 font-bold text-slate-900">
            <Settings2 className="h-5 w-5 text-amber-600" />
            Lender Requirements
          </h2>
          <p className="text-sm text-slate-500">Set Figure/NFTY style requirements for lender-specific supporting details.</p>
        </div>
        <div className="grid gap-5 p-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
            <p className="font-bold text-slate-900">Add Lender Requirement</p>
            <div className="mt-4 grid gap-3">
              <SearchableLenderSelect
                label="Lender"
                value={requirementForm.lender}
                open={requirementLenderOpen}
                search={requirementLenderSearch}
                options={filteredRequirementLenders}
                onOpenChange={setRequirementLenderOpen}
                onSearchChange={setRequirementLenderSearch}
                onChange={(value) => setRequirementForm((current) => ({ ...current, lender: value }))}
              />
              <Checkbox label="Require loan amount prior to fees" checked={requirementForm.requiresLoanAmountPriorToFees} onChange={(checked) => setRequirementForm((current) => ({ ...current, requiresLoanAmountPriorToFees: checked }))} />
              <Checkbox label="Require funded/details screenshot" checked={requirementForm.requiresFundedDetailsAttachment} onChange={(checked) => setRequirementForm((current) => ({ ...current, requiresFundedDetailsAttachment: checked }))} />
              <Checkbox label="Require recession date" checked={requirementForm.requiresRecessionDate} onChange={(checked) => setRequirementForm((current) => ({ ...current, requiresRecessionDate: checked }))} />
              <Input label="Notes" value={requirementForm.notes} onChange={(value) => setRequirementForm((current) => ({ ...current, notes: value }))} />
              <button type="button" className="app-btn-primary justify-center" disabled={isPending} onClick={saveRequirement}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Save Requirement
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">Configured Requirements</div>
            <div className="divide-y divide-slate-100">
              {data.lenderRequirements.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500">No lender requirements yet.</p>
              ) : data.lenderRequirements.map((requirement) => (
                <div key={requirement.id} className="p-4">
                  <p className="font-semibold text-slate-900">{requirement.lender}</p>
                  <p className="text-xs text-slate-500">
                    {[
                      requirement.requiresLoanAmountPriorToFees ? 'Loan amount prior to fees' : null,
                      requirement.requiresFundedDetailsAttachment ? 'Funded/details screenshot' : null,
                      requirement.requiresRecessionDate ? 'Recession date' : null,
                    ].filter(Boolean).join(' · ') || 'No active requirements'}
                  </p>
                  {requirement.notes && <p className="mt-1 text-xs text-slate-500">{requirement.notes}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function Input({ label, value, onChange, inputMode }: { label: string; value: string; onChange: (value: string) => void; inputMode?: React.HTMLAttributes<HTMLInputElement>['inputMode'] }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} inputMode={inputMode} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20" />
    </label>
  );
}

function DefaultFeeCard({
  title,
  description,
  amount,
  active,
  onEdit,
}: {
  title: string;
  description: string;
  amount: number | null;
  active: boolean;
  onEdit: () => void;
}) {
  return (
    <div className="rounded-xl border border-white/70 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-bold text-slate-900">{title}</p>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {active ? 'Active' : 'Per lender'}
        </span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-lg font-extrabold text-slate-950">{amount === null ? 'Per lender' : formatCurrency(amount)}</p>
        <button type="button" className="rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs font-bold text-purple-700 transition hover:bg-purple-50" onClick={onEdit}>
          Edit
        </button>
      </div>
    </div>
  );
}

function toggleValue<T extends string>(values: T[], value: T) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

function RoutingPicker<T extends string>({
  title,
  options,
  selected,
  labelFor,
  onToggle,
}: {
  title: string;
  options: T[];
  selected: T[];
  labelFor: (value: T) => string;
  onToggle: (value: T) => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4">
      <p className="font-bold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">Selected values will use the Broker user&apos;s Retail split.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((option) => {
          const active = selected.includes(option);
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                active
                  ? 'border-emerald-500 bg-emerald-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-700'
              }`}
            >
              {labelFor(option)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SearchableLenderSelect({
  label,
  value,
  open,
  search,
  options,
  onOpenChange,
  onSearchChange,
  onChange,
}: {
  label: string;
  value: string;
  open: boolean;
  search: string;
  options: string[];
  onOpenChange: (open: boolean) => void;
  onSearchChange: (value: string) => void;
  onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="mt-1 flex w-full items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-sm outline-none transition focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
      >
        <span className={value ? 'text-slate-900' : 'text-slate-400'}>{value || 'Select lender...'}</span>
        <span className="text-slate-400">⌄</span>
      </button>
      {open && (
        <div className="absolute z-30 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
          <div className="border-b border-slate-100 p-2">
            <input
              value={search}
              onChange={(event) => onSearchChange(event.target.value)}
              placeholder="Search lenders..."
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20"
              autoFocus
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {options.length === 0 ? (
              <p className="px-3 py-3 text-sm text-slate-500">No lenders found.</p>
            ) : options.map((lender) => (
              <button
                key={lender}
                type="button"
                className={`block w-full px-3 py-2 text-left text-sm transition hover:bg-purple-50 hover:text-purple-700 ${
                  value === lender ? 'bg-purple-50 font-semibold text-purple-700' : 'text-slate-700'
                }`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(lender);
                  onSearchChange('');
                  onOpenChange(false);
                }}
              >
                {lender}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Select<T extends string>({ label, value, onChange, options, labels }: { label: string; value: T; onChange: (value: T) => void; options: T[]; labels: Record<T, string> }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/20">
        {options.map((option) => <option key={option} value={option}>{labels[option]}</option>)}
      </select>
    </label>
  );
}

function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}
