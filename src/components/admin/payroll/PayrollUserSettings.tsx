'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { Loader2, Plus, Save, Trash2, UserCog } from 'lucide-react';
import { PayrollUserClassification } from '@prisma/client';
import {
  savePayrollCompPlanSettings,
  type PayrollUserPlanDetail,
  type PayrollUserPlanRow,
} from '@/app/actions/payrollActions';
import { formatPercent } from './payrollFormat';

type EligibleUser = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type SplitDraft = {
  recipientUserId: string | null;
  recipientName: string;
  recipientEmail?: string | null;
  roleLabel: string;
  splitPercent: string;
  mandatory?: boolean;
};

type PlanDraft = {
  baseSplit: string;
  notes: string;
  splits: SplitDraft[];
};

const HOUSE_SPLIT: SplitDraft = {
  recipientUserId: null,
  recipientName: 'House',
  recipientEmail: null,
  roleLabel: 'House',
  splitPercent: '0',
  mandatory: true,
};

function withMandatoryHouseSplit(splits: SplitDraft[]) {
  const existingHouse = splits.find((split) => split.mandatory || split.roleLabel.trim().toLowerCase() === 'house');
  const otherSplits = splits.filter((split) => split !== existingHouse);
  return [
    existingHouse
      ? {
          ...existingHouse,
          recipientUserId: null,
          recipientName: existingHouse.recipientName || 'House',
          recipientEmail: null,
          roleLabel: 'House',
          mandatory: true,
        }
      : HOUSE_SPLIT,
    ...otherSplits,
  ];
}

function planToDraft(plan: PayrollUserPlanDetail | null): PlanDraft {
  return {
    baseSplit: plan?.baseSplitPercent.toString() ?? '100',
    notes: plan?.notes ?? '',
    splits: withMandatoryHouseSplit(
      plan?.splits.map((split) => ({
        recipientUserId: split.recipientUserId,
        recipientName: split.recipientName,
        recipientEmail: split.recipientEmail,
        roleLabel: split.roleLabel,
        splitPercent: split.splitPercent.toString(),
      })) ?? []
    ),
  };
}

function emptyRetailDraft() {
  return {
    baseSplit: '100',
    notes: '',
    splits: withMandatoryHouseSplit([]),
  };
}

function draftToInput(plan: PlanDraft) {
  return {
    baseSplitPercent: Number(plan.baseSplit),
    notes: plan.notes,
    splits: plan.splits
      .filter((split) => split.recipientName.trim() && split.roleLabel.trim())
      .map((split) => ({
        recipientUserId: split.recipientUserId,
        recipientName: split.recipientName,
        recipientEmail: split.recipientEmail,
        roleLabel: split.roleLabel,
        splitPercent: Number(split.splitPercent),
      })),
  };
}

