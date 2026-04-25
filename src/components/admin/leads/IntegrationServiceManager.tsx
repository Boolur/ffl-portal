'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Loader2,
  Plus,
  Pencil,
  X,
  Zap,
  Archive,
  ArchiveRestore,
  Trash2,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  createIntegrationService,
  updateIntegrationService,
  archiveIntegrationService,
  restoreIntegrationService,
  deleteIntegrationService,
} from '@/app/actions/leadActions';
import {
  INTEGRATION_SERVICE_TYPES,
  type IntegrationServiceSummary,
} from '@/lib/integrationServices/types';

type Props = {
  services: IntegrationServiceSummary[];
};

type EditTarget =
  | { mode: 'create' }
  | { mode: 'edit'; service: IntegrationServiceSummary };

const TYPE_DESCRIPTIONS: Record<string, string> = {
  bonzo:
    "Forwards each lead to the assigned LO's configured Bonzo webhook URL (set per-user on the Lead Users screen).",
};

export function IntegrationServiceManager({ services }: Props) {
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [deleteTarget, setDeleteTarget] =
    useState<IntegrationServiceSummary | null>(null);
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  const runAction = useCallback(
    async (id: string, fn: () => Promise<unknown>) => {
      setPending(id);
      try {
        await fn();
        router.refresh();
      } catch (err) {
        alert(err instanceof Error ? err.message : 'Action failed');
      } finally {
        setPending(null);
      }
    },
    [router]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-500">
          {services.length} service{services.length === 1 ? '' : 's'}
          {services.some((s) => !s.active) && (
            <span className="ml-2 text-xs text-slate-400">
              (archived services are hidden from the Push to Service picker)
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditTarget({ mode: 'create' })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New service
        </button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b border-slate-200">
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Status
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Service
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Slug
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Type
              </th>
              <th className="px-4 py-3 text-left text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Description
              </th>
              <th
                className="px-4 py-3 text-right text-[11px] font-bold uppercase tracking-wider text-slate-500 whitespace-nowrap"
                style={{ width: 180, minWidth: 180 }}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {services.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-sm text-slate-500"
                >
                  No services yet. Click <span className="font-semibold">New service</span> to add one.
                </td>
              </tr>
            ) : (
              services.map((s) => (
                <tr
                  key={s.id}
                  className={`align-middle ${s.active ? '' : 'bg-amber-50/30'}`}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                        s.active
                          ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border border-amber-200 bg-amber-50 text-amber-700'
                      }`}
                    >
                      {s.active ? 'Active' : 'Archived'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700">
                        <Zap className="h-4 w-4" />
                      </div>
                      <span className="font-semibold text-slate-900">
                        {s.name}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-mono text-slate-600">
                    {s.slug}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-mono text-slate-700">
                      {s.type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600 max-w-md">
                    {s.description || (
                      <span className="text-slate-400">
                        {TYPE_DESCRIPTIONS[s.type] ?? '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        className="app-icon-btn"
                        onClick={() =>
                          setEditTarget({ mode: 'edit', service: s })
                        }
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      {s.active ? (
                        <button
                          className="app-icon-btn text-amber-600 hover:bg-amber-50"
                          onClick={() =>
                            void runAction(s.id, () =>
                              archiveIntegrationService(s.id)
                            )
                          }
                          title="Archive"
                          disabled={pending === s.id}
                        >
                          {pending === s.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Archive className="h-4 w-4" />
                          )}
                        </button>
                      ) : (
                        <>
                          <button
                            className="app-icon-btn text-emerald-600 hover:bg-emerald-50"
                            onClick={() =>
                              void runAction(s.id, () =>
                                restoreIntegrationService(s.id)
                              )
                            }
                            title="Restore"
                            disabled={pending === s.id}
                          >
                            {pending === s.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <ArchiveRestore className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            className="app-icon-btn app-icon-btn-danger"
                            onClick={() => setDeleteTarget(s)}
                            title="Permanently delete…"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {editTarget && (
        <ServiceEditModal
          target={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            router.refresh();
          }}
        />
      )}

      {deleteTarget && (
        <ServiceDeleteDialog
          service={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={() => {
            setDeleteTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function ServiceEditModal({
  target,
  onClose,
  onSaved,
}: {
  target: EditTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = target.mode === 'edit' ? target.service : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [slug, setSlug] = useState(existing?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(target.mode === 'edit');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [type, setType] = useState(
    existing?.type ?? INTEGRATION_SERVICE_TYPES[0]
  );
  const [configJson, setConfigJson] = useState(
    JSON.stringify(existing?.config ?? {}, null, 2)
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const firstInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstInput.current?.focus();
  }, []);

  useEffect(() => {
    if (slugTouched) return;
    const auto = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    setSlug(auto);
  }, [name, slugTouched]);

  const handleSave = useCallback(async () => {
    setError(null);
    let parsedConfig: unknown;
    try {
      parsedConfig = configJson.trim() ? JSON.parse(configJson) : {};
    } catch {
      setError('Config must be valid JSON (or empty).');
      return;
    }
    setSaving(true);
    try {
      if (target.mode === 'create') {
        await createIntegrationService({
          name,
          slug: slug || undefined,
          description: description || null,
          type,
          config: parsedConfig,
        });
      } else {
        await updateIntegrationService(target.service.id, {
          name,
          description: description || null,
          type,
          config: parsedConfig,
        });
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [configJson, description, name, onSaved, slug, target, type]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-lg max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-slate-900">
            {target.mode === 'create' ? 'Create Service' : 'Edit Service'}
          </h2>
          <button
            className="app-icon-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          <label className="space-y-1 block text-sm">
            <span className="font-medium text-slate-700">Name *</span>
            <input
              ref={firstInput}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Bonzo"
            />
          </label>

          <label className="space-y-1 block text-sm">
            <span className="font-medium text-slate-700">Slug *</span>
            <input
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value);
              }}
              placeholder="bonzo"
              disabled={target.mode === 'edit'}
            />
            {target.mode === 'edit' && (
              <span className="text-xs text-slate-400">
                Slug is permanent once the service is created.
              </span>
            )}
          </label>

          <label className="space-y-1 block text-sm">
            <span className="font-medium text-slate-700">Type *</span>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {INTEGRATION_SERVICE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-400">
              {TYPE_DESCRIPTIONS[type] ??
                'Maps to a handler in src/lib/services.'}
            </span>
          </label>

          <label className="space-y-1 block text-sm">
            <span className="font-medium text-slate-700">Description</span>
            <textarea
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              rows={2}
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <label className="space-y-1 block text-sm">
            <span className="font-medium text-slate-700">
              Config (JSON){' '}
              <span className="text-xs text-slate-400">— optional</span>
            </span>
            <textarea
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-mono focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              rows={4}
              value={configJson}
              onChange={(e) => setConfigJson(e.target.value)}
              placeholder='{}'
            />
            <span className="text-xs text-slate-400">
              For Bonzo this can stay empty — each LO&apos;s webhook URL is
              read from their Lead Users settings.
            </span>
          </label>

          {error && (
            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            disabled={saving}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !name.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {target.mode === 'create' ? 'Create' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ServiceDeleteDialog({
  service,
  onClose,
  onDeleted,
}: {
  service: IntegrationServiceSummary;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmName, setConfirmName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-sm" />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-900">
          Permanently delete &ldquo;{service.name}&rdquo;?
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          This cannot be undone. The service will be removed from the
          Push-to-Service picker everywhere. Type the service name to confirm.
        </p>
        <input
          className="mt-3 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          placeholder={service.name}
        />
        {error && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </div>
        )}
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={confirmName.trim() !== service.name || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await deleteIntegrationService(service.id, confirmName.trim());
                onDeleted();
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Delete failed');
              } finally {
                setBusy(false);
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            <Trash2 className="h-4 w-4" />
            Delete permanently
          </button>
        </div>
      </div>
    </div>
  );
}
