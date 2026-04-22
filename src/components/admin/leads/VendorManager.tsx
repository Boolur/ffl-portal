'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Loader2, Plus, Pencil, Trash2, Copy, Check, X, Globe, HelpCircle, ArrowUp, ArrowDown, Search, Mailbox, Archive, ArchiveRestore, AlertTriangle } from 'lucide-react';
import {
  createLeadVendor,
  updateLeadVendor,
  archiveLeadVendor,
  restoreLeadVendor,
  hardDeleteLeadVendor,
  reassignVendorCampaigns,
  deleteAllVendorCampaigns,
  deleteAllVendorLeads,
  getVendorDependencyCounts,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';
import { FormatDate } from '@/components/ui/FormatDate';
import { buildLeadMailboxJsonTemplate } from '@/lib/leadMailboxBridge';

type Vendor = {
  id: string;
  name: string;
  slug: string;
  webhookSecret: string | null;
  fieldMapping: Record<string, string>;
  routingTagField: string;
  active: boolean;
  _count: { leads: number; campaigns: number };
  createdAt: Date | string;
  updatedAt: Date | string;
};

const NORMALIZED_FIELDS = [
  'firstName','lastName','email','phone','homePhone','workPhone','dob','ssn',
  'coFirstName','coLastName','coEmail','coPhone','coHomePhone','coWorkPhone','coDob',
  'propertyAddress','propertyCity','propertyState','propertyZip','propertyCounty',
  'purchasePrice','propertyValue','propertyType','propertyUse','propertyAcquired','propertyLtv',
  'employer','jobTitle','employmentLength','selfEmployed','income','bankruptcy','foreclosure','homeowner',
  'coEmployer','coJobTitle','coEmploymentLength','coSelfEmployed','coIncome',
  'loanPurpose','loanAmount','loanTerm','loanType','loanRate',
  'downPayment','cashOut','creditRating',
  'currentLender','currentBalance','currentRate','currentPayment','currentTerm','currentType',
  'otherBalance','otherPayment','targetRate',
  'vaStatus','vaLoan','isMilitary','fhaLoan','sourceUrl','leadCreated','price',
];

function InfoTip({ text }: { text: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);
  const iconRef = useRef<HTMLSpanElement>(null);
  const tipWidth = 224;

  const open = () => {
    clearTimeout(timeout.current);
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - tipWidth / 2;
      if (left < 8) left = 8;
      if (left + tipWidth > window.innerWidth - 8) left = window.innerWidth - tipWidth - 8;
      setPos({ top: rect.top - 8, left });
    }
  };
  const close = () => { timeout.current = setTimeout(() => setPos(null), 150); };

  return (
    <span ref={iconRef} className="inline-flex ml-1 align-middle" onMouseEnter={open} onMouseLeave={close}>
      <HelpCircle className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 cursor-help transition-colors" />
      {pos && (
        <span
          className="fixed z-[9999] w-56 rounded-lg border border-slate-200 bg-slate-800 px-3 py-2 text-[11px] leading-relaxed text-white shadow-lg"
          style={{ top: pos.top, left: pos.left, transform: 'translateY(-100%)' }}
          onMouseEnter={() => clearTimeout(timeout.current)}
          onMouseLeave={close}
        >
          {text}
        </span>
      )}
    </span>
  );
}

