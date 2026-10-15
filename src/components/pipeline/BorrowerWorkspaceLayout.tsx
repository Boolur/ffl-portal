'use client';
import React, { forwardRef, useState } from 'react';
import { Check, Clipboard, UserRound } from 'lucide-react';

export function DetailCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: typeof UserRound;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700">
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <h3 className="text-sm font-black text-slate-950">{title}</h3>
          {description && (
            <p className="mt-0.5 text-xs font-medium text-slate-500">
              {description}
            </p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}

export function DetailField({
  label,
  value,
  copyable = false,
}: {
  label: string;
  value: React.ReactNode;
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const textValue =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  return (
    <div className="min-w-0 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5">
      <p className="text-[10px] font-black uppercase tracking-[0.1em] text-slate-400">
        {label}
      </p>
      <div className="mt-1 flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1 break-words text-sm font-bold text-slate-800">
          {value || <span className="font-medium text-slate-400">Not provided</span>}
        </div>
        {copyable && textValue && (
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(textValue);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            }}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-blue-200 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
            aria-label={`Copy ${label}`}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Clipboard className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export function DetailGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>;
}

export const WorkspacePanel = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(function WorkspacePanel({ className = '', ...props }, ref) {
  return <div ref={ref} {...props} className={`flex h-[min(94vh,980px)] w-full max-w-[1480px] flex-col overflow-hidden rounded-[28px] border border-white/40 bg-slate-100 shadow-2xl ${className}`} />;
});
