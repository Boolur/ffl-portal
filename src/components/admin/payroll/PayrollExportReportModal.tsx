'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import {
  CalendarRange,
  Download,
  FileSpreadsheet,
  Loader2,
  ShieldCheck,
  X,
} from 'lucide-react';
import { getPayrollExportReport } from '@/app/actions/payrollActions';
import { downloadPayrollExportReport } from '@/lib/payrollExportReport';

type Props = {
  startDate: string;
  endDate: string;
};

function formatDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(year, month - 1, day));
}

export function PayrollExportReportModal({ startDate, endDate }: Props) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isPending) setOpen(false);
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      trigger?.focus();
    };
  }, [isPending, open]);

  function exportReport() {
    setError(null);
    startTransition(async () => {
      try {
        const report = await getPayrollExportReport({ startDate, endDate });
        downloadPayrollExportReport(report);
        setOpen(false);
      } catch (err) {
        console.error(err);
        setError('Unable to build the payroll report. Please try again.');
      }
    });
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className="inline-flex self-stretch items-center justify-center gap-2 rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm font-bold text-white ring-1 ring-white/10 transition hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 sm:self-auto"
      >
        <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
        Reports
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/55 p-4 text-slate-900 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPending) setOpen(false);
          }}
          data-live-refresh-pause="true"
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="payroll-export-title"
            className="w-full max-w-xl overflow-hidden rounded-[28px] border border-slate-200/70 bg-white text-left shadow-2xl"
          >
            <div className="flex items-start justify-between gap-5 border-b border-slate-200/70 px-6 py-5">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-600">
                  Payroll reports
                </p>
                <h2
                  id="payroll-export-title"
                  className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950"
                >
                  Export payroll data
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-500">
                  Export requests from the active reporting date range.
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                onClick={() => setOpen(false)}
                disabled={isPending}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 disabled:opacity-50"
                aria-label="Close payroll reports"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4 bg-slate-50 px-6 py-5">
              <div className="flex flex-wrap gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-slate-600 ring-1 ring-slate-200">
                  <CalendarRange className="h-3.5 w-3.5 text-emerald-600" />
                  {formatDate(startDate)} – {formatDate(endDate)}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-100">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Payroll admins only
                </span>
              </div>

              <button
                type="button"
                onClick={exportReport}
                disabled={isPending}
                className="group flex w-full items-start gap-4 rounded-2xl border border-emerald-100 bg-white p-5 text-left shadow-sm shadow-slate-200/60 transition hover:border-emerald-200 hover:bg-emerald-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 disabled:cursor-wait disabled:opacity-70"
              >
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200 transition group-hover:bg-emerald-600 group-hover:text-white">
                  {isPending ? (
                    <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                  ) : (
                    <FileSpreadsheet className="h-5 w-5" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-extrabold text-slate-950">
                    Payroll Export Report
                  </span>
                  <span className="mt-1 block text-sm font-medium leading-5 text-slate-500">
                    All request fields in two formatted Excel tabs: Broker and Non-Del.
                  </span>
                  <span className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700">
                    <Download className="h-3.5 w-3.5" aria-hidden="true" />
                    {isPending ? 'Building report...' : 'Export Excel workbook'}
                  </span>
                </span>
              </button>

              {error ? (
                <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
                  {error}
                </p>
              ) : null}

              <p className="text-xs font-medium leading-5 text-slate-500">
                The workbook includes every available loan-officer entry, imported loan detail,
                and payroll review value for requests submitted in this range.
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
