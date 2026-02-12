'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  saveLeadMailboxMapping,
  deleteLeadMailboxMapping,
  bulkUpsertLeadMailboxMappings,
} from '@/app/actions/leadMailboxActions';
import { Trash2, PlusCircle, Upload, X, Loader2 } from 'lucide-react';

type UserOption = {
  id: string;
  name: string;
  email: string;
  role: string;
};

type Mapping = {
  id: string;
  externalId: string;
  user: UserOption;
};

type LeadMailboxMappingManagerProps = {
  users: UserOption[];
  mappings: Mapping[];
};

type BulkRow = {
  externalId: string;
  userEmail?: string;
  userId?: string;
};

const normalizeHeader = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, '');

const headerMap: Record<string, keyof BulkRow> = {
  externalid: 'externalId',
  userid: 'userId',
  useremail: 'userEmail',
  email: 'userEmail',
};

function parseCsv(raw: string): BulkRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map((h) => normalizeHeader(h));
  const mappedHeaders = headers.map((header) => headerMap[header] || null);

  return lines.slice(1).map((line) => {
    const values = line.split(',').map((v) => v.trim());
    return values.reduce<BulkRow>((acc, value, index) => {
      const key = mappedHeaders[index];
      if (key) acc[key] = value;
      return acc;
    }, { externalId: '' });
  });
}

export function LeadMailboxMappingManager({ users, mappings }: LeadMailboxMappingManagerProps) {
  const loanOfficers = users.filter((user) => user.role === 'LOAN_OFFICER');
  const [externalId, setExternalId] = useState('');
  const [selectedUserId, setSelectedUserId] = useState(loanOfficers[0]?.id || '');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const [showImport, setShowImport] = useState(false);
  const [importRows, setImportRows] = useState<BulkRow[]>([]);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{
    created: number;
    updated: number;
    skipped: number;
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const importCloseButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!showImport) return;

    importCloseButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowImport(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showImport]);

  const handleSave = async () => {
    if (isSaving) return;
    setStatus(null);
    if (!selectedUserId) {
      setStatus({ type: 'error', message: 'No loan officers available.' });
      return;
    }
    setIsSaving(true);
    try {
      const result = await saveLeadMailboxMapping(externalId, selectedUserId);
      if (!result.success) {
        setStatus({ type: 'error', message: result.error || 'Failed to save mapping.' });
        return;
      }
      setExternalId('');
      setStatus({ type: 'success', message: 'Mapping saved.' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (mappingId: string) => {
    const confirmed = window.confirm('Delete this mapping?');
    if (!confirmed) return;
    await deleteLeadMailboxMapping(mappingId);
  };

  const handleCsvFile = async (file: File) => {
    setImportError(null);
    setImportResult(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setImportError('No rows detected. Check the CSV format.');
        return;
      }
      setImportRows(rows);
    } catch (error) {
      console.error(error);
      setImportError('Failed to parse CSV file.');
    }
  };

  const handleImport = async () => {
    if (isImporting) return;
    if (importRows.length === 0) return;
    setIsImporting(true);
    try {
      const result = await bulkUpsertLeadMailboxMappings(importRows);
      if (!result.success) {
        setImportError(result.error || 'Import failed.');
        return;
      }
      setImportResult({
        created: result.created || 0,
        updated: result.updated || 0,
        skipped: result.skipped || 0,
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Add Mapping</h2>
            <p className="text-sm text-slate-500 mt-1">
              Map Lead Mailbox user IDs to internal loan officers.
            </p>
          </div>
          <button
            onClick={() => setShowImport(true)}
            className="app-btn-secondary"
          >
            <Upload className="w-4 h-4" />
            Bulk Import
          </button>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3">
          <input
            value={externalId}
            onChange={(event) => setExternalId(event.target.value)}
            placeholder="Lead Mailbox user_id (external)"
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
          />
          {loanOfficers.length === 0 ? (
            <div className="px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-500">
              No loan officers available
            </div>
          ) : (
            <select
              value={selectedUserId}
              onChange={(event) => setSelectedUserId(event.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-sm"
            >
              {loanOfficers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({user.email})
                </option>
              ))}
            </select>
          )}
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <PlusCircle className="w-4 h-4" />}
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {status && (
          <p
            className={`mt-3 text-sm rounded-lg border px-3 py-2 ${
              status.type === 'success'
                ? 'text-green-700 bg-green-50 border-green-200'
                : 'text-red-700 bg-red-50 border-red-200'
            }`}
          >
            {status.message}
          </p>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Existing Mappings</h2>
        <p className="text-sm text-slate-500 mt-1">
          Lead Mailbox external IDs assigned to users.
        </p>

        <div className="mt-4 space-y-3">
          {mappings.length === 0 && (
            <p className="text-sm text-slate-500">No mappings yet.</p>
          )}
          {mappings.map((mapping) => (
            <div
              key={mapping.id}
              className="flex items-center justify-between border border-slate-200 rounded-lg px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{mapping.externalId}</p>
                <p className="text-xs text-slate-500">
                  {mapping.user.name} • {mapping.user.email}
                </p>
              </div>
              <button
                onClick={() => handleDelete(mapping.id)}
                className="text-slate-400 hover:text-red-600"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </div>

      {showImport && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div
            role="dialog"
            aria-modal="true"
            className="bg-white rounded-xl border border-slate-200 shadow-lg w-full max-w-lg p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">Bulk Import</h3>
              <button
                ref={importCloseButtonRef}
                onClick={() => setShowImport(false)}
                className="app-icon-btn"
                aria-label="Close bulk import modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-slate-500">
              CSV headers: externalId, userEmail (or userId).
            </p>
            <input
              type="file"
              accept=".csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleCsvFile(file);
              }}
              className="w-full text-sm"
            />
            {importError && <div className="text-xs text-red-600">{importError}</div>}
            {importRows.length > 0 && (
              <div className="text-xs text-slate-600">
                Parsed {importRows.length} rows.
              </div>
            )}
            {importResult && (
              <div className="text-xs text-green-600">
                Created {importResult.created}, updated {importResult.updated}, skipped{' '}
                {importResult.skipped}.
              </div>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setShowImport(false)}
                className="app-btn-secondary"
              >
                Close
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="app-btn-primary disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {isImporting ? 'Importing...' : 'Import'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
