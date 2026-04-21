'use client';

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Loader2, Plus, Pencil, Trash2, Copy, Check, X, Globe, HelpCircle, ArrowUp, ArrowDown, Search, Mailbox } from 'lucide-react';
import {
  createLeadVendor,
  updateLeadVendor,
  deleteLeadVendor,
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
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [vendorSearch, setVendorSearch] = useState('');
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

  const filteredVendors = useMemo(() => {
    let list = vendors;
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
  }, [vendors, vendorSearch, sortCol, sortDir]);

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

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this vendor and all its campaigns? This cannot be undone.')) return;
    setLoading(true);
    try {
      await deleteLeadVendor(id);
      router.refresh();
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async (v: Vendor) => {
    setLoading(true);
    try {
      await updateLeadVendor(v.id, { active: !v.active });
      router.refresh();
    } finally {
      setLoading(false);
    }
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
                <tr key={v.id} className="align-middle hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-semibold text-slate-900">{v.name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.slug}</td>
                  <td className="px-4 py-3 text-center">
                    <button
                      onClick={() => void handleToggleActive(v)}
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors ${
                        v.active
                          ? 'border border-blue-200 bg-blue-50 text-blue-700'
                          : 'border border-slate-200 bg-white text-slate-500'
                      }`}
                    >
                      {v.active ? 'Active' : 'Inactive'}
                    </button>
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
                      <button className="app-icon-btn app-icon-btn-danger" onClick={() => void handleDelete(v.id)} title="Delete">
                        <Trash2 className="h-4 w-4" />
                      </button>
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
                  <span className="font-medium text-slate-700">Webhook Secret<InfoTip text="An optional password the vendor includes in their request header to prove they're authorized. If set, any request without this secret will be rejected." /></span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={form.webhookSecret}
                    onChange={(e) => setForm((p) => ({ ...p, webhookSecret: e.target.value }))}
                    placeholder="Optional — for signature verification"
                  />
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
    </div>
  );
}
