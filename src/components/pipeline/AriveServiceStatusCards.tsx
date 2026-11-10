import { CalendarDays, ClipboardCheck, Landmark, ReceiptText, ShieldCheck } from 'lucide-react';
import type { AriveSyncServiceTracker } from '@/lib/ariveSyncTypes';
import { formatAriveSyncDate } from '@/lib/ariveSyncPresentation';

const serviceIcons = { TITLE: Landmark, HOI: ShieldCheck, APPRAISAL: ClipboardCheck, PAYOFFS: ReceiptText };

function serviceTone(tracker: AriveSyncServiceTracker) {
  if (tracker.availability !== 'current') return {
    card: 'border-amber-200 bg-amber-50 text-amber-950', icon: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500',
  };
  if (tracker.status === 'RECEIVED' || (tracker.name === 'APPRAISAL' && tracker.status === 'COMPLETE')) return {
    card: 'border-emerald-200 bg-emerald-50 text-emerald-950', icon: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500',
  };
  if (['NOT_ORDERED', 'NOT_REQUESTED', 'NOT_STARTED'].includes(tracker.status)) return {
    card: 'border-rose-200 bg-rose-50 text-rose-950', icon: 'bg-rose-100 text-rose-700', dot: 'bg-rose-500',
  };
  if (['ORDERED', 'REQUESTED', 'SCHEDULED', 'INSPECTED'].includes(tracker.status)) return {
    card: 'border-blue-200 bg-blue-50 text-blue-950', icon: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500',
  };
  return { card: 'border-slate-200 bg-white text-slate-800', icon: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' };
}

export function AriveServiceStatusCards({ trackers, variant = 'featured', sourceLabel = 'Arive', className = '' }: {
  trackers: readonly AriveSyncServiceTracker[] | null | undefined;
  variant?: 'featured' | 'compact';
  sourceLabel?: string;
  className?: string;
}) {
  if (!trackers?.length) return null;
  const compact = variant === 'compact';
  return <div aria-label={sourceLabel === 'Arive' ? 'Last synchronized service progress' : `${sourceLabel} service progress`} className={`grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 ${className}`}>
    {trackers.map(tracker => {
      const Icon = serviceIcons[tracker.name];
      const tone = serviceTone(tracker);
      return <article key={tracker.name} className={`flex min-w-0 flex-col rounded-xl border ${compact ? 'p-3' : 'p-4 shadow-sm'} ${tone.card}`}>
        <div className="flex items-start gap-2.5">
          <span className={`inline-flex shrink-0 items-center justify-center rounded-xl ${compact ? 'h-8 w-8' : 'h-10 w-10'} ${tone.icon}`}><Icon size={compact ? 16 : 20} aria-hidden="true" /></span>
          <div className="min-w-0 flex-1">
            <h4 className={`${compact ? 'text-[10px]' : 'text-xs'} font-bold leading-4`}>{tracker.label}</h4>
            {!compact && sourceLabel && <p className="mt-0.5 text-[10px] font-medium opacity-65">{sourceLabel}</p>}
          </div>
        </div>
        <p className={`${compact ? 'mt-2.5 text-xs' : 'mt-4 text-base'} flex items-start gap-1.5 font-bold leading-snug`}><span aria-hidden="true" className={`mt-[0.4em] h-1.5 w-1.5 shrink-0 rounded-full ${tone.dot}`} /><span className="min-w-0 break-words">{tracker.statusLabel}</span></p>
        <p className={`flex items-start gap-1.5 text-[10px] leading-4 opacity-70 ${compact ? 'mt-1.5' : 'mt-2'}`}><CalendarDays size={12} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{tracker.date ? formatAriveSyncDate(tracker.date) : 'Date not supplied'}</span></p>
      </article>;
    })}
  </div>;
}
