'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  createLender,
  createLenderLogoUploadUrl,
  deleteLender,
  finalizeLenderLogoUpload,
  removeLenderLogo,
  updateLender,
  type LenderRecord,
} from '@/app/actions/lenderActions';
import { useRouter } from 'next/navigation';
import { Building2, ExternalLink, Loader2, PlusCircle, Search, Trash2, Upload } from 'lucide-react';
import type { LenderLinkType } from '@prisma/client';

type LenderManagementProps = {
  lenders: LenderRecord[];
};

type EditableContact = {
  id?: string;
  name: string;
  title: string;
  email: string;
  phone: string;
  notes: string;
  sortOrder: number;
};

type EditableLink = {
  id?: string;
  label: string;
  url: string;
  linkType: LenderLinkType;
  sortOrder: number;
};

type EditableLender = {
  id: string | null;
  name: string;
  description: string;
  portalUrl: string;
  active: boolean;
  sortOrder: number;
  logoUrl: string | null;
  contacts: EditableContact[];
  links: EditableLink[];
};

const LINK_TYPE_OPTIONS: LenderLinkType[] = ['PORTAL', 'RATES', 'GUIDE', 'SUPPORT', 'OTHER'];

function toEditableLender(lender: LenderRecord): EditableLender {
  return {
    id: lender.id,
    name: lender.name,
    description: lender.description || '',
    portalUrl: lender.portalUrl || '',
    active: lender.active,
    sortOrder: lender.sortOrder,
    logoUrl: lender.logoUrl || null,
    contacts: lender.contacts.map((contact, index) => ({
      id: contact.id,
      name: contact.name,
      title: contact.title || '',
      email: contact.email || '',
      phone: contact.phone || '',
      notes: contact.notes || '',
      sortOrder: Number.isFinite(contact.sortOrder) ? contact.sortOrder : index,
    })),
    links: lender.links.map((link, index) => ({
      id: link.id,
      label: link.label,
      url: link.url,
      linkType: link.linkType,
      sortOrder: Number.isFinite(link.sortOrder) ? link.sortOrder : index,
    })),
  };
}

function emptyEditableLender(): EditableLender {
  return {
    id: null,
    name: '',
    description: '',
    portalUrl: '',
    active: true,
    sortOrder: 0,
    logoUrl: null,
    contacts: [],
    links: [],
  };
}

function sortContacts(contacts: EditableContact[]) {
  return [...contacts].sort((a, b) => a.sortOrder - b.sortOrder);
}

function sortLinks(links: EditableLink[]) {
  return [...links].sort((a, b) => a.sortOrder - b.sortOrder);
}

