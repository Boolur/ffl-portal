'use client';

import React, { useMemo, useState } from 'react';
import { Building2, ChevronDown, ChevronUp, Copy, ExternalLink, Search } from 'lucide-react';
import type { LenderRecord } from '@/app/actions/lenderActions';

type LendersDirectoryProps = {
  lenders: LenderRecord[];
};

export function LendersDirectory({ lenders }: LendersDirectoryProps) {
  const [search, setSearch] = useState('');
  const [expandedLenderId, setExpandedLenderId] = useState<string | null>(null);
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const filteredLenders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return lenders;
    return lenders.filter((lender) => {
      const haystack = [
        lender.name,
        lender.description || '',
        lender.portalUrl || '',
        ...lender.contacts.map((contact) =>
          [contact.name, contact.title || '', contact.email || '', contact.phone || ''].join(' ')
        ),
        ...lender.links.map((link) => `${link.label} ${link.url}`),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [lenders, search]);

  const copyValue = async (value: string, label: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      const message = `${label} copied`;
      setCopiedText(message);
      window.setTimeout(() => setCopiedText((prev) => (prev === message ? null : prev)), 1800);
    } catch {
      setCopiedText('Copy failed');
    }
  };

  return (
    <div className="space-y-4">
      <div className="app-page-header">
        <h1 className="app-page-title">Lenders</h1>
        <p className="app-page-subtitle">
          Search your approved lender partners and quickly access portal links, account executives, and support contacts.
        </p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search lender name, AE, portal, or keywords"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-8 pr-3 text-sm font-medium text-slate-700"
          />
        </label>
      </div>

      {copiedText && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">
          {copiedText}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {filteredLenders.map((lender) => {
          const isExpanded = expandedLenderId === lender.id;
          return (
            <article
              key={lender.id}
              className={`rounded-2xl border bg-white p-4 shadow-sm transition-all ${
                isExpanded
                  ? 'border-blue-300 ring-1 ring-blue-100'
                  : 'border-slate-200 hover:border-slate-300 hover:shadow-md'
              }`}
            >
              <div className="mb-3 flex min-h-[140px] items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
                {lender.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={lender.logoUrl}
                    alt={`${lender.name} logo`}
                    className="h-full w-full object-contain"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Building2 className="h-10 w-10 text-slate-300" />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setExpandedLenderId((prev) => (prev === lender.id ? null : lender.id))}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  aria-label={isExpanded ? 'Collapse lender details' : 'Expand lender details'}
                >
                  {isExpanded ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>
              </div>

              {isExpanded && (
                <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                  <h3 className="text-center text-lg font-bold text-slate-900">
                    {lender.name}
                  </h3>
                  {(lender.portalUrl || lender.links.length > 0) && (
                    <div>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                        Portal & Links
                      </p>
                      <div className="space-y-1.5">
                        {lender.portalUrl && (
                          <a
                            href={lender.portalUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                          >
                            Primary Portal
                            <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                          </a>
                        )}
                        {lender.links.map((link) => (
                          <a
                            key={link.id}
                            href={link.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                          >
                            <span className="truncate">{link.label}</span>
                            <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      Contacts
                    </p>
                    <div className="space-y-1.5">
                      {lender.contacts.length === 0 && (
                        <p className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-500">
                          No contacts configured yet.
                        </p>
                      )}
                      {lender.contacts.map((contact) => (
                        <div key={contact.id} className="rounded-lg border border-slate-200 bg-white p-2.5">
                          <p className="text-xs font-semibold text-slate-900">{contact.name}</p>
                          {contact.title && <p className="text-[11px] text-slate-500">{contact.title}</p>}
                          <div className="mt-1.5 space-y-1">
                            {contact.email && (
                              <button
                                type="button"
                                onClick={() => copyValue(contact.email || '', 'Email')}
                                className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                              >
                                <span className="truncate">{contact.email}</span>
                                <Copy className="h-3 w-3 text-slate-400" />
                              </button>
                            )}
                            {contact.phone && (
                              <button
                                type="button"
                                onClick={() => copyValue(contact.phone || '', 'Phone')}
                                className="flex w-full items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-left text-[11px] font-medium text-slate-700 hover:bg-slate-100"
                              >
                                <span>{contact.phone}</span>
                                <Copy className="h-3 w-3 text-slate-400" />
                              </button>
                            )}
                          </div>
                          {contact.notes && (
                            <p className="mt-1.5 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] text-slate-600">
                              {contact.notes}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {filteredLenders.length === 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">
          No lenders match your search.
        </div>
      )}
    </div>
  );
}
