'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { Database, Loader2, Plus, Save, Settings2 } from 'lucide-react';
import { PayrollFeeRuleKind, PayrollLoanChannel } from '@prisma/client';
import {
  savePayrollLenderFeeRule,
  savePayrollLenderRequirement,
  type PayrollSettingsDatabase,
} from '@/app/actions/payrollActions';
import { formatCurrency, loanChannelLabel } from './payrollFormat';

type Props = {
  data: PayrollSettingsDatabase;
};

type FeeForm = {
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

const FEE_KIND_LABELS: Record<PayrollFeeRuleKind, string> = {
  WIRE_FEE: 'Wire Fee',
  UNDERWRITING_FEE: 'Underwriting Fee',
  ORIGINATION_FEE: 'Origination Fee',
  ONE_DAY_INTEREST: '1 Day of Interest',
  LENDER_CREDIT: 'Lender Credit',
  OTHER: 'Other',
};

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
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const activeFees = useMemo(() => data.feeRules.filter((rule) => rule.active), [data.feeRules]);
  const inactiveFees = useMemo(() => data.feeRules.filter((rule) => !rule.active), [data.feeRules]);

  const saveFee = () => {
    startTransition(async () => {
      setMessage(null);
      await savePayrollLenderFeeRule({
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

  const saveRequirement = () => {
    startTransition(async () => {
      setMessage(null);
      await savePayrollLenderRequirement(requirementForm);
      setRequirementForm(initialRequirement);
      setMessage('Lender requirement saved.');
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
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="flex items-center gap-2 font-bold text-slate-900">
              <Database className="h-5 w-5 text-purple-600" />
              Lender Fee Database
            </h2>
            <p className="text-sm text-slate-500">Set required fees by lender and channel. Missing required fees reduce the split basis.</p>
          </div>
        </div>
        <div className="grid gap-5 p-5 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
            <p className="font-bold text-slate-900">Add or Update Fee Rule</p>
            <div className="mt-4 grid gap-3">
              <Input label="Lender" value={feeForm.lender} onChange={(value) => setFeeForm((current) => ({ ...current, lender: value }))} />
              <Input label="Fee Label" value={feeForm.label} onChange={(value) => setFeeForm((current) => ({ ...current, label: value }))} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Channel" value={feeForm.loanChannel} onChange={(value) => setFeeForm((current) => ({ ...current, loanChannel: value as PayrollLoanChannel }))} options={[PayrollLoanChannel.BROKER, PayrollLoanChannel.NON_DELEGATED]} labels={{ BROKER: 'Broker', NON_DELEGATED: 'Non-Del' }} />
                <Select label="Fee Type" value={feeForm.feeKind} onChange={(value) => setFeeForm((current) => ({ ...current, feeKind: value as PayrollFeeRuleKind, label: FEE_KIND_LABELS[value as PayrollFeeRuleKind] }))} options={Object.values(PayrollFeeRuleKind)} labels={FEE_KIND_LABELS} />
              </div>
              <Input label="Expected Amount" value={feeForm.amount} onChange={(value) => setFeeForm((current) => ({ ...current, amount: value }))} inputMode="decimal" />
              <Input label="Notes" value={feeForm.notes} onChange={(value) => setFeeForm((current) => ({ ...current, notes: value }))} />
              <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={feeForm.required} onChange={(event) => setFeeForm((current) => ({ ...current, required: event.target.checked }))} />
                Required for this lender
              </label>
              <button type="button" className="app-btn-primary justify-center" disabled={isPending} onClick={saveFee}>
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Fee Rule
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-700">Active Fee Rules</div>
            <div className="divide-y divide-slate-100">
              {activeFees.length === 0 ? (
                <p className="p-6 text-center text-sm text-slate-500">No active fee rules yet.</p>
              ) : activeFees.map((rule) => (
                <div key={rule.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto]">
                  <div>
                    <p className="font-semibold text-slate-900">{rule.lender} · {rule.label}</p>
                    <p className="text-xs text-slate-500">{rule.loanChannel ? loanChannelLabel(rule.loanChannel) : 'All channels'} · {FEE_KIND_LABELS[rule.feeKind]} · {rule.required ? 'Required' : 'Optional'}</p>
                    {rule.notes && <p className="mt-1 text-xs text-slate-500">{rule.notes}</p>}
                  </div>
                  <p className="font-bold text-slate-900">{formatCurrency(rule.amount)}</p>
                </div>
              ))}
              {inactiveFees.length > 0 && <p className="bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-500">{inactiveFees.length} inactive rules hidden from active list.</p>}
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
              <Input label="Lender" value={requirementForm.lender} onChange={(value) => setRequirementForm((current) => ({ ...current, lender: value }))} />
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