export function LenderManagement({ lenders }: LenderManagementProps) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selectedLenderId, setSelectedLenderId] = useState<string | null>(lenders[0]?.id || null);
  const [draft, setDraft] = useState<EditableLender>(
    lenders[0] ? toEditableLender(lenders[0]) : emptyEditableLender()
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [isUploadingLogo, setIsUploadingLogo] = useState(false);
  const logoFileInputRef = useRef<HTMLInputElement | null>(null);

  const filteredLenders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return lenders;
    return lenders.filter((lender) => {
      const haystack = [
        lender.name,
        lender.description || '',
        lender.portalUrl || '',
        ...lender.contacts.map((contact) => `${contact.name} ${contact.email || ''} ${contact.phone || ''}`),
        ...lender.links.map((link) => `${link.label} ${link.url}`),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [lenders, search]);

  const handleSelectExisting = (lenderId: string) => {
    const lender = lenders.find((entry) => entry.id === lenderId);
    if (!lender) return;
    setSelectedLenderId(lenderId);
    setDraft(toEditableLender(lender));
    setStatus(null);
  };

  const handleStartNew = () => {
    setSelectedLenderId(null);
    setDraft(emptyEditableLender());
    setStatus(null);
  };

  const updateDraft = <K extends keyof EditableLender>(key: K, value: EditableLender[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    if (isSaving) return;
    setStatus(null);
    setIsSaving(true);
    try {
      const payload = {
        name: draft.name,
        description: draft.description,
        portalUrl: draft.portalUrl,
        active: draft.active,
        sortOrder: draft.sortOrder,
        contacts: sortContacts(draft.contacts),
        links: sortLinks(draft.links),
      };

      const result = draft.id
        ? await updateLender({ lenderId: draft.id, ...payload })
        : await createLender(payload);

      if (!result.success) {
        setStatus({ type: 'error', message: result.error || 'Failed to save lender.' });
        return;
      }
      if (result.lender) {
        setDraft(toEditableLender(result.lender));
        setSelectedLenderId(result.lender.id);
      }
      setStatus({
        type: 'success',
        message: draft.id ? 'Lender updated successfully.' : 'Lender created successfully.',
      });
      router.refresh();
    } catch (error) {
      console.error('Failed to save lender:', error);
      setStatus({ type: 'error', message: 'Failed to save lender.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!draft.id || isDeleting) return;
    const confirmed = window.confirm(
      `Delete lender "${draft.name}"? This cannot be undone.`
    );
    if (!confirmed) return;
    setStatus(null);
    setIsDeleting(true);
    try {
      const result = await deleteLender(draft.id);
      if (!result.success) {
        setStatus({ type: 'error', message: result.error || 'Failed to delete lender.' });
        return;
      }
      setStatus({ type: 'success', message: 'Lender deleted.' });
      setSelectedLenderId(null);
      setDraft(emptyEditableLender());
      router.refresh();
    } catch (error) {
      console.error('Failed to delete lender:', error);
      setStatus({ type: 'error', message: 'Failed to delete lender.' });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleUploadLogo = async (file: File | null) => {
    if (!file || !draft.id || isUploadingLogo) return;
    setStatus(null);
    setIsUploadingLogo(true);
    try {
      const uploadInit = await createLenderLogoUploadUrl({
        lenderId: draft.id,
        filename: file.name,
      });
      if (!uploadInit.success || !uploadInit.signedUrl || !uploadInit.path) {
        setStatus({ type: 'error', message: uploadInit.error || 'Failed to initialize logo upload.' });
        return;
      }

      const put = await fetch(uploadInit.signedUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      });
      if (!put.ok) {
        setStatus({ type: 'error', message: 'Logo upload failed.' });
        return;
      }

      const saved = await finalizeLenderLogoUpload({
        lenderId: draft.id,
        storagePath: uploadInit.path,
        filename: file.name,
      });
      if (!saved.success) {
        setStatus({ type: 'error', message: saved.error || 'Failed to save logo.' });
        return;
      }

      setStatus({ type: 'success', message: 'Logo uploaded.' });
      setDraft((prev) => ({ ...prev, logoUrl: saved.logoUrl || prev.logoUrl }));
      router.refresh();
    } catch (error) {
      console.error('Failed to upload lender logo:', error);
      setStatus({ type: 'error', message: 'Failed to upload logo.' });
    } finally {
      setIsUploadingLogo(false);
      if (logoFileInputRef.current) {
        logoFileInputRef.current.value = '';
      }
    }
  };

  const handleRemoveLogo = async () => {
    if (!draft.id || isUploadingLogo) return;
    const confirmed = window.confirm('Remove this lender logo?');
    if (!confirmed) return;
    setStatus(null);
    setIsUploadingLogo(true);
    try {
      const result = await removeLenderLogo(draft.id);
      if (!result.success) {
        setStatus({ type: 'error', message: result.error || 'Failed to remove logo.' });
        return;
      }
      setDraft((prev) => ({ ...prev, logoUrl: null }));
      setStatus({ type: 'success', message: 'Logo removed.' });
      router.refresh();
    } finally {
      setIsUploadingLogo(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-900">Lenders</h2>
          <button type="button" onClick={handleStartNew} className="app-btn-primary h-8 px-2.5 text-xs">
            <PlusCircle className="h-4 w-4" />
            New
          </button>
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search lenders"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-xs font-medium text-slate-700"
          />
        </label>
        <div className="mt-3 max-h-[70vh] space-y-2 overflow-y-auto pr-1">
          {filteredLenders.map((lender) => {
            const selected = lender.id === selectedLenderId;
            return (
              <button
                key={lender.id}
                type="button"
                onClick={() => handleSelectExisting(lender.id)}
                className={`w-full rounded-xl border p-3 text-left transition-all ${
                  selected
                    ? 'border-blue-300 bg-blue-50/60 shadow-sm ring-1 ring-blue-100'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-900">{lender.name}</p>
                  <span
                    className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                      lender.active
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-slate-50 text-slate-500'
                    }`}
                  >
                    {lender.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">
                  {lender.description || 'No description yet.'}
                </p>
              </button>
            );
          })}
          {filteredLenders.length === 0 && (
            <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              No lenders match your search.
            </p>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {draft.id ? 'Edit Lender' : 'Create Lender'}
            </h2>
            <p className="text-sm text-slate-500">
              Maintain lender profile details, contacts, links, and branding.
            </p>
          </div>
          {draft.id && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeleting}
              className="app-btn-danger h-9 px-3 text-xs disabled:opacity-60"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete
            </button>
          )}
        </div>

        {status && (
          <p
            className={`mb-3 rounded-lg border px-3 py-2 text-sm ${
              status.type === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-rose-200 bg-rose-50 text-rose-700'
            }`}
          >
            {status.message}
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Lender Name</span>
            <input
              value={draft.name}
              onChange={(event) => updateDraft('name', event.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Portal URL</span>
            <input
              value={draft.portalUrl}
              onChange={(event) => updateDraft('portalUrl', event.target.value)}
              placeholder="https://..."
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="md:col-span-2 flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</span>
            <textarea
              value={draft.description}
              onChange={(event) => updateDraft('description', event.target.value)}
              rows={3}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sort Order</span>
            <input
              type="number"
              value={draft.sortOrder}
              onChange={(event) => updateDraft('sortOrder', Number(event.target.value) || 0)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </label>
          <label className="inline-flex items-center gap-2 pt-6 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) => updateDraft('active', event.target.checked)}
            />
            Active lender
          </label>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Logo</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
              {draft.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draft.logoUrl} alt={`${draft.name || 'Lender'} logo`} className="h-full w-full object-contain p-1" />
              ) : (
                <Building2 className="h-8 w-8 text-slate-300" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={isUploadingLogo}
                onClick={() => {
                  if (!draft.id) {
                    setStatus({
                      type: 'error',
                      message: 'Save the lender first, then upload a logo.',
                    });
                    return;
                  }
                  logoFileInputRef.current?.click();
                }}
                className="app-btn-secondary h-8 px-2.5 text-xs disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isUploadingLogo ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                Upload Logo
              </button>
              <button
                type="button"
                disabled={!draft.id || !draft.logoUrl || isUploadingLogo}
                onClick={handleRemoveLogo}
                className="app-btn-danger h-8 px-2.5 text-xs disabled:opacity-60"
              >
                Remove
              </button>
            </div>
            <input
              ref={logoFileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0] || null;
                if (!draft.id) {
                  setStatus({
                    type: 'error',
                    message: 'Save the lender first, then upload a logo.',
                  });
                  return;
                }
                void handleUploadLogo(file);
              }}
            />
          </div>
          {!draft.id && (
            <p className="mt-2 text-[11px] text-slate-500">
              Save this lender to create it before uploading a logo.
            </p>
          )}
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contacts</p>
            <button
              type="button"
              onClick={() =>
                updateDraft('contacts', [
                  ...draft.contacts,
                  {
                    name: '',
                    title: '',
                    email: '',
                    phone: '',
                    notes: '',
                    sortOrder: draft.contacts.length,
                  },
                ])
              }
              className="app-btn-secondary h-7 px-2 text-[11px]"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Add Contact
            </button>
          </div>
          <div className="space-y-2">
            {draft.contacts.map((contact, index) => (
              <div key={`contact-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    value={contact.name}
                    onChange={(event) =>
                      updateDraft(
                        'contacts',
                        draft.contacts.map((entry, idx) =>
                          idx === index ? { ...entry, name: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="Name"
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={contact.title}
                    onChange={(event) =>
                      updateDraft(
                        'contacts',
                        draft.contacts.map((entry, idx) =>
                          idx === index ? { ...entry, title: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="Title"
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={contact.email}
                    onChange={(event) =>
                      updateDraft(
                        'contacts',
                        draft.contacts.map((entry, idx) =>
                          idx === index ? { ...entry, email: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="Email"
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={contact.phone}
                    onChange={(event) =>
                      updateDraft(
                        'contacts',
                        draft.contacts.map((entry, idx) =>
                          idx === index ? { ...entry, phone: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="Phone"
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                  <textarea
                    value={contact.notes}
                    onChange={(event) =>
                      updateDraft(
                        'contacts',
                        draft.contacts.map((entry, idx) =>
                          idx === index ? { ...entry, notes: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="Notes"
                    rows={2}
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs md:col-span-2"
                  />
                </div>
                <button
                  type="button"
                  onClick={() =>
                    updateDraft(
                      'contacts',
                      draft.contacts.filter((_, idx) => idx !== index).map((entry, idx) => ({
                        ...entry,
                        sortOrder: idx,
                      }))
                    )
                  }
                  className="mt-2 text-xs font-semibold text-rose-700 hover:text-rose-800"
                >
                  Remove Contact
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Links</p>
            <button
              type="button"
              onClick={() =>
                updateDraft('links', [
                  ...draft.links,
                  { label: '', url: '', linkType: 'PORTAL', sortOrder: draft.links.length },
                ])
              }
              className="app-btn-secondary h-7 px-2 text-[11px]"
            >
              <PlusCircle className="h-3.5 w-3.5" />
              Add Link
            </button>
          </div>
          <div className="space-y-2">
            {draft.links.map((link, index) => (
              <div key={`link-${index}`} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1.5fr_180px]">
                  <input
                    value={link.label}
                    onChange={(event) =>
                      updateDraft(
                        'links',
                        draft.links.map((entry, idx) =>
                          idx === index ? { ...entry, label: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="Label"
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                  <input
                    value={link.url}
                    onChange={(event) =>
                      updateDraft(
                        'links',
                        draft.links.map((entry, idx) =>
                          idx === index ? { ...entry, url: event.target.value } : entry
                        )
                      )
                    }
                    placeholder="https://..."
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                  />
                  <select
                    value={link.linkType}
                    onChange={(event) =>
                      updateDraft(
                        'links',
                        draft.links.map((entry, idx) =>
                          idx === index
                            ? { ...entry, linkType: event.target.value as LenderLinkType }
                            : entry
                        )
                      )
                    }
                    className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs"
                  >
                    {LINK_TYPE_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <a
                    href={link.url || '#'}
                    target="_blank"
                    rel="noreferrer"
                    className={`inline-flex items-center gap-1 text-xs font-semibold ${
                      link.url ? 'text-blue-700 hover:text-blue-800' : 'pointer-events-none text-slate-400'
                    }`}
                  >
                    Open
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      updateDraft(
                        'links',
                        draft.links.filter((_, idx) => idx !== index).map((entry, idx) => ({
                          ...entry,
                          sortOrder: idx,
                        }))
                      )
                    }
                    className="text-xs font-semibold text-rose-700 hover:text-rose-800"
                  >
                    Remove Link
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="app-btn-primary h-10 px-4 text-sm disabled:opacity-60"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {draft.id ? 'Save Changes' : 'Create Lender'}
          </button>
          <button type="button" onClick={() => router.refresh()} className="app-btn-secondary h-10 px-4 text-sm">
            Refresh
          </button>
        </div>
      </section>
    </div>
  );
}
