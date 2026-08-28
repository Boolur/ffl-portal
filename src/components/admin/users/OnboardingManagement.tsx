'use client';

import { FormEvent, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Loader2,
  Plus,
  Search,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { OnboardingItemStatus, OnboardingStatus, UserRole } from '@prisma/client';
import { createOnboardingCase } from '@/app/actions/onboardingActions';
import { getRoleDisplayLabel } from '@/lib/roleLabels';

type CaseListItem = {
  id: string;
  candidateName: string;
  personalEmail: string;
  status: OnboardingStatus;
  targetRoles: UserRole[];
  ownerId: string | null;
  createdAt: string;
  updatedAt: string;
  startDate: string | null;
  jobTitle: string | null;
  department: string | null;
  items: Array<{ status: OnboardingItemStatus; required: boolean }>;
};

const statusLabel = (status: OnboardingStatus) =>
  status.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

const statusClass: Record<OnboardingStatus, string> = {
  INVITED: 'border-slate-200 bg-slate-50 text-slate-700',
  IN_PROGRESS: 'border-blue-200 bg-blue-50 text-blue-700',
  SUBMITTED: 'border-amber-200 bg-amber-50 text-amber-700',
  UNDER_REVIEW: 'border-violet-200 bg-violet-50 text-violet-700',
  CHANGES_REQUESTED: 'border-orange-200 bg-orange-50 text-orange-700',
  APPROVED: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  COMPLETED: 'border-green-200 bg-green-50 text-green-700',
  CANCELLED: 'border-red-200 bg-red-50 text-red-700',
};

export function OnboardingManagement({
  cases,
  assignableRoles,
  managers,
}: {
  cases: CaseListItem[];
  assignableRoles: UserRole[];
  managers: Array<{ id: string; name: string; email: string }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<'ALL' | OnboardingStatus>('ALL');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    candidateName: '',
    personalEmail: '',
    targetRoles: [] as UserRole[],
    ownerId: '',
    startDate: '',
    jobTitle: '',
    department: '',
  });
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return cases.filter((item) => {
      const matchesSearch =
        !query ||
        item.candidateName.toLowerCase().includes(query) ||
        item.personalEmail.toLowerCase().includes(query) ||
        (item.jobTitle || '').toLowerCase().includes(query);
      return matchesSearch && (status === 'ALL' || item.status === status);
    });
  }, [cases, search, status]);
  const closedStatuses = new Set<OnboardingStatus>([
    OnboardingStatus.COMPLETED,
    OnboardingStatus.CANCELLED,
  ]);
  const reviewStatuses = new Set<OnboardingStatus>([
    OnboardingStatus.SUBMITTED,
    OnboardingStatus.UNDER_REVIEW,
  ]);
  const activeCount = cases.filter((item) => !closedStatuses.has(item.status)).length;
  const reviewCount = cases.filter((item) => reviewStatuses.has(item.status)).length;

  const create = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    startTransition(async () => {
      const result = await createOnboardingCase({
        ...form,
        ownerId: form.ownerId || undefined,
      });
      if (!result.success) {
        setError(result.error || 'Unable to create onboarding.');
        return;
      }
      setOpen(false);
      setForm({ candidateName: '', personalEmail: '', targetRoles: [], ownerId: '', startDate: '', jobTitle: '', department: '' });
      router.push(`/admin/users/onboarding/${result.caseId}`);
      router.refresh();
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: 'Active onboarding', value: activeCount, icon: Users, tone: 'bg-blue-50 text-blue-700' },
          { label: 'Needs review', value: reviewCount, icon: Clock3, tone: 'bg-amber-50 text-amber-700' },
          { label: 'Completed', value: cases.filter((item) => item.status === OnboardingStatus.COMPLETED).length, icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-700' },
        ].map((metric) => (
          <div key={metric.label} className="app-surface-card flex items-center gap-4 p-5">
            <div className={`rounded-xl p-3 ${metric.tone}`}><metric.icon className="h-5 w-5" aria-hidden="true" /></div>
            <div><p className="text-2xl font-bold text-slate-900">{metric.value}</p><p className="text-sm text-slate-500">{metric.label}</p></div>
          </div>
        ))}
      </div>

      <section className="app-surface-card overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search new hires" className="app-input w-full pl-9" aria-label="Search onboarding cases" />
          </div>
          <select value={status} onChange={(event) => setStatus(event.target.value as 'ALL' | OnboardingStatus)} className="app-input sm:w-52" aria-label="Filter by status">
            <option value="ALL">All statuses</option>
            {Object.values(OnboardingStatus).map((value) => <option key={value} value={value}>{statusLabel(value)}</option>)}
          </select>
          {assignableRoles.length > 0 && (
            <button type="button" onClick={() => setOpen(true)} className="app-btn-primary">
              <Plus className="h-4 w-4" aria-hidden="true" /> Start onboarding
            </button>
          )}
        </div>
        <div className="divide-y divide-slate-100">
          {filtered.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <UserPlus className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
              <p className="mt-3 font-medium text-slate-700">No onboarding cases found</p>
              <p className="text-sm text-slate-500">Start a new hire onboarding or adjust your filters.</p>
            </div>
          ) : filtered.map((item) => {
            const required = item.items.filter((check) => check.required);
            const completedStatuses = new Set<OnboardingItemStatus>([
              OnboardingItemStatus.COMPLETED,
              OnboardingItemStatus.NOT_APPLICABLE,
            ]);
            const complete = required.filter((check) =>
              completedStatuses.has(check.status),
            ).length;
            const percent = required.length ? Math.round((complete / required.length) * 100) : 0;
            return (
              <Link key={item.id} href={`/admin/users/onboarding/${item.id}`} className="grid gap-4 p-5 transition hover:bg-slate-50 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_160px_24px] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{item.candidateName}</p>
                  <p className="truncate text-sm text-slate-500">{item.personalEmail}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {item.targetRoles.map((role) => <span key={role} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{getRoleDisplayLabel(role)}</span>)}
                  </div>
                </div>
                <div className="text-sm text-slate-600">
                  <p>{item.jobTitle || 'Role details pending'}</p>
                  {item.startDate && <p className="mt-1 flex items-center gap-1 text-xs text-slate-500"><CalendarDays className="h-3.5 w-3.5" aria-hidden="true" /> Starts {item.startDate}</p>}
                </div>
                <div>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass[item.status]}`}>{statusLabel(item.status)}</span>
                  <div className="mt-2 flex items-center gap-2 text-xs text-slate-500">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-blue-600" style={{ width: `${percent}%` }} /></div>
                    {percent}%
                  </div>
                </div>
                <ChevronRight className="hidden h-5 w-5 text-slate-300 sm:block" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      </section>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/45 p-4" role="presentation">
          <div role="dialog" aria-modal="true" aria-labelledby="new-onboarding-title" className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 p-5">
              <div><h2 id="new-onboarding-title" className="text-xl font-semibold text-slate-900">Start employee onboarding</h2><p className="text-sm text-slate-500">The new hire will receive a secure account invitation.</p></div>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={create} className="space-y-5 p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="text-sm font-medium text-slate-700">Full name<input className="app-input mt-1.5 w-full" value={form.candidateName} onChange={(event) => setForm({ ...form, candidateName: event.target.value })} required /></label>
                <label className="text-sm font-medium text-slate-700">Personal email<input type="email" className="app-input mt-1.5 w-full" value={form.personalEmail} onChange={(event) => setForm({ ...form, personalEmail: event.target.value })} required /></label>
                <label className="text-sm font-medium text-slate-700">Start date<input type="date" className="app-input mt-1.5 w-full" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label>
                <label className="text-sm font-medium text-slate-700">Job title<input className="app-input mt-1.5 w-full" value={form.jobTitle} onChange={(event) => setForm({ ...form, jobTitle: event.target.value })} /></label>
                <label className="text-sm font-medium text-slate-700">Department<input className="app-input mt-1.5 w-full" value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} /></label>
                <label className="text-sm font-medium text-slate-700">Onboarding owner<select className="app-input mt-1.5 w-full" value={form.ownerId} onChange={(event) => setForm({ ...form, ownerId: event.target.value })}><option value="">Unassigned</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>
              </div>
              <fieldset>
                <legend className="text-sm font-medium text-slate-700">Portal role after approval</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {assignableRoles.map((role) => (
                    <label key={role} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm">
                      <input type="checkbox" checked={form.targetRoles.includes(role)} onChange={(event) => setForm({ ...form, targetRoles: event.target.checked ? [...form.targetRoles, role] : form.targetRoles.filter((value) => value !== role) })} />
                      {getRoleDisplayLabel(role)}
                    </label>
                  ))}
                </div>
              </fieldset>
              {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
              <div className="flex justify-end gap-3 border-t border-slate-100 pt-4">
                <button type="button" onClick={() => setOpen(false)} className="app-btn-secondary">Cancel</button>
                <button type="submit" disabled={pending} className="app-btn-primary">{pending && <Loader2 className="h-4 w-4 animate-spin" />} Send onboarding invite</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
