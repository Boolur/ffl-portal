'use client';

import {
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  CheckSquare2,
  Clock3,
  Download,
  FileSpreadsheet,
  Layers3,
  Loader2,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { ProcessingPipelineStatus } from '@prisma/client';
import { getProcessingPipelineReport } from '@/app/actions/processingPipelineReportingActions';
import { downloadProcessingReport } from '@/lib/processingPipelineReportExport';
import {
  PROCESSING_REPORT_STATUSES,
  type ProcessingReportType,
} from '@/lib/processingPipelineReports';

type Props = {
  teamLoanOfficerIds: string[];
  selectedTeamNames: string[];
  onClose: () => void;
};

const STATUS_LABELS: Record<ProcessingPipelineStatus, string> = {
  [ProcessingPipelineStatus.SUBBED_TO_UW]: 'Subbed to UW',
  [ProcessingPipelineStatus.APPROVED_WITH_CONDITIONS]:
    'Approved with conditions',
  [ProcessingPipelineStatus.RE_SUB]: 'Re-sub',
  [ProcessingPipelineStatus.CTC]: 'CTC',
  [ProcessingPipelineStatus.DOCS_OUT]: 'Docs out',
  [ProcessingPipelineStatus.FUNDED]: 'Funded',
  [ProcessingPipelineStatus.SUSPENDED]: 'Suspended',
  [ProcessingPipelineStatus.SUSPENDED_RESTRUCTURE]:
    'Suspended/Restructure',
  [ProcessingPipelineStatus.ADVERSE_PENDING]: 'Adverse Pending',
  [ProcessingPipelineStatus.PENDING_APPROVAL]: 'Pending Approval',
};

function ReportCard({
  title,
  description,
  tone,
  icon: Icon,
  loading,
  expanded,
  onClick,
}: {
  title: string;
  description: string;
  tone: 'blue' | 'purple' | 'emerald';
  icon: typeof Clock3;
  loading: boolean;
  expanded?: boolean;
  onClick: () => void;
}) {
  const tones = {
    blue: {
      border: 'border-blue-100 hover:border-blue-200 hover:bg-blue-50/70',
      icon: 'bg-blue-100 text-blue-700 ring-blue-200 group-hover:bg-blue-600',
      action: 'text-blue-700',
    },
    purple: {
      border:
        'border-purple-100 hover:border-purple-200 hover:bg-purple-50/70',
      icon:
        'bg-purple-100 text-purple-700 ring-purple-200 group-hover:bg-purple-600',
      action: 'text-purple-700',
    },
    emerald: {
      border:
        'border-emerald-100 hover:border-emerald-200 hover:bg-emerald-50/70',
      icon:
        'bg-emerald-100 text-emerald-700 ring-emerald-200 group-hover:bg-emerald-600',
      action: 'text-emerald-700',
    },
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-expanded={expanded}
      className={`group flex w-full items-start gap-4 rounded-2xl border bg-white p-4 text-left shadow-sm shadow-slate-200/60 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200 disabled:cursor-wait disabled:opacity-70 ${tones.border}`}
    >
      <span
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 transition group-hover:text-white ${tones.icon}`}
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : (
          <Icon className="h-5 w-5" aria-hidden="true" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold text-slate-950">
          {title}
        </span>
        <span className="mt-1 block text-sm font-medium text-slate-500">
          {description}
        </span>
        <span
          className={`mt-2 inline-flex items-center gap-1.5 text-xs font-bold ${tones.action}`}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          {loading
            ? 'Building report...'
            : expanded
              ? 'Choose statuses below'
              : 'Export Excel sheet'}
        </span>
      </span>
    </button>
  );
}

export function ProcessingPipelineReportsModal({
  teamLoanOfficerIds,
  selectedTeamNames,
  onClose,
}: Props) {
  const [selectedStatuses, setSelectedStatuses] = useState<
    ProcessingPipelineStatus[]
  >([...PROCESSING_REPORT_STATUSES]);
  const [statusSelectorOpen, setStatusSelectorOpen] = useState(false);
  const [exportingType, setExportingType] =
    useState<ProcessingReportType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) || [],
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
      previousFocus?.focus();
    };
  }, [onClose]);

  const scopeLabel =
    selectedTeamNames.length > 0
      ? `Selected Teams: ${selectedTeamNames.join(', ')}`
      : 'All role-authorized active loans';

  function exportReport(type: ProcessingReportType) {
    if (type === 'PIPELINE_STATUS' && selectedStatuses.length === 0) {
      setError('Select at least one pipeline status.');
      return;
    }
    setError(null);
    setExportingType(type);
    startTransition(async () => {
      try {
        const result = await getProcessingPipelineReport({
          type,
          statuses:
            type === 'PIPELINE_STATUS' ? selectedStatuses : undefined,
          teamLoanOfficerIds:
            selectedTeamNames.length > 0 ? teamLoanOfficerIds : undefined,
        });
        if (!result.success) {
          setError(result.error);
          return;
        }
        downloadProcessingReport(result.report, { scopeLabel });
        onClose();
      } catch (err) {
        console.error(err);
        setError('Unable to build this report. Please try again.');
      } finally {
        setExportingType(null);
      }
    });
  }

  function toggleStatus(status: ProcessingPipelineStatus) {
    setSelectedStatuses((current) =>
      current.includes(status)
        ? current.filter((value) => value !== status)
        : [...current, status],
    );
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/50 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      data-live-refresh-pause="true"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="processing-reports-title"
        className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-2xl"
      >
        <div className="flex items-start justify-between gap-5 border-b border-slate-200/70 px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">
              Processing reports
            </p>
            <h2
              id="processing-reports-title"
              className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950"
            >
              Export operational reports
            </h2>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Active Pipeline and Restructure loans only. Fundings are excluded.
            </p>
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
              {scopeLabel}
            </div>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-200"
            aria-label="Close processing reports"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-145px)] space-y-3 overflow-y-auto bg-slate-50 px-6 py-5">
          {error && (
            <div
              role="alert"
              className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700"
            >
              {error}
            </div>
          )}
          <ReportCard
            title="Last Touch Report"
            description="Sorts active loans from longest untouched to most recently touched, with the latest audited action and actor."
            tone="blue"
            icon={Clock3}
            loading={isPending && exportingType === 'LAST_TOUCH'}
            onClick={() => exportReport('LAST_TOUCH')}
          />
          <ReportCard
            title="Pipeline Status Report"
            description="Exports active loans matching one or more selected pipeline statuses across Pipeline and Restructures."
            tone="purple"
            icon={Layers3}
            loading={isPending && exportingType === 'PIPELINE_STATUS'}
            expanded={statusSelectorOpen}
            onClick={() => setStatusSelectorOpen((open) => !open)}
          />
          {statusSelectorOpen && (
            <section
              aria-label="Pipeline statuses"
              className="rounded-2xl border border-purple-100 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                  Select statuses
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedStatuses([...PROCESSING_REPORT_STATUSES])
                    }
                    className="text-xs font-bold text-purple-700 hover:text-purple-900 focus-visible:outline-none focus-visible:underline"
                  >
                    Select all
                  </button>
                  <span className="text-slate-300">•</span>
                  <button
                    type="button"
                    onClick={() => setSelectedStatuses([])}
                    className="text-xs font-bold text-slate-500 hover:text-slate-800 focus-visible:outline-none focus-visible:underline"
                  >
                    Clear
                  </button>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {PROCESSING_REPORT_STATUSES.map((status) => {
                  const checked = selectedStatuses.includes(status);
                  return (
                    <label
                      key={status}
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-bold transition ${
                        checked
                          ? 'border-purple-200 bg-purple-50 text-purple-900'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleStatus(status)}
                        className="sr-only"
                      />
                      {checked ? (
                        <CheckSquare2 className="h-4 w-4 text-purple-600" />
                      ) : (
                        <Square className="h-4 w-4 text-slate-400" />
                      )}
                      {STATUS_LABELS[status]}
                    </label>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={isPending || selectedStatuses.length === 0}
                onClick={() => exportReport('PIPELINE_STATUS')}
                className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 text-sm font-extrabold text-white shadow-sm transition hover:bg-purple-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isPending && exportingType === 'PIPELINE_STATUS' ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                Export {selectedStatuses.length} selected status
                {selectedStatuses.length === 1 ? '' : 'es'}
              </button>
            </section>
          )}
          <ReportCard
            title="Services Report"
            description="Tracks Title, HOI, Appraisal, and Payoff status age, milestone dates, SLA warnings, and remaining work."
            tone="emerald"
            icon={FileSpreadsheet}
            loading={isPending && exportingType === 'SERVICES'}
            onClick={() => exportReport('SERVICES')}
          />
        </div>
      </div>
    </div>
  );
}
