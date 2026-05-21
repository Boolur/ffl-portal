'use client';

import React, { useMemo, useState, useTransition } from 'react';
import { Loader2, Plus, Save, Trash2, UserCog } from 'lucide-react';
import {
  savePayrollCompPlan,
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
  recipientUserId: string;
  roleLabel: string;
  splitPercent: string;
};

export function PayrollUserSettings({
  users,
  eligibleUsers,
}: {
  users: PayrollUserPlanRow[];
  eligibleUsers: EligibleUser[];
}) {
  const [selectedId, setSelectedId] = useState(users[0]?.id ?? '');
  const selected = users.find((user) => user.id === selectedId) ?? users[0] ?? null;
  const [baseSplit, setBaseSplit] = useState(selected?.plan?.baseSplitPercent.toString() ?? '100');
  const [notes, setNotes] = useState(selected?.plan?.notes ?? '');
  const [splits, setSplits] = useState<SplitDraft[]>(
    selected?.plan?.splits.map((split) => ({
      recipientUserId: split.recipientUserId,
      roleLabel: split.roleLabel,
      splitPercent: split.splitPercent.toString(),
    })) ?? []
  );
  const [isPending, startTransition] = useTransition();

  const recipientOptions = useMemo(
    () => eligibleUsers.filter((user) => user.id !== selected?.id),
    [eligibleUsers, selected?.id]
  );

  const total = useMemo(() => {
    const base = Number(baseSplit) || 0;
    return base + splits.reduce((sum, split) => sum + (Number(split.splitPercent) || 0), 0);
  }, [baseSplit, splits]);

  const chooseUser = (id: string) => {
    const user = users.find((item) => item.id === id) ?? null;
    setSelectedId(id);
    setBaseSplit(user?.plan?.baseSplitPercent.toString() ?? '100');
    setNotes(user?.plan?.notes ?? '');
    setSplits(
      user?.plan?.splits.map((split) => ({
        recipientUserId: split.recipientUserId,
        roleLabel: split.roleLabel,
        splitPercent: split.splitPercent.toString(),
      })) ?? []
    );
  };

  const save = () => {
    if (!selected) return;
    startTransition(async () => {
      await savePayrollCompPlan({
        loanOfficerId: selected.id,
        baseSplitPercent: Number(baseSplit),
        notes,
        splits: splits
          .filter((split) => split.recipientUserId && split.roleLabel.trim())
          .map((split) => ({
            recipientUserId: split.recipientUserId,
            roleLabel: split.roleLabel,
            splitPercent: Number(split.splitPercent),
          })),
      });
    });
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold text-slate-900">Loan Officers</h2>
          <p className="text-sm text-slate-500">Select a user to configure payroll splits.</p>
        </div>
        <div className="max-h-[620px] overflow-y-auto p-2">
          {users.map((user) => (
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
              <div className="grid gap-4 md:grid-cols-[220px_1fr]">
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">LO Base Split</span>
                  <div className="mt-1 flex items-center rounded-lg border border-slate-200 bg-white px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                    <input
                      value={baseSplit}
                      onChange={(event) => setBaseSplit(event.target.value)}
                      className="w-full border-0 py-2 text-sm outline-none"
                      inputMode="decimal"
                    />
                    <span className="text-sm text-slate-500">%</span>
                  </div>
                </label>
                <label className="block">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Notes</span>
                  <input
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                    placeholder="Optional payroll notes"
                  />
                </label>
              </div>

              <div className="rounded-xl border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <div>
                    <p className="font-bold text-slate-900">Additional Split Recipients</p>
                    <p className="text-xs text-slate-500">Managers, VPs, LOAs, processors, or any user sharing compensation.</p>
                  </div>
                  <button
                    type="button"
                    className="app-btn-secondary"
                    onClick={() => setSplits([...splits, { recipientUserId: '', roleLabel: 'Manager', splitPercent: '0' }])}
                  >
                    <Plus className="h-4 w-4" /> Add Split
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {splits.length === 0 ? (
                    <p className="px-4 py-8 text-center text-sm text-slate-500">No additional split recipients. The LO receives 100% by default.</p>
                  ) : (
                    splits.map((split, index) => (
                      <div key={index} className="grid gap-3 px-4 py-4 md:grid-cols-[1.4fr_1fr_140px_auto]">
                        <select
                          value={split.recipientUserId}
                          onChange={(event) => {
                            const next = [...splits];
                            next[index] = { ...split, recipientUserId: event.target.value };
                            setSplits(next);
                          }}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                        >
                          <option value="">Choose recipient</option>
                          {recipientOptions.map((user) => (
                            <option key={user.id} value={user.id}>{user.name} ({user.email})</option>
                          ))}
                        </select>
                        <input
                          value={split.roleLabel}
                          onChange={(event) => {
                            const next = [...splits];
                            next[index] = { ...split, roleLabel: event.target.value };
                            setSplits(next);
                          }}
                          className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                          placeholder="Manager, VP, LOA"
                        />
                        <div className="flex items-center rounded-lg border border-slate-200 px-3 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500/20">
                          <input
                            value={split.splitPercent}
                            onChange={(event) => {
                              const next = [...splits];
                              next[index] = { ...split, splitPercent: event.target.value };
                              setSplits(next);
                            }}
                            className="w-full border-0 py-2 text-sm outline-none"
                            inputMode="decimal"
                          />
                          <span className="text-sm text-slate-500">%</span>
                        </div>
                        <button
                          type="button"
                          className="app-icon-btn text-rose-600 hover:bg-rose-50"
                          aria-label="Remove split"
                          onClick={() => setSplits(splits.filter((_, splitIndex) => splitIndex !== index))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${Math.abs(total - 100) < 0.0001 ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}`}>
                Current total: {formatPercent(total)}. Splits must total 100% before saving.
              </div>
            </div>
          </>
        ) : (
          <div className="px-6 py-16 text-center text-sm text-slate-500">No loan officers available for payroll setup.</div>
        )}
      </div>
    </div>
  );
}
