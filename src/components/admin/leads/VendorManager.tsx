'use client';

import React, { useState, useCallback } from 'react';
import { Loader2, Plus, Pencil, Trash2, Copy, Check, X, Globe } from 'lucide-react';
import {
  createLeadVendor,
  updateLeadVendor,
  deleteLeadVendor,
} from '@/app/actions/leadActions';
import { useRouter } from 'next/navigation';

type Vendor = {
  id: string;
  name: string;
  slug: string;
  webhookSecret: string | null;
  fieldMapping: Record<string, string>;
  routingTagField: string;
  active: boolean;
  _count: { leads: number; campaigns: number };
};

const NORMALIZED_FIELDS = [
  'firstName','lastName','email','phone','homePhone','workPhone','dob',
  'coFirstName','coLastName','coEmail','coPhone','coHomePhone','coWorkPhone','coDob',
  'mailingAddress','mailingCity','mailingState','mailingZip','mailingCounty',
  'propertyAddress','propertyCity','propertyState','propertyZip','propertyCounty',
  'purchasePrice','propertyValue','propertyType','propertyUse','propertyAcquired','propertyLtv',
  'employer','jobTitle','employmentLength','selfEmployed','income','bankruptcy','homeowner',
  'coEmployer','coJobTitle','coEmploymentLength','coSelfEmployed','coIncome',
  'loanPurpose','loanAmount','loanTerm','loanType','loanRate',
  'downPayment','cashOut','creditRating',
  'currentLender','currentBalance','currentRate','currentPayment','currentTerm','currentType',
  'otherBalance','otherPayment','targetRate',
  'vaStatus','vaLoan','isMilitary','fhaLoan','sourceUrl',
];

export function VendorManager({ vendors: initialVendors }: { vendors: Vendor[] }) {
  const router = useRouter();
  const [vendors] = useState(initialVendors);
  const [editingVendor, setEditingVendor] = useState<Vendor | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

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
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this vendor and all its campaigns? This cannot be undone.')) return;
    await deleteLeadVendor(id);
    router.refresh();
  };

  const handleToggleActive = async (v: Vendor) => {
    await updateLeadVendor(v.id, { active: !v.active });
    router.refresh();
  };

  const copyWebhookUrl = (slug: string) => {
    const url = `${window.location.origin}/api/webhooks/leads/${slug}`;
    navigator.clipboard.writeText(url);
    setCopiedId(slug);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const addMapping = () => {
    if (!newMappingVendorField.trim() || !newMappingOurField) return;
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
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
            {vendors.length} vendor{vendors.length !== 1 ? 's' : ''}
          </span>
        </div>
        <button className="app-btn-primary" onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Vendor
        </button>
      </div>

      {vendors.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center shadow-sm">
          <Globe className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No vendors configured</p>
          <p className="mt-1 text-sm text-slate-500">Add a lead vendor to start receiving leads via webhook.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-[1] bg-slate-50">
              <tr className="border-b border-slate-200">
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Vendor</th>
                <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">Slug</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Status</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Campaigns</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Leads</th>
                <th className="px-4 py-3 text-center text-[11px] font-bold uppercase tracking-wider text-slate-500">Webhook</th>
                <th className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {vendors.map((v) => (
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg max-h-[85vh] overflow-y-auto"
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
                  <span className="font-medium text-slate-700">Name *</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={form.name}
                    onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                    placeholder="LendingTree LongForm"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Slug *</span>
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
                  <span className="font-medium text-slate-700">Webhook Secret</span>
                  <input
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    value={form.webhookSecret}
                    onChange={(e) => setForm((p) => ({ ...p, webhookSecret: e.target.value }))}
                    placeholder="Optional — for signature verification"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="font-medium text-slate-700">Routing Tag Field</span>
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
                </div>
              )}

              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-3">Field Mapping</p>
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
                        <button className="text-slate-400 hover:text-red-600 transition-colors" onClick={() => removeMapping(vendorField)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-end gap-2">
                  <label className="flex-1 space-y-1 text-sm">
                    <span className="text-xs font-medium text-slate-500">Vendor field</span>
                    <input
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={newMappingVendorField}
                      onChange={(e) => setNewMappingVendorField(e.target.value)}
                      placeholder="vendor_field_name"
                      onKeyDown={(e) => e.key === 'Enter' && addMapping()}
                    />
                  </label>
                  <label className="flex-1 space-y-1 text-sm">
                    <span className="text-xs font-medium text-slate-500">Our field</span>
                    <select
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      value={newMappingOurField}
                      onChange={(e) => setNewMappingOurField(e.target.value)}
                    >
                      <option value="">Select...</option>
                      {NORMALIZED_FIELDS.filter((f) => !Object.values(form.fieldMapping).includes(f)).map((f) => (
                        <option key={f} value={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="app-btn-secondary h-[38px] px-3 text-xs"
                    onClick={addMapping}
                    disabled={!newMappingVendorField.trim() || !newMappingOurField}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
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
