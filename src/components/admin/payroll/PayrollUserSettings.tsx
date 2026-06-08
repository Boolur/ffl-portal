'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus, Save, Trash2, UserCog } from 'lucide-react';
import { PayrollSalaryFrequency, PayrollSplitPayType, PayrollUserClassification } from '@prisma/client';
import {
  savePayrollCompPlanSettings,
  savePayrollTeamCompPlanSettings,
  type PayrollUserPlanDetail,
  type PayrollUserPlanRow,
} from '@/app/actions/payrollActions';
import {
  LeadUserTeamManager,
  type LeadUserTeamSummary,
} from '@/components/admin/leads/LeadUserTeamManager';
import { formatCurrency, formatPercent } from './payrollFormat';

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
  payType: PayrollSplitPayType;
  splitPercent: string;
  flatAmount: string;
  mandatory?: boolean;
};

type PlanDraft = {
  baseSplit: string;
  notes: string;
  splits: SplitDraft[];
};

type SalaryDraft = {
  salaryPerPaycheck: string;
  salaryFrequency: PayrollSalaryFrequency;
  salaryNotes: string;
};

const HOUSE_SPLIT: SplitDraft = {
  recipientUserId: null,
  recipientName: 'House',
  recipientEmail: null,
  roleLabel: 'House',
  payType: PayrollSplitPayType.PERCENT,
  splitPercent: '0',
  flatAmount: '',
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
          payType: existingHouse.payType ?? PayrollSplitPayType.PERCENT,
          flatAmount: existingHouse.flatAmount ?? '',
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
        payType: split.payType,
        splitPercent: split.splitPercent.toString(),
        flatAmount: split.flatAmount?.toString() ?? '',
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
        payType: split.payType,
        splitPercent: Number(split.splitPercent),
        flatAmount: split.flatAmount ? Number(split.flatAmount) : null,
      })),
  };
}

function salaryFrequencyLabel(frequency: PayrollSalaryFrequency) {
  const labels: Record<PayrollSalaryFrequency, string> = {
    SEMI_MONTHLY: 'Semi Monthly',
    MONTHLY: 'Monthly',
    ANNUALLY: 'Annually',
  };
  return labels[frequency];
}