export function VendorManager({ vendors: initialVendors }: { vendors: Vendor[] }) {
  const router = useRouter();
  const [vendors] = useState(initialVendors);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [deletingVendor, setDeletingVendor] = useState<Vendor | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [sortCol, setSortCol] = useState<string>('created');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizingCol = useRef<string | null>(null);
  const resizeStartX = useRef(0);
  const resizeStartW = useRef(0);
  const tableRef = useRef<HTMLTableElement>(null);

  const toggleSort = useCallback((col: string) => {
    setSortCol((prev) => {
      if (prev === col) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
        return col;
      }
      setSortDir('asc');
      return col;
    });
  }, []);

  const onResizeStart = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    resizingCol.current = col;
    resizeStartX.current = e.clientX;
    const th = (e.target as HTMLElement).closest('th');
    resizeStartW.current = th?.offsetWidth ?? 120;
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizingCol.current) return;
      const diff = e.clientX - resizeStartX.current;
      const newW = Math.max(60, resizeStartW.current + diff);
      setColWidths((prev) => ({ ...prev, [resizingCol.current!]: newW }));
    };
    const onUp = () => { resizingCol.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const archivedCount = useMemo(
    () => vendors.filter((v) => !v.active).length,
    [vendors]
  );

  const filteredVendors = useMemo(() => {
    let list = vendors;
    if (!showArchived) {
      list = list.filter((v) => v.active);
    }
    if (vendorSearch) {
      const q = vendorSearch.toLowerCase();
      list = list.filter(
        (v) => v.name.toLowerCase().includes(q) || v.slug.toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case 'name': cmp = a.name.localeCompare(b.name); break;
        case 'slug': cmp = a.slug.localeCompare(b.slug); break;
        case 'status': cmp = (a.active === b.active ? 0 : a.active ? -1 : 1); break;
        case 'campaigns': cmp = a._count.campaigns - b._count.campaigns; break;
        case 'leads': cmp = a._count.leads - b._count.leads; break;
        case 'created': cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(); break;
        case 'modified': cmp = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime(); break;
        default: cmp = 0;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [vendors, vendorSearch, sortCol, sortDir, showArchived]);

  const [form, setForm] = useState({
    name: '',
    slug: '',
    webhookSecret: '',
    routingTagField: 'routing_tag',
    fieldMapping: {} as Record<string, string>,
  });

  const [newMappingVendorField, setNewMappingVendorField] = useState('');
  const [newMappingOurField, setNewMappingOurField] = useState('');

  const openCreate = useCallback(() => {
    setForm({ name: '', slug: '', webhookSecret: '', routingTagField: 'routing_tag', fieldMapping: {} });
    setIsCreating(true);
    setEditingVendor(null);
  }, []);

  const openEdit = useCallback((v: Vendor) => {
    setForm({
      name: v.name,
      slug: v.slug,
      webhookSecret: v.webhookSecret || '',
      routingTagField: v.routingTagField,
      fieldMapping: (v.fieldMapping as Record<string, string>) || {},
    });
    setEditingVendor(v);
    setIsCreating(false);
  }, []);

  const closeModal = useCallback(() => {
    setEditingVendor(null);
    setIsCreating(false);
    setNewMappingVendorField('');
    setNewMappingOurField('');
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setLoading(true);
    try {
      if (isCreating) {
        await createLeadVendor({
          name: form.name,
          slug: form.slug,
          webhookSecret: form.webhookSecret || undefined,
          routingTagField: form.routingTagField,
          fieldMapping: form.fieldMapping,
        });
      } else if (editingVendor) {
        await updateLeadVendor(editingVendor.id, {
          name: form.name,
          slug: form.slug,
          webhookSecret: form.webhookSecret || null,
          routingTagField: form.routingTagField,
          fieldMapping: form.fieldMapping,
        });
      }
      closeModal();
      router.refresh();
    } finally {
      setSaving(false);
      setLoading(false);
    }
  };

  const handleArchive = async (v: Vendor) => {
    if (
      !window.confirm(
        `Archive "${v.name}"? Webhooks stop accepting leads and it'll hide from the default list. Fully reversible — click Restore to bring it back. No data is lost.`
      )
    )
      return;
    setLoading(true);
    try {
      await archiveLeadVendor(v.id);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (v: Vendor) => {
    setLoading(true);
    try {
      await restoreLeadVendor(v.id);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const openDeleteDialog = (v: Vendor) => {
    setDeletingVendor(v);
  };

  const closeDeleteDialog = () => {
    setDeletingVendor(null);
  };

  const copyWebhookUrl = (slug: string) => {
    const url = `${window.location.origin}/api/webhooks/leads/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedId(slug);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const [bridgeCopied, setBridgeCopied] = useState<'url' | 'template' | null>(null);

  const copyBridgeUrl = (slug: string) => {
    const url = `${window.location.origin}/api/webhooks/lead-mailbox/${slug}`;
    navigator.clipboard.writeText(url);
    setBridgeCopied('url');
    setTimeout(() => setBridgeCopied(null), 2000);
  };

  const copyBridgeTemplate = () => {
    navigator.clipboard.writeText(buildLeadMailboxJsonTemplate());
    setBridgeCopied('template');
    setTimeout(() => setBridgeCopied(null), 2000);
  };

  const [mappingError, setMappingError] = useState('');

  const addMapping = () => {
    if (!newMappingVendorField.trim() && !newMappingOurField) {
      setMappingError('Enter a vendor field name and select one of our fields.');
      return;
    }
    if (!newMappingVendorField.trim()) {
      setMappingError('Enter a vendor field name on the left.');
      return;
    }
    if (!newMappingOurField) {
      setMappingError('Select one of our fields on the right.');
      return;
    }
    setMappingError('');
    setForm((prev) => ({
      ...prev,
      fieldMapping: { ...prev.fieldMapping, [newMappingVendorField.trim()]: newMappingOurField },
    }));
    setNewMappingVendorField('');
    setNewMappingOurField('');
  };

  const removeMapping = (vendorField: string) => {
    setForm((prev) => {
      const next = { ...prev.fieldMapping };
      delete next[vendorField];
      return { ...prev, fieldMapping: next };
    });
  };

  const showModal = isCreating || editingVendor !== null;

  return (
    <div className="space-y-6">
      {loading && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-white/70 backdrop-blur-[2px]">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
            <p className="text-sm font-medium text-slate-600">Saving changes...</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {filteredVendors.length} vendor{filteredVendors.length !== 1 ? 's' : ''}
          </span>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search vendors…"
              value={vendorSearch}
              onChange={(e) => setVendorSearch(e.target.value)}
              className="rounded-lg border border-slate-200 py-1.5 pl-8 pr-3 text-xs focus:border-blue-400 focus:ring-2 focus:ring-blue-100 outline-none w-56"
            />
          </div>
          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((p) => !p)}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                showArchived
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
              }`}
              title="Archived vendors are hidden from the default list but their data is preserved."
            >
              <Archive className="h-3.5 w-3.5" />
              {showArchived ? 'Hide' : 'Show'} archived ({archivedCount})
            </button>
          )}
        </div>
        <button className="app-btn-primary" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Vendor
        </button>
      </div>

      {filteredVendors.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <Globe className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No vendors configured</p>
          <p className="mt-1 text-sm text-slate-500">Add a lead vendor to start receiving leads via webhook.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table ref={tableRef} className="w-full text-sm" style={{ tableLayout: Object.keys(colWidths).length ? 'fixed' : undefined }}>
            <thead className="sticky top-0 z-[1] bg-slate-50">
              <tr className="border-b border-slate-200">
                {([
                  { key: 'name', label: 'Vendor', align: 'left' },
                  { key: 'slug', label: 'Slug', align: 'left' },
                  { key: 'status', label: 'Status', align: 'center' },
                  { key: 'campaigns', label: 'Campaigns', align: 'center' },
                  { key: 'leads', label: 'Leads', align: 'center' },
                  { key: 'created', label: 'Created', align: 'left' },
                  { key: 'modified', label: 'Modified', align: 'left' },
                ] as const).map((col) => (
                  <th
                    key={col.key}
                    className={`relative px-4 py-3 text-${col.align} text-[11px] font-bold uppercase tracking-wider text-slate-500 cursor-pointer select-none hover:text-slate-700 transition-colors group/th`}
                    style={colWidths[col.key] ? { width: colWidths[col.key] } : undefined}
                    onClick={() => toggleSort(col.key)}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.label}
                      {sortCol === col.key && (sortDir === 'asc' ? <ArrowUp className="h-3 w-3 text-blue-600" /> : <ArrowDown className="h-3 w-3 text-blue-600" />)}
                    </span>
                    <div
                      className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize flex items-center justify-center opacity-0 group-hover/th:opacity-100 hover:!opacity-100 transition-opacity z-[2]"
                      onMouseDown={(e) => onResizeStart(col.key, e)}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="h-4 w-[3px] rounded-sm border-x border-slate-300" />
                    </div>
                  </th>
                ))}
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Webhook</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {filteredVendors.map((v) => (
                <tr
                  key={v.id}
                  className={`align-middle hover:bg-slate-50/70 ${
                    v.active ? '' : 'bg-amber-50/30 text-slate-500'
                  }`}
                >
                  <td className="px-4 py-3 font-semibold text-slate-900">
                    <span className={v.active ? '' : 'opacity-70'}>{v.name}</span>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.slug}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        v.active
                          ? 'border border-blue-200 bg-blue-50 text-blue-700'
                          : 'border border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {v.active ? 'Active' : 'Archived'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-700">{v._count.campaigns}</td>
                  <td className="px-4 py-3 text-center text-slate-700">{v._count.leads}</td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    <FormatDate date={v.createdAt} mode="datetime" />
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    <FormatDate date={v.updatedAt} mode="datetime" />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => copyWebhookUrl(v.slug)}
                      className="app-icon-btn"
                      title="Copy webhook URL"
                    >
                      {copiedId === v.slug ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button className="app-icon-btn" onClick={() => openEdit(v)} title="Edit">
                        <Pencil className="h-4 w-4" />
                      </button>
                      {v.active ? (
                        <button
                          className="app-icon-btn text-amber-600 hover:bg-amber-50"
                          onClick={() => void handleArchive(v)}
                          title="Archive vendor"
                        >
                          <Archive className="h-4 w-4" />
                        </button>
                      ) : (
                        <>
                          <button
                            className="app-icon-btn text-emerald-600 hover:bg-emerald-50"
                            onClick={() => void handleRestore(v)}
                            title="Restore vendor"
                          >
                            <ArchiveRestore className="h-4 w-4" />
                          </button>
                          <button
                            className="app-icon-btn app-icon-btn-danger"
                            onClick={() => openDeleteDialog(v)}
                            title="Permanently delete…"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={closeModal}>
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-lg font-semibold text-slate-900">
                {isCreating ? 'Add Vendor' : 'Edit Vendor'}
              </h2>
              <button className="app-icon-btn" onClick={closeModal} aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Basic Info</p>
              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Name *<InfoTip text="A display name for this vendor, e.g. 'Leadpoint' or 'FreeRateUpdate - Matt'. This is how it appears throughout the portal." /></span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="LendingTree LongForm"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Slug *<InfoTip text="A unique URL-friendly identifier used in the webhook URL. Use lowercase letters, numbers, and dashes only. Example: 'leadpoint' or 'fru-matt'." /></span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={form.slug}
                    onChange={(e) => setForm((p) => ({ ...p, slug: e.target.value }))}
                    placeholder="lendingtree-lf"
                  />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Webhook Secret<InfoTip text="An optional password the vendor includes in their request header to prove they're authorized. If set, any request without this secret will be rejected. Use the Clear button to remove a saved secret — browsers sometimes re-fill this field from password managers, so Clear writes null directly." /></span>
                  <div className="flex items-stretch gap-2">
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      type="text"
                      name={`vendor-webhook-secret-${editingVendor?.id ?? 'new'}`}
                      autoComplete="off"
                      data-lpignore="true"
                      data-1p-ignore=""
                      data-form-type="other"
                      value={form.webhookSecret}
                      onChange={(e) => setForm((p) => ({ ...p, webhookSecret: e.target.value }))}
                      placeholder="Optional — for signature verification"
                    />
                    {!isCreating && editingVendor?.webhookSecret && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!editingVendor) return;
                          if (!window.confirm('Clear the webhook secret for this vendor? Requests will no longer require a secret header.')) return;
                          setSaving(true);
                          setLoading(true);
                          try {
                            await updateLeadVendor(editingVendor.id, { webhookSecret: null });
                            setForm((p) => ({ ...p, webhookSecret: '' }));
                            router.refresh();
                          } finally {
                            setSaving(false);
                            setLoading(false);
                          }
                        }}
                        className="shrink-0 rounded-lg border border-red-200 bg-white px-3 text-xs font-medium text-red-600 hover:border-red-300 hover:bg-red-50"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Routing Tag Field<InfoTip text="The field name in the vendor's payload that contains the campaign/routing identifier. This tells the system which campaign the lead belongs to. Default is 'routing_tag'." /></span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={form.routingTagField}
                    onChange={(e) => setForm((p) => ({ ...p, routingTagField: e.target.value }))}
                    placeholder="routing_tag"
                  />
                </label>
              </div>

              {!isCreating && editingVendor && (
                <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700 mb-2">Webhook URL</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-lg border border-blue-200 bg-white px-3 py-2 text-xs font-mono text-slate-700 break-all">
                      {typeof window !== 'undefined'
                        ? `${window.location.origin}/api/webhooks/leads/${editingVendor.slug}`
                        : `/api/webhooks/leads/${editingVendor.slug}`}
                    </code>
                    <button
                      className="app-btn-secondary h-9 px-3 text-xs"
                      onClick={() => copyWebhookUrl(editingVendor.slug)}
                    >
                      {copiedId === editingVendor.slug ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      <span className="ml-1.5">{copiedId === editingVendor.slug ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                  <p className="mt-2 text-[11px] text-slate-500">
                    Direct integration. Vendors post here once you&apos;ve configured their native field mapping below.
                  </p>
                </div>
              )}

              {!isCreating && editingVendor && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Mailbox className="h-4 w-4 text-amber-700" />
                    <p className="text-[11px] font-bold uppercase tracking-wider text-amber-700">Lead Mailbox Bridge</p>
                    <InfoTip text="Point a Lead Mailbox Service at this URL to bridge existing LM traffic into the portal without changing your vendors. Leads flow LM → Portal → Distribution → Bonzo." />
                  </div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-mono text-slate-700 break-all">
                      {typeof window !== 'undefined'
                        ? `${window.location.origin}/api/webhooks/lead-mailbox/${editingVendor.slug}`
                        : `/api/webhooks/lead-mailbox/${editingVendor.slug}`}
                    </code>
                    <button
                      className="app-btn-secondary h-9 px-3 text-xs"
                      onClick={() => copyBridgeUrl(editingVendor.slug)}
                    >
                      {bridgeCopied === 'url' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      <span className="ml-1.5">{bridgeCopied === 'url' ? 'Copied' : 'Copy URL'}</span>
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      type="button"
                      className="app-btn-secondary h-9 px-3 text-xs"
                      onClick={copyBridgeTemplate}
                    >
                      {bridgeCopied === 'template' ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                      <span className="ml-1.5">{bridgeCopied === 'template' ? 'Copied' : 'Copy JSON Template'}</span>
                    </button>
                    <span className="text-[11px] text-slate-500">
                      Paste into the Lead Mailbox Service&apos;s Content field, then fill in <code className="font-mono">routing_tag</code> with the campaign&apos;s tag.
                    </span>
                  </div>
                  <div className="mt-3 rounded-lg bg-white/70 border border-amber-200/70 p-3 text-[11px] leading-relaxed text-slate-600 space-y-1">
                    <p><span className="font-semibold text-slate-700">How it works:</span> Lead Mailbox fires its Service → POSTs to the bridge URL → portal creates a <code className="font-mono">Lead</code> tagged <code className="font-mono">Lead Mailbox ({editingVendor.name})</code> → runs the same round-robin, quotas, and Bonzo forwarding as direct vendors.</p>
                    <p><span className="font-semibold text-slate-700">No vendor mapping required:</span> the bridge uses a built-in Lead Mailbox field map, so your configurable Field Mapping below stays reserved for the eventual direct cutover.</p>
                    <p><span className="font-semibold text-slate-700">Routing:</span> set <code className="font-mono">routing_tag</code> in the template to a campaign&apos;s routing tag. Leave it blank to land the lead in the Unassigned Pool.</p>
                    <p><span className="font-semibold text-slate-700">Numbered fields:</span> the template uses <code className="font-mono">{'{Field_NNN}'}</code> placeholders for property / loan / credit values — those numbers are set in Lead Mailbox&apos;s admin and are already mapped to our current schema. To add fields (DOB, SSN, employment, co-borrower, etc.), find the matching <code className="font-mono">{'{Field_NNN}'}</code> in your LM admin and add a line to the Service&apos;s Content.</p>
                    <p><span className="font-semibold text-slate-700">Success string:</span> the bridge responds with <code className="font-mono">{'"status":"ok"'}</code>, so Lead Mailbox&apos;s default Success String works unchanged.</p>
                  </div>
                </div>
              )}

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">
                  Field Mapping ({Object.keys(form.fieldMapping).length})
                </p>
                <p className="text-xs text-slate-500 mb-3">
                  Map vendor payload fields to our normalized lead fields. Supports dot notation (e.g. &quot;borrower.first_name&quot;).
                </p>

                {Object.keys(form.fieldMapping).length > 0 && (
                  <div className="mb-3 space-y-1.5">
                    {Object.entries(form.fieldMapping).map(([vendorField, ourField]) => (
                      <div key={vendorField} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/50 px-3 py-2">
                        <code className="flex-1 text-xs font-mono text-slate-600">{vendorField}</code>
                        <span className="text-xs text-slate-400">&rarr;</span>
                        <span className="flex-1 text-xs font-semibold text-slate-700">{ourField}</span>
                        <button type="button" className="text-slate-400 hover:text-red-600 transition-colors" onClick={() => removeMapping(vendorField)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50/50 p-3 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="space-y-1 text-sm">
                      <span className="text-xs font-medium text-slate-600">Vendor field name</span>
                      <input
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        value={newMappingVendorField}
                        onChange={(e) => setNewMappingVendorField(e.target.value)}
                        placeholder="e.g. first_name"
                        onKeyDown={(e) => e.key === 'Enter' && addMapping()}
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      <span className="text-xs font-medium text-slate-600">Maps to our field</span>
                      <select
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                        value={newMappingOurField}
                        onChange={(e) => setNewMappingOurField(e.target.value)}
                      >
                        <option value="">Select our field...</option>
                        {NORMALIZED_FIELDS.filter((f) => !Object.values(form.fieldMapping).includes(f)).map((f) => (
                          <option key={f} value={f}>{f}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <button
                    type="button"
                    className="app-btn-primary w-full text-sm"
                    onClick={addMapping}
                  >
                    <Plus className="mr-1.5 h-4 w-4" />
                    Add Field Mapping
                  </button>
                  {mappingError ? (
                    <p className="text-[11px] text-red-500 text-center font-medium">{mappingError}</p>
                  ) : (!newMappingVendorField.trim() || !newMappingOurField) ? (
                    <p className="text-[11px] text-slate-400 text-center">
                      Fill in both fields above, then click &quot;Add Field Mapping&quot;
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3 border-t border-slate-200 pt-4">
              <button className="app-btn-secondary" onClick={closeModal}>Cancel</button>
              <button
                className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
                onClick={() => void handleSave()}
                disabled={saving || !form.name.trim() || !form.slug.trim()}
              >
                {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {saving ? 'Saving...' : isCreating ? 'Create Vendor' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deletingVendor && (
        <VendorDeleteDialog
          vendor={deletingVendor}
          otherVendors={vendors.filter(
            (v) => v.id !== deletingVendor.id && v.active
          )}
          onClose={closeDeleteDialog}
        />
      )}
    </div>
  );
}

/**
 * Permanent-delete dialog. Opens for archived vendors only. Walks the
 * admin through clearing dependencies (reassign campaigns or bulk-delete
 * them, bulk-delete any remaining leads) and then requires typing the
 * vendor name to unlock the final delete. Every destructive step calls a
 * dedicated server action that re-validates on the server — the client
 * can't bypass the "must be archived" / "zero dependencies" / "name
 * matches" gates even if it tries.
 */
function VendorDeleteDialog({
  vendor,
  otherVendors,
  onClose,
}: {
  vendor: Vendor;
  otherVendors: Vendor[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [counts, setCounts] = useState({
    campaigns: vendor._count.campaigns,
    leads: vendor._count.leads,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [targetVendorId, setTargetVendorId] = useState('');
  const [collisions, setCollisions] = useState<
    Array<{ campaignId: string; campaignName: string; routingTag: string }>
  >([]);
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [confirmName, setConfirmName] = useState('');

  const refreshCounts = useCallback(async () => {
    try {
      const c = await getVendorDependencyCounts(vendor.id);
      setCounts({ campaigns: c.campaigns, leads: c.leads });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [vendor.id]);

  const runAction = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true);
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    []
  );

  const handleReassignCampaigns = () =>
    runAction(async () => {
      if (!targetVendorId) {
        setError('Pick a target vendor first.');
        return;
      }
      const result = await reassignVendorCampaigns(
        vendor.id,
        targetVendorId,
        renames
      );
      if (result.collisions.length > 0) {
        setCollisions(result.collisions);
        setError(
          'Some campaigns have routing_tag conflicts with the target vendor. Rename them below to proceed.'
        );
        return;
      }
      setCollisions([]);
      setRenames({});
      await refreshCounts();
      router.refresh();
    });

  const handleDeleteAllCampaigns = () =>
    runAction(async () => {
      if (
        !window.confirm(
          `Delete all ${counts.campaigns} campaign(s) AND their leads for "${vendor.name}"? This cannot be undone.`
        )
      )
        return;
      await deleteAllVendorCampaigns(vendor.id);
      await refreshCounts();
      router.refresh();
    });

  const handleDeleteAllLeads = () =>
    runAction(async () => {
      if (
        !window.confirm(
          `Delete all ${counts.leads} remaining lead(s) for "${vendor.name}"? This cannot be undone.`
        )
      )
        return;
      await deleteAllVendorLeads(vendor.id);
      await refreshCounts();
      router.refresh();
    });

  const handleFinalDelete = () =>
    runAction(async () => {
      await hardDeleteLeadVendor(vendor.id, confirmName);
      onClose();
      router.refresh();
    });

  const dependenciesCleared = counts.campaigns === 0 && counts.leads === 0;
  const confirmMatches = confirmName.trim() === vendor.name;
  const canFinalDelete = dependenciesCleared && confirmMatches && !busy;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onClick={busy ? undefined : onClose}
    >
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl rounded-xl border border-red-200 bg-white shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-red-100 bg-red-50/60 px-6 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-full bg-red-100 p-2">
              <AlertTriangle className="h-5 w-5 text-red-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Permanently delete &quot;{vendor.name}&quot;
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                This is destructive and cannot be undone. Clear dependencies below, then confirm by typing the vendor name.
              </p>
            </div>
          </div>
          <button
            className="app-icon-btn"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div className={`rounded-xl border p-3 ${counts.campaigns === 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Campaigns
                </span>
                {counts.campaigns === 0 ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
              </div>
              <p className="mt-1 text-2xl font-bold text-slate-900">{counts.campaigns}</p>
            </div>
            <div className={`rounded-xl border p-3 ${counts.leads === 0 ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Leads
                </span>
                {counts.leads === 0 ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                )}
              </div>
              <p className="mt-1 text-2xl font-bold text-slate-900">{counts.leads}</p>
            </div>
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          {counts.campaigns > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Step 1 — Handle Campaigns
              </p>

              <div className="space-y-2">
                <label className="block text-xs font-medium text-slate-700">
                  Reassign all {counts.campaigns} campaign{counts.campaigns !== 1 ? 's' : ''} (and their leads) to:
                </label>
                <div className="flex gap-2">
                  <select
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={targetVendorId}
                    onChange={(e) => setTargetVendorId(e.target.value)}
                    disabled={busy || otherVendors.length === 0}
                  >
                    <option value="">
                      {otherVendors.length === 0
                        ? 'No other active vendors available'
                        : 'Select target vendor…'}
                    </option>
                    {otherVendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} ({v.slug})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="app-btn-secondary"
                    onClick={handleReassignCampaigns}
                    disabled={!targetVendorId || busy}
                  >
                    Reassign
                  </button>
                </div>

                {collisions.length > 0 && (
                  <div className="mt-2 space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3">
                    <p className="text-[11px] font-semibold text-amber-800">
                      Rename the following campaigns to avoid routing_tag collisions with the target vendor:
                    </p>
                    {collisions.map((c) => (
                      <div key={c.campaignId} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 font-medium text-slate-700 truncate">
                          {c.campaignName}
                        </span>
                        <span className="font-mono text-slate-500 line-through">
                          {c.routingTag}
                        </span>
                        <span className="text-slate-400">→</span>
                        <input
                          className="w-40 rounded-md border border-slate-200 bg-white px-2 py-1 font-mono text-xs"
                          placeholder="new-routing-tag"
                          value={renames[c.campaignId] ?? ''}
                          onChange={(e) =>
                            setRenames((p) => ({
                              ...p,
                              [c.campaignId]: e.target.value,
                            }))
                          }
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 pt-1">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  OR
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>

              <button
                type="button"
                className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                onClick={handleDeleteAllCampaigns}
                disabled={busy}
              >
                Delete all {counts.campaigns} campaign{counts.campaigns !== 1 ? 's' : ''} (and their leads)
              </button>
            </div>
          )}

          {counts.campaigns === 0 && counts.leads > 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4 space-y-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
                Step 2 — Handle Remaining Leads
              </p>
              <p className="text-xs text-slate-600">
                {counts.leads} lead{counts.leads !== 1 ? 's' : ''} are not attached to any campaign. They must be cleared before the vendor can be deleted.
              </p>
              <button
                type="button"
                className="w-full rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-60"
                onClick={handleDeleteAllLeads}
                disabled={busy}
              >
                Delete all {counts.leads} remaining lead{counts.leads !== 1 ? 's' : ''}
              </button>
            </div>
          )}

          <div
            className={`rounded-xl border p-4 space-y-3 ${
              dependenciesCleared ? 'border-red-200 bg-red-50/40' : 'border-slate-200 bg-slate-50/40 opacity-60'
            }`}
          >
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-600">
              Final confirmation
            </p>
            <label className="block space-y-1 text-xs">
              <span className="font-medium text-slate-700">
                Type <code className="rounded bg-white border border-slate-200 px-1.5 py-0.5 font-mono text-[11px]">{vendor.name}</code> to confirm:
              </span>
              <input
                type="text"
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                disabled={!dependenciesCleared || busy}
                autoComplete="off"
                data-lpignore="true"
              />
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50/60 px-6 py-4">
          <button className="app-btn-secondary" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex items-center rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleFinalDelete}
            disabled={!canFinalDelete}
          >
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Delete Permanently
          </button>
        </div>
      </div>
    </div>
  );
}