export function PayrollUserSettings({
  users,
  eligibleUsers,
}: {
  users: PayrollUserPlanRow[];
  eligibleUsers: EligibleUser[];
}) {
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? '');
  const [userSearch, setUserSearch] = useState('');
  const selected = users.find((user) => user.id === selectedId) ?? users[0] ?? null;
  const [classification, setClassification] = useState<PayrollUserClassification>(
    selected?.userClassification ?? PayrollUserClassification.BROKER
  );
  const [brokerPlan, setBrokerPlan] = useState<PlanDraft>(planToDraft(selected?.plan ?? null));
  const [retailPlan, setRetailPlan] = useState<PlanDraft>(selected?.retailPlan ? planToDraft(selected.retailPlan) : emptyRetailDraft());
  const [isPending, startTransition] = useTransition();

  const recipientOptions = useMemo(
    () => eligibleUsers.filter((user) => user.id !== selected?.id),
    [eligibleUsers, selected?.id]
  );
  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    if (!term) return users;
    return users.filter((user) =>
      [user.name, user.email].some((value) => value.toLowerCase().includes(term))
    );
  }, [userSearch, users]);

  const brokerTotal = useMemo(() => {
    const base = Number(brokerPlan.baseSplit) || 0;
    return base + brokerPlan.splits.reduce((sum, split) => sum + (Number(split.splitPercent) || 0), 0);
  }, [brokerPlan]);
  const retailTotal = useMemo(() => {
    const base = Number(retailPlan.baseSplit) || 0;
    return base + retailPlan.splits.reduce((sum, split) => sum + (Number(split.splitPercent) || 0), 0);
  }, [retailPlan]);

  const chooseUser = (id: string) => {
    const user = users.find((item) => item.id === id) ?? null;
    setSelectedId(id);
    setClassification(user?.userClassification ?? PayrollUserClassification.BROKER);
    setBrokerPlan(planToDraft(user?.plan ?? null));
    setRetailPlan(user?.retailPlan ? planToDraft(user.retailPlan) : emptyRetailDraft());
  };

  const save = () => {
    if (!selected) return;
    startTransition(async () => {
      await savePayrollCompPlanSettings({
        loanOfficerId: selected.id,
        userClassification: classification,
        brokerPlan: draftToInput(brokerPlan),
        retailPlan: classification === PayrollUserClassification.BROKER ? draftToInput(retailPlan) : null,
      });
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div className="sticky top-4 flex max-h-[calc(100vh-8rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="shrink-0 border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">Loan Officers</h2>
          <p className="text-sm text-slate-500">Select a user to configure payroll splits.</p>
          <input
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="Search loan officers..."
            className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filteredUsers.map((user) => (
            <button
              key={user.id}
              type="button"
              onClick={() => chooseUser(user.id)}
              className={`w-full rounded-xl px-3 py-3 text-left transition ${
                selected?.id === user.id ? 'bg-emerald-50 text-emerald-950 ring-1 ring-emerald-200' : 'hover:bg-slate-50'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold">{user.name}</p>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${user.plan ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {user.plan ? 'Configured' : 'Default'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
                  <UserCog className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">{selected.name}</h2>
                  <p className="text-sm text-slate-500">{selected.email}</p>
                </div>
              </div>
              <button
                type="button"
                className="app-btn-primary"
                disabled={isPending}
                onClick={save}
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Splits
              </button>
            </div>

            <div className="space-y-6 p-6">
              <section className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Payroll Classification</p>
                <div className="mt-3 grid gap-3 md:grid-cols-3">
                  {[
                    { value: PayrollUserClassification.BROKER, title: 'Broker', description: 'Default split plus optional retail split.' },
                    { value: PayrollUserClassification.RETAIL, title: 'Retail', description: 'Uses the default retail-style split only.' },
                    { value: PayrollUserClassification.SUPPORT_STAFF, title: 'Support Staff', description: 'Payroll participant for split visibility.' },
                  ].map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setClassification(option.value)}
                      className={`rounded-xl border px-4 py-3 text-left transition ${
                        classification === option.value
                          ? 'border-emerald-300 bg-white text-emerald-950 shadow-sm ring-2 ring-emerald-100'
                          : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      <span className="block font-bold">{option.title}</span>
                      <span className="mt-1 block text-xs text-slate-500">{option.description}</span>
                    </button>
                  ))}
                </div>
              </section>

              <SplitPlanEditor
                title={classification === PayrollUserClassification.BROKER ? 'Broker / Default Split' : 'Default Split'}
                subtitle="Used for self-sourced or normal compensation scenarios."
                plan={brokerPlan}
                setPlan={setBrokerPlan}
                recipientOptions={recipientOptions}
                total={brokerTotal}
              />

              {classification === PayrollUserClassification.BROKER && (
                <SplitPlanEditor
                  title="Retail Split"
                  subtitle="Used automatically for company, branch, lead buy, mailer, or warm transfer scenarios."
                  plan={retailPlan}
                  setPlan={setRetailPlan}
                  recipientOptions={recipientOptions}
                  total={retailTotal}
                />
              )}
            </div>
          </>
        ) : (
          <div className="px-6 py-16 text-center text-sm text-slate-500">No loan officers available for payroll setup.</div>
        )}
      </div>
    </div>
  );
}