export function PayrollUserSettings({
  users,
  eligibleUsers,
  teams = [],
}: {
  users: PayrollUserPlanRow[];
  eligibleUsers: EligibleUser[];
  teams?: LeadUserTeamSummary[];
}) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? '');
  const [userSearch, setUserSearch] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [editingPayrollTeam, setEditingPayrollTeam] = useState<LeadUserTeamSummary | null>(null);
  const [teamSaveMessage, setTeamSaveMessage] = useState<string | null>(null);
  const selected = users.find((user) => user.id === selectedId) ?? users[0] ?? null;
  const [classification, setClassification] = useState<PayrollUserClassification>(
    selected?.userClassification ?? PayrollUserClassification.BROKER
  );
  const [salary, setSalary] = useState<SalaryDraft>({
    salaryPerPaycheck: selected?.plan?.salaryPerPaycheck?.toString() ?? '',
    salaryFrequency: selected?.plan?.salaryFrequency ?? PayrollSalaryFrequency.SEMI_MONTHLY,
    salaryNotes: selected?.plan?.salaryNotes ?? '',
  });
  const [brokerPlan, setBrokerPlan] = useState<PlanDraft>(planToDraft(selected?.plan ?? null));
  const [retailPlan, setRetailPlan] = useState<PlanDraft>(selected?.retailPlan ? planToDraft(selected.retailPlan) : emptyRetailDraft());
  const [isPending, startTransition] = useTransition();

  const recipientOptions = useMemo(
    () => eligibleUsers.filter((user) => user.id !== selected?.id),
    [eligibleUsers, selected?.id]
  );
  const selectedTeamMemberIds = useMemo(() => {
    if (!selectedTeamId) return null;
    const team = teams.find((item) => item.id === selectedTeamId);
    return team ? new Set(team.memberIds) : null;
  }, [selectedTeamId, teams]);
  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    let list = users;
    if (selectedTeamMemberIds) {
      list = list.filter((user) => selectedTeamMemberIds.has(user.id));
    }
    if (term) {
      list = list.filter((user) =>
        [user.name, user.email].some((value) => value.toLowerCase().includes(term))
      );
    }
    return list;
  }, [selectedTeamMemberIds, userSearch, users]);

  const brokerTotal = useMemo(() => {
    const base = Number(brokerPlan.baseSplit) || 0;
    return base + brokerPlan.splits.reduce((sum, split) => sum + (split.payType !== PayrollSplitPayType.FLAT ? Number(split.splitPercent) || 0 : 0), 0);
  }, [brokerPlan]);
  const retailTotal = useMemo(() => {
    const base = Number(retailPlan.baseSplit) || 0;
    return base + retailPlan.splits.reduce((sum, split) => sum + (split.payType !== PayrollSplitPayType.FLAT ? Number(split.splitPercent) || 0 : 0), 0);
  }, [retailPlan]);
  const brokerFlatTotal = useMemo(
    () => brokerPlan.splits.reduce((sum, split) => sum + (split.payType !== PayrollSplitPayType.PERCENT ? Number(split.flatAmount) || 0 : 0), 0),
    [brokerPlan.splits]
  );
  const retailFlatTotal = useMemo(
    () => retailPlan.splits.reduce((sum, split) => sum + (split.payType !== PayrollSplitPayType.PERCENT ? Number(split.flatAmount) || 0 : 0), 0),
    [retailPlan.splits]
  );

  const chooseUser = (id: string) => {
    const user = users.find((item) => item.id === id) ?? null;
    setSelectedId(id);
    setClassification(user?.userClassification ?? PayrollUserClassification.BROKER);
    setSalary({
      salaryPerPaycheck: user?.plan?.salaryPerPaycheck?.toString() ?? '',
      salaryFrequency: user?.plan?.salaryFrequency ?? PayrollSalaryFrequency.SEMI_MONTHLY,
      salaryNotes: user?.plan?.salaryNotes ?? '',
    });
    setBrokerPlan(planToDraft(user?.plan ?? null));
    setRetailPlan(user?.retailPlan ? planToDraft(user.retailPlan) : emptyRetailDraft());
  };

  const save = () => {
    if (!selected) return;
    startTransition(async () => {
      await savePayrollCompPlanSettings({
        loanOfficerId: selected.id,
        userClassification: classification,
        salaryPerPaycheck: salary.salaryPerPaycheck ? Number(salary.salaryPerPaycheck) : null,
        salaryFrequency: salary.salaryFrequency,
        salaryNotes: salary.salaryNotes,
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
          <div className="mt-3">
            <LeadUserTeamManager
              teams={teams}
              users={eligibleUsers}
              selectedTeamId={selectedTeamId}
              onSelectTeam={setSelectedTeamId}
              emptyMessage="No teams yet — create one to filter payroll users in one click."
              modalDescription="Teams are shared with Lead Distribution and Payroll Users. Updating membership here updates the same team everywhere in the portal."
              deleteDescription="Deleting a team is permanent and removes the shared filter from Lead Distribution and Payroll Users. Users keep their lead campaign assignments and payroll settings."
              renderTeamActions={(team) => (
                <button
                  type="button"
                  onClick={() => {
                    setEditingPayrollTeam(team);
                    setTeamSaveMessage(null);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition-colors hover:border-emerald-300 hover:bg-emerald-100"
                  title={`Edit payroll splits for ${team.name}`}
                >
                  <UserCog className="h-3.5 w-3.5" />
                  Edit Payroll
                </button>
              )}
            />
          </div>
          {teamSaveMessage ? (
            <p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
              {teamSaveMessage}
            </p>
          ) : null}
          <input
            value={userSearch}
            onChange={(event) => setUserSearch(event.target.value)}
            placeholder="Search loan officers..."
            className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
          />
          {selectedTeamId ? (
            <p className="mt-2 text-xs text-slate-500">
              Showing {filteredUsers.length} payroll user{filteredUsers.length === 1 ? '' : 's'} in{' '}
              <span className="font-semibold text-slate-700">
                {teams.find((team) => team.id === selectedTeamId)?.name ?? 'selected team'}
              </span>
              .
            </p>
          ) : null}
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
              <PayrollPlanEditorContent
                classification={classification}
                setClassification={setClassification}
                salary={salary}
                setSalary={setSalary}
                brokerPlan={brokerPlan}
                setBrokerPlan={setBrokerPlan}
                retailPlan={retailPlan}
                setRetailPlan={setRetailPlan}
                recipientOptions={recipientOptions}
                brokerTotal={brokerTotal}
                retailTotal={retailTotal}
                brokerFlatTotal={brokerFlatTotal}
                retailFlatTotal={retailFlatTotal}
              />
            </div>
          </>
        ) : (
          <div className="px-6 py-16 text-center text-sm text-slate-500">No loan officers available for payroll setup.</div>
        )}
      </div>
      {editingPayrollTeam ? (
        <TeamPayrollEditModal
          team={editingPayrollTeam}
          users={users}
          eligibleUsers={eligibleUsers}
          seedUser={selected}
          onClose={() => setEditingPayrollTeam(null)}
          onSaved={(message) => {
            setEditingPayrollTeam(null);
            setTeamSaveMessage(message);
            router.refresh();
          }}
        />
      ) : null}
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
  flatTotal,
}: {
  title: string;
  subtitle: string;
  plan: PlanDraft;
  setPlan: React.Dispatch<React.SetStateAction<PlanDraft>>;
  recipientOptions: EligibleUser[];
  total: number;
  flatTotal: number;
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
                splits: [...current.splits, { recipientUserId: '', recipientName: '', recipientEmail: null, roleLabel: 'Manager', payType: PayrollSplitPayType.PERCENT, splitPercent: '0', flatAmount: '' }],
              }))
            }
          >
            <Plus className="h-4 w-4" /> Add Split
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {plan.splits.map((split, index) => (
            <div key={index} className="grid items-center gap-3 px-4 py-4 md:grid-cols-[minmax(230px,1.25fr)_minmax(150px,0.8fr)_130px_120px_120px_92px]">
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
              <select
                value={split.payType}
                onChange={(event) => updateSplit(index, { ...split, payType: event.target.value as PayrollSplitPayType })}
                className="h-10 rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              >
                <option value={PayrollSplitPayType.PERCENT}>Percent</option>
                <option value={PayrollSplitPayType.FLAT}>Dollar</option>
                <option value={PayrollSplitPayType.BOTH}>Both</option>
              </select>
              <div className="flex h-10 items-center rounded-lg border border-slate-200 px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                <input
                  value={split.splitPercent}
                  onChange={(event) => updateSplit(index, { ...split, splitPercent: event.target.value })}
                  disabled={split.payType === PayrollSplitPayType.FLAT}
                  className="w-full border-0 py-2 text-sm outline-none"
                  inputMode="decimal"
                />
                <span className="text-sm text-slate-500">%</span>
              </div>
              <div className="flex h-10 items-center rounded-lg border border-slate-200 px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                <span className="text-sm text-slate-500">$</span>
                <input
                  value={split.flatAmount}
                  onChange={(event) => updateSplit(index, { ...split, flatAmount: event.target.value })}
                  disabled={split.payType === PayrollSplitPayType.PERCENT}
                  className="w-full border-0 py-2 pl-1 text-sm outline-none"
                  inputMode="decimal"
                />
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
        Percentage total: {formatPercent(total)}. Splits must total 100% before saving.
        {flatTotal > 0 ? <span className="ml-2">Flat fees: {formatCurrency(flatTotal)} per file.</span> : null}
      </div>
    </section>
  );
}

function PayrollPlanEditorContent({
  classification,
  setClassification,
  salary,
  setSalary,
  brokerPlan,
  setBrokerPlan,
  retailPlan,
  setRetailPlan,
  recipientOptions,
  brokerTotal,
  retailTotal,
  brokerFlatTotal,
  retailFlatTotal,
}: {
  classification: PayrollUserClassification;
  setClassification: React.Dispatch<React.SetStateAction<PayrollUserClassification>>;
  salary: SalaryDraft;
  setSalary: React.Dispatch<React.SetStateAction<SalaryDraft>>;
  brokerPlan: PlanDraft;
  setBrokerPlan: React.Dispatch<React.SetStateAction<PlanDraft>>;
  retailPlan: PlanDraft;
  setRetailPlan: React.Dispatch<React.SetStateAction<PlanDraft>>;
  recipientOptions: EligibleUser[];
  brokerTotal: number;
  retailTotal: number;
  brokerFlatTotal: number;
  retailFlatTotal: number;
}) {
  return (
    <>
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

      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-bold text-slate-900">Salary Settings</p>
            <p className="text-xs text-slate-500">Enter salary as semi-monthly, monthly, or annual. The portal converts it to the next 1st/16th paycheck.</p>
          </div>
          {salary.salaryPerPaycheck ? (
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              {formatCurrency(Number(salary.salaryPerPaycheck))} / paycheck
              {' '}· {salaryFrequencyLabel(salary.salaryFrequency)}
            </span>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 md:grid-cols-[220px_220px_1fr]">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Salary Amount</span>
            <div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
              <span className="text-sm text-slate-500">$</span>
              <input
                value={salary.salaryPerPaycheck}
                onChange={(event) => setSalary((current) => ({ ...current, salaryPerPaycheck: event.target.value }))}
                className="w-full border-0 py-2 pl-1 text-sm outline-none"
                inputMode="decimal"
                placeholder="0.00"
              />
            </div>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Salary Basis</span>
            <select
              value={salary.salaryFrequency}
              onChange={(event) => setSalary((current) => ({ ...current, salaryFrequency: event.target.value as PayrollSalaryFrequency }))}
              className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
            >
              <option value={PayrollSalaryFrequency.SEMI_MONTHLY}>Semi Monthly</option>
              <option value={PayrollSalaryFrequency.MONTHLY}>Monthly</option>
              <option value={PayrollSalaryFrequency.ANNUALLY}>Annually</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Salary Notes</span>
            <input
              value={salary.salaryNotes}
              onChange={(event) => setSalary((current) => ({ ...current, salaryNotes: event.target.value }))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
              placeholder="Optional salary notes"
            />
          </label>
        </div>
      </section>

      <SplitPlanEditor
        title={classification === PayrollUserClassification.BROKER ? 'Broker / Default Split' : 'Default Split'}
        subtitle="Used for self-sourced or normal compensation scenarios."
        plan={brokerPlan}
        setPlan={setBrokerPlan}
        recipientOptions={recipientOptions}
        total={brokerTotal}
        flatTotal={brokerFlatTotal}
      />

      {classification === PayrollUserClassification.BROKER && (
        <SplitPlanEditor
          title="Retail Split"
          subtitle="Used automatically for company, branch, lead buy, mailer, or warm transfer scenarios."
          plan={retailPlan}
          setPlan={setRetailPlan}
          recipientOptions={recipientOptions}
          total={retailTotal}
          flatTotal={retailFlatTotal}
        />
      )}
    </>
  );
}

function TeamPayrollEditModal({
  team,
  users,
  eligibleUsers,
  seedUser,
  onClose,
  onSaved,
}: {
  team: LeadUserTeamSummary;
  users: PayrollUserPlanRow[];
  eligibleUsers: EligibleUser[];
  seedUser: PayrollUserPlanRow | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [classification, setClassification] = useState<PayrollUserClassification>(
    seedUser?.userClassification ?? PayrollUserClassification.BROKER
  );
  const [salary, setSalary] = useState<SalaryDraft>({
    salaryPerPaycheck: seedUser?.plan?.salaryPerPaycheck?.toString() ?? '',
    salaryFrequency: seedUser?.plan?.salaryFrequency ?? PayrollSalaryFrequency.SEMI_MONTHLY,
    salaryNotes: seedUser?.plan?.salaryNotes ?? '',
  });
  const [brokerPlan, setBrokerPlan] = useState<PlanDraft>(planToDraft(seedUser?.plan ?? null));
  const [retailPlan, setRetailPlan] = useState<PlanDraft>(seedUser?.retailPlan ? planToDraft(seedUser.retailPlan) : emptyRetailDraft());
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirmApply, setConfirmApply] = useState(false);

  const affectedUsers = useMemo(
    () => users.filter((user) => team.memberIds.includes(user.id)),
    [team.memberIds, users]
  );
  const affectedCount = affectedUsers.length;
  const affectedUserIds = useMemo(
    () => new Set(affectedUsers.map((user) => user.id)),
    [affectedUsers]
  );
  const recipientOptions = useMemo(
    () => eligibleUsers.filter((user) => !affectedUserIds.has(user.id)),
    [affectedUserIds, eligibleUsers]
  );
  const brokerTotal = useMemo(() => {
    const base = Number(brokerPlan.baseSplit) || 0;
    return base + brokerPlan.splits.reduce((sum, split) => sum + (split.payType !== PayrollSplitPayType.FLAT ? Number(split.splitPercent) || 0 : 0), 0);
  }, [brokerPlan]);
  const retailTotal = useMemo(() => {
    const base = Number(retailPlan.baseSplit) || 0;
    return base + retailPlan.splits.reduce((sum, split) => sum + (split.payType !== PayrollSplitPayType.FLAT ? Number(split.splitPercent) || 0 : 0), 0);
  }, [retailPlan]);
  const brokerFlatTotal = useMemo(
    () => brokerPlan.splits.reduce((sum, split) => sum + (split.payType !== PayrollSplitPayType.PERCENT ? Number(split.flatAmount) || 0 : 0), 0),
    [brokerPlan.splits]
  );
  const retailFlatTotal = useMemo(
    () => retailPlan.splits.reduce((sum, split) => sum + (split.payType !== PayrollSplitPayType.PERCENT ? Number(split.flatAmount) || 0 : 0), 0),
    [retailPlan.splits]
  );

  const saveTeam = () => {
    if (affectedCount === 0) {
      setError('This team does not have any payroll users to update.');
      return;
    }
    if (!confirmApply) {
      setConfirmApply(true);
      setError(null);
      return;
    }
    startTransition(async () => {
      try {
        setError(null);
        const result = await savePayrollTeamCompPlanSettings({
          teamId: team.id,
          userClassification: classification,
          salaryPerPaycheck: salary.salaryPerPaycheck ? Number(salary.salaryPerPaycheck) : null,
          salaryFrequency: salary.salaryFrequency,
          salaryNotes: salary.salaryNotes,
          brokerPlan: draftToInput(brokerPlan),
          retailPlan: classification === PayrollUserClassification.BROKER ? draftToInput(retailPlan) : null,
        });
        onSaved(`Applied payroll splits to ${result.updatedCount} ${result.teamName} team member${result.updatedCount === 1 ? '' : 's'}.`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to apply payroll splits to this team.');
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
      <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">Team Payroll Editor</p>
            <h2 className="mt-1 text-xl font-bold text-slate-950">{team.name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Apply one payroll split setup to {affectedCount} payroll user{affectedCount === 1 ? '' : 's'} in this team.
            </p>
          </div>
          <button type="button" className="app-btn-secondary" onClick={onClose} disabled={isPending}>
            Cancel
          </button>
        </div>
        <div className="max-h-[calc(90vh-150px)] overflow-y-auto p-6">
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <p className="font-bold text-amber-900">Bulk update warning</p>
            <p className="mt-1">
              Saving will replace the active payroll split settings for every active loan officer in this team. Existing submitted payroll requests will keep their saved split snapshots.
            </p>
          </div>
          {error ? (
            <div className="mb-5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
              {error}
            </div>
          ) : null}
          <div className="space-y-6">
            <PayrollPlanEditorContent
              classification={classification}
              setClassification={setClassification}
              salary={salary}
              setSalary={setSalary}
              brokerPlan={brokerPlan}
              setBrokerPlan={setBrokerPlan}
              retailPlan={retailPlan}
              setRetailPlan={setRetailPlan}
              recipientOptions={recipientOptions}
              brokerTotal={brokerTotal}
              retailTotal={retailTotal}
              brokerFlatTotal={brokerFlatTotal}
              retailFlatTotal={retailFlatTotal}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-6 py-4">
          <p className="text-sm text-slate-500">
            {confirmApply
              ? `Click Apply Team Splits again to confirm updating ${affectedCount} user${affectedCount === 1 ? '' : 's'}.`
              : 'Review the template, then apply it to the team.'}
          </p>
          <div className="flex items-center gap-3">
            <button type="button" className="app-btn-secondary" onClick={onClose} disabled={isPending}>
              Cancel
            </button>
            <button type="button" className="app-btn-primary" onClick={saveTeam} disabled={isPending || affectedCount === 0}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {confirmApply ? 'Confirm Apply' : 'Apply Team Splits'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
