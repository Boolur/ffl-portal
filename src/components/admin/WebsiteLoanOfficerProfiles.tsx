'use client';

import { useMemo, useState, useTransition, type ReactNode } from 'react';
import { CheckCircle2, ExternalLink, Loader2, Save, Search, Send, UserRound } from 'lucide-react';
import {
  setWebsiteLoanOfficerProfilePublished,
  updateWebsiteLoanOfficerProfile,
  type WebsiteLoanOfficerProfileInput,
} from '@/app/actions/websiteLoanOfficerProfileActions';

type ProfileRow = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  websiteLoanOfficerProfile: (WebsiteLoanOfficerProfileInput & {
    publishedAt: string | null;
  }) | null;
};

type Draft = WebsiteLoanOfficerProfileInput;

const emptyDraft = (row: ProfileRow): Draft => ({
  slug: row.websiteLoanOfficerProfile?.slug ?? '',
  title: row.websiteLoanOfficerProfile?.title ?? 'Mortgage Loan Originator',
  nmls: row.websiteLoanOfficerProfile?.nmls ?? '',
  photoUrl: row.websiteLoanOfficerProfile?.photoUrl ?? '',
  phone: row.websiteLoanOfficerProfile?.phone ?? '',
  bookingUrl: row.websiteLoanOfficerProfile?.bookingUrl ?? '',
  licensedStates: row.websiteLoanOfficerProfile?.licensedStates ?? [],
  specialties: row.websiteLoanOfficerProfile?.specialties ?? [],
  languages: row.websiteLoanOfficerProfile?.languages ?? ['English'],
  bio: row.websiteLoanOfficerProfile?.bio ?? '',
  yearsExperience: row.websiteLoanOfficerProfile?.yearsExperience ?? null,
  loansClosed: row.websiteLoanOfficerProfile?.loansClosed ?? '',
  city: row.websiteLoanOfficerProfile?.city ?? '',
  featured: row.websiteLoanOfficerProfile?.featured ?? false,
});

const listText = (values: string[]) => values.join(', ');
const parseList = (value: string) =>
  Array.from(new Set(value.split(',').map((item) => item.trim()).filter(Boolean)));