function SplitPlanEditor({
  title,
  subtitle,
  plan,
  setPlan,
  recipientOptions,
  total,
}: {
  title: string;
  subtitle: string;
  plan: PlanDraft;
  setPlan: React.Dispatch<React.SetStateAction<PlanDraft>>;
  recipientOptions: EligibleUser[];
  total: number;
}) {
  const updateSplit = (index: number, nextSplit: SplitDraft) => {
    setPlan((current) => ({
      ...current,
      splits: current.splits.map((split, splitIndex) => (splitIndex === index ? nextSplit : split)),
    }));
  };

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 p-4">
      <div>
        <p className="font-bold text-slate-900">{title}</p>
        <p className="text-xs text-slate-500">{subtitle}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-[220px_1fr]">
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">LO Base Split</span>
          <div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
            <input
              value={plan.baseSplit}
              onChange={(event) => setPlan((current) => ({ ...current, baseSplit: event.target.value }))}
              className="w-full border-0 py-2 text-sm outline-none"
              inputMode="decimal"
            />
            <span className="text-sm text-slate-500">%</span>
          </div>
        </label>
        <label className="block">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Notes</span>
          <input
            value={plan.notes}
            onChange={(event) => setPlan((current) => ({ ...current, notes: event.target.value }))}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            placeholder="Optional payroll notes"
          />
        </label>
      </div>

      <div className="rounded-xl border border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <p className="font-bold text-slate-900">Additional Split Recipients</p>
            <p className="text-xs text-slate-500">House, managers, VPs, LOAs, processors, or any user sharing compensation.</p>
          </div>
          <button
            type="button"
            className="app-btn-secondary"
            onClick={() =>
              setPlan((current) => ({
                ...current,
                splits: [...current.splits, { recipientUserId: '', recipientName: '', recipientEmail: null, roleLabel: 'Manager', splitPercent: '0' }],
              }))
            }
          >
            <Plus className="h-4 w-4" /> Add Split
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {plan.splits.map((split, index) => (
            <div key={index} className="grid items-center gap-3 px-4 py-4 md:grid-cols-[minmax(260px,1.35fr)_minmax(180px,1fr)_140px_92px]">
              {split.mandatory ? (
                <div className="flex h-10 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-800">
                  House
                </div>
              ) : (
                <select
                  value={split.recipientUserId ?? ''}
                  onChange={(event) => {
                    const user = recipientOptions.find((option) => option.id === event.target.value);
                    updateSplit(index, {
                      ...split,
                      recipientUserId: user?.id ?? '',
                      recipientName: user?.name ?? '',
                      recipientEmail: user?.email ?? null,
                    });
                  }}
                  className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                >
                  <option value="">Choose recipient</option>
                  {recipientOptions.map((user) => (
                    <option key={user.id} value={user.id}>{user.name} ({user.email})</option>
                  ))}
                </select>
              )}
              <input
                value={split.roleLabel}
                onChange={(event) => updateSplit(index, { ...split, roleLabel: event.target.value })}
                disabled={split.mandatory}
                className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 disabled:bg-slate-50 disabled:text-slate-700"
                placeholder="Manager, VP, LOA"
              />
              <div className="flex h-10 items-center rounded-lg border border-slate-200 px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                <input
                  value={split.splitPercent}
                  onChange={(event) => updateSplit(index, { ...split, splitPercent: event.target.value })}
                  className="w-full border-0 py-2 text-sm outline-none"
                  inputMode="decimal"
                />
                <span className="text-sm text-slate-500">%</span>
              </div>
              <div className="flex h-10 items-center justify-center">
                {split.mandatory ? (
                  <span className="inline-flex h-8 w-full items-center justify-center rounded-full bg-emerald-50 px-3 text-xs font-bold uppercase tracking-wide text-emerald-700">
                    Required
                  </span>
                ) : (
                  <button
                    type="button"
                    className="app-icon-btn text-rose-600 hover:bg-rose-50"
                    aria-label="Remove split"
                    onClick={() => setPlan((current) => ({ ...current, splits: current.splits.filter((_, splitIndex) => splitIndex !== index) }))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${Math.abs(total - 100) < 0.0001 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
        Current total: {formatPercent(total)}. Splits must total 100% before saving.
      </div>
    </section>
  );
}