export function WebsiteLoanOfficerProfiles({ profiles }: { profiles: ProfileRow[] }) {
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? '');
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(profiles.map((profile) => [profile.id, emptyDraft(profile)])),
  );
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return profiles;
    return profiles.filter(
      (profile) =>
        profile.name.toLowerCase().includes(query) ||
        profile.email.toLowerCase().includes(query) ||
        (profile.websiteLoanOfficerProfile?.slug ?? '').toLowerCase().includes(query),
    );
  }, [profiles, search]);

  const selected = profiles.find((profile) => profile.id === selectedId) ?? filtered[0];
  const draft = selected ? drafts[selected.id] : null;

  const updateDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    if (!selected) return;
    setDrafts((current) => ({
      ...current,
      [selected.id]: { ...current[selected.id], [key]: value },
    }));
  };

  const save = () => {
    if (!selected || !draft) return;
    setStatus(null);
    startTransition(async () => {
      const result = await updateWebsiteLoanOfficerProfile(selected.id, draft);
      setStatus({
        type: result.success ? 'success' : 'error',
        message: result.success ? 'Draft profile saved.' : result.error,
      });
    });
  };

  const setPublished = (published: boolean) => {
    if (!selected) return;
    setStatus(null);
    startTransition(async () => {
      const result = await setWebsiteLoanOfficerProfilePublished(selected.id, published);
      setStatus({
        type: result.success ? 'success' : 'error',
        message: result.success
          ? published
            ? 'Profile published.'
            : 'Profile returned to draft.'
          : result.error,
      });
      if (result.success) window.location.reload();
    });
  };

  if (profiles.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <UserRound className="mx-auto h-8 w-8 text-slate-400" />
        <h2 className="mt-3 text-lg font-semibold text-slate-900">No loan officers found</h2>
        <p className="mt-1 text-sm text-slate-500">
          Assign the Loan Officer role to a portal user to create a website profile draft.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="h-fit rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <label className="relative block">
          <span className="sr-only">Search loan officers</span>
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search loan officers"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </label>
        <div className="mt-3 space-y-2">
          {filtered.map((profile) => {
            const published = Boolean(profile.websiteLoanOfficerProfile?.publishedAt);
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => {
                  setSelectedId(profile.id);
                  setStatus(null);
                }}
                className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  selected?.id === profile.id
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-slate-200 bg-white hover:bg-slate-50'
                }`}
              >
                <span className="block text-sm font-semibold text-slate-900">{profile.name}</span>
                <span className="mt-0.5 block truncate text-xs text-slate-500">{profile.email}</span>
                <span
                  className={`mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                    published && profile.active
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-amber-200 bg-amber-50 text-amber-700'
                  }`}
                >
                  {published && profile.active ? 'Published' : 'Draft'}
                </span>
              </button>
            );
          })}
        </div>
      </aside>

      {selected && draft && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">{selected.name}</h2>
              <p className="mt-1 text-sm text-slate-500">{selected.email}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.websiteLoanOfficerProfile?.publishedAt ? (
                <>
                  <a
                    href={`${process.env.NEXT_PUBLIC_BISU_WEBSITE_URL || 'https://bisuhomeloans.com'}/officer/${draft.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="app-btn-secondary"
                  >
                    <ExternalLink className="h-4 w-4" />
                    View page
                  </a>
                  <button
                    type="button"
                    onClick={() => setPublished(false)}
                    disabled={isPending}
                    className="app-btn-secondary disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Return to draft
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setPublished(true)}
                  disabled={isPending}
                  className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Send className="h-4 w-4" />
                  Publish
                </button>
              )}
            </div>
          </div>

          {!selected.active && (
            <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              This portal account is inactive, so the profile cannot appear on the website.
            </p>
          )}

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Field label="Website slug" required>
              <input
                value={draft.slug}
                onChange={(event) => updateDraft('slug', event.target.value)}
                className="app-input"
              />
            </Field>
            <Field label="Title" required>
              <input
                value={draft.title}
                onChange={(event) => updateDraft('title', event.target.value)}
                className="app-input"
              />
            </Field>
            <Field label="NMLS" required>
              <input
                value={draft.nmls ?? ''}
                onChange={(event) => updateDraft('nmls', event.target.value)}
                className="app-input"
              />
            </Field>
            <Field label="Phone" required>
              <input
                value={draft.phone ?? ''}
                onChange={(event) => updateDraft('phone', event.target.value)}
                className="app-input"
              />
            </Field>
            <Field label="Photo URL">
              <input
                type="url"
                value={draft.photoUrl ?? ''}
                onChange={(event) => updateDraft('photoUrl', event.target.value)}
                className="app-input"
              />
            </Field>
            <Field label="Booking URL">
              <input
                type="url"
                value={draft.bookingUrl ?? ''}
                onChange={(event) => updateDraft('bookingUrl', event.target.value)}
                className="app-input"
              />
            </Field>
            <Field label="Licensed states" hint="Comma separated" required>
              <input
                value={listText(draft.licensedStates)}
                onChange={(event) => updateDraft('licensedStates', parseList(event.target.value))}
                className="app-input"
              />
            </Field>
            <Field label="Specialties" hint="Comma separated">
              <input
                value={listText(draft.specialties)}
                onChange={(event) => updateDraft('specialties', parseList(event.target.value))}
                className="app-input"
              />
            </Field>
            <Field label="Languages" hint="Comma separated">
              <input
                value={listText(draft.languages)}
                onChange={(event) => updateDraft('languages', parseList(event.target.value))}
                className="app-input"
              />
            </Field>
            <Field label="City or market">
              <input
                value={draft.city ?? ''}
                onChange={(event) => updateDraft('city', event.target.value)}
                className="app-input"
              />
            </Field>
            <Field label="Years of experience">
              <input
                type="number"
                min={0}
                value={draft.yearsExperience ?? ''}
                onChange={(event) =>
                  updateDraft(
                    'yearsExperience',
                    event.target.value === '' ? null : Number(event.target.value),
                  )
                }
                className="app-input"
              />
            </Field>
            <Field label="Loans closed">
              <input
                value={draft.loansClosed ?? ''}
                onChange={(event) => updateDraft('loansClosed', event.target.value)}
                className="app-input"
              />
            </Field>
            <div className="md:col-span-2">
              <Field label="Biography" required>
                <textarea
                  rows={6}
                  value={draft.bio}
                  onChange={(event) => updateDraft('bio', event.target.value)}
                  className="app-input min-h-32 resize-y"
                />
              </Field>
            </div>
            <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
              <input
                type="checkbox"
                checked={draft.featured}
                onChange={(event) => updateDraft('featured', event.target.checked)}
              />
              Feature this officer on the website
            </label>
          </div>

          {status && (
            <p
              role="status"
              className={`mt-5 rounded-lg border px-3 py-2 text-sm ${
                status.type === 'success'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {status.type === 'success' && (
                <CheckCircle2 className="mr-2 inline h-4 w-4" aria-hidden="true" />
              )}
              {status.message}
            </p>
          )}

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={isPending}
              className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save draft
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  required = false,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
        <span>
          {label}
          {required && <span className="ml-1 text-red-600">*</span>}
        </span>
        {hint && <span className="text-xs font-normal text-slate-400">{hint}</span>}
      </span>
      {children}
    </label>
  );
}
