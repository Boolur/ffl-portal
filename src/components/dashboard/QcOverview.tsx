'use client';

import Link from 'next/link';
import { TaskKind, TaskStatus, TaskWorkflowState } from '@prisma/client';
import {
  Inbox,
  Clock,
  MessageSquareWarning,
  CheckCircle2,
  ArrowRight,
  BellRing,
} from 'lucide-react';

type QcTask = {
  id: string;
  kind: TaskKind | null;
  status: TaskStatus;
  workflowState: TaskWorkflowState;
};

function isQcTask(task: QcTask) {
  return task.kind === TaskKind.SUBMIT_QC;
}

export function QcOverview({ tasks }: { tasks: QcTask[] }) {
  const qcTasks = tasks.filter(isQcTask);

  const newCount = qcTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.NONE
  ).length;

  const waitingMissingCount = qcTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      (task.workflowState === TaskWorkflowState.WAITING_ON_LO ||
        task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL)
  ).length;

  const loRespondedCount = qcTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
  ).length;

  const completedCount = qcTasks.filter(
    (task) => task.status === TaskStatus.COMPLETED
  ).length;

  const cards = [
    {
      id: 'qc-new',
      title: 'New QC Requests',
      chipLabel: 'New',
      chipClassName: 'border-blue-200 bg-blue-50 text-blue-700 shadow-sm',
      icon: Inbox,
      iconClassName: 'bg-blue-100 text-blue-600',
      subtitle: 'Newly submitted QC files ready for first review.',
      count: newCount,
      href: '/tasks?bucket=qc-new',
    },
    {
      id: 'qc-waiting-missing',
      title: 'Waiting Missing/Incomplete',
      chipLabel: 'Pending LO',
      chipClassName: 'border-amber-200 bg-amber-50 text-amber-700 shadow-sm',
      icon: Clock,
      iconClassName: 'bg-amber-100 text-amber-600',
      subtitle: 'Files waiting on LO follow-up before QC can continue.',
      count: waitingMissingCount,
      href: '/tasks?bucket=qc-waiting-missing',
    },
    {
      id: 'qc-lo-responded',
      title: 'LO Responded (Review)',
      chipLabel: 'Needs Review',
      chipClassName: 'border-violet-200 bg-violet-50 text-violet-700 shadow-sm',
      icon: MessageSquareWarning,
      iconClassName: 'bg-violet-100 text-violet-600',
      subtitle: 'LO has replied and QC review is required.',
      count: loRespondedCount,
      href: '/tasks?bucket=qc-lo-responded',
    },
    {
      id: 'qc-completed-requests',
      title: 'Completed QC Requests',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm',
      icon: CheckCircle2,
      iconClassName: 'bg-emerald-100 text-emerald-600',
      subtitle: 'QC flow finished and marked complete.',
      count: completedCount,
      href: '/tasks?bucket=qc-completed-requests',
    },
  ];

  return (
    <div className="space-y-6">
      <Link
        href="/tasks?bucket=qc-new"
        className="group relative flex items-center justify-between overflow-hidden rounded-2xl border border-violet-200 bg-gradient-to-r from-violet-50 to-indigo-50/50 p-5 shadow-sm transition-all hover:shadow-md hover:border-violet-300"
      >
        <div className="absolute -left-6 -top-6 h-24 w-24 rounded-full bg-violet-400 opacity-10 blur-2xl group-hover:opacity-20 transition-opacity"></div>
        <div className="relative flex items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ring-violet-100">
            <BellRing
              className={`h-6 w-6 ${newCount > 0 ? 'text-violet-600 animate-pulse' : 'text-slate-400'}`}
            />
          </div>
          <div>
            <p className="text-lg font-extrabold tracking-tight text-violet-950">New QC Requests in Queue</p>
            <p className="text-sm font-medium text-violet-800/80">
              {newCount > 0
                ? `${newCount} request${newCount === 1 ? '' : 's'} ready for first review.`
                : 'No new QC requests waiting right now.'}
            </p>
          </div>
        </div>
        <div className="relative flex items-center gap-4">
          <span className="inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-white px-3 text-lg font-black text-violet-700 shadow-sm ring-1 ring-violet-100">
            {newCount}
          </span>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-violet-600 opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-1">
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Link
            key={card.id}
            href={card.href}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-violet-300 hover:ring-1 hover:ring-violet-100"
          >
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-slate-50 opacity-50 blur-3xl group-hover:bg-violet-50 transition-colors"></div>

            <div className="relative mb-4 flex items-start justify-between gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.iconClassName} shadow-sm ring-1 ring-black/5`}>
                <card.icon className="h-5 w-5" />
              </div>
              <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-50 px-2.5 text-sm font-bold text-slate-700 ring-1 ring-slate-200/60 group-hover:bg-white group-hover:text-violet-700 group-hover:ring-violet-200 transition-colors">
                {card.count}
              </span>
            </div>

            <div className="relative flex-1">
              <h3 className="mb-2 text-sm font-extrabold leading-snug tracking-tight text-slate-900 group-hover:text-violet-950 transition-colors">
                {card.title}
              </h3>
              <span
                className={`mb-3 inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${card.chipClassName}`}
              >
                {card.chipLabel}
              </span>
              <p className="text-xs font-medium leading-relaxed text-slate-500 line-clamp-2">
                {card.subtitle}
              </p>
            </div>

            <div className="relative mt-5 flex items-center text-xs font-bold text-violet-600 opacity-0 transition-all group-hover:opacity-100">
              Open in Tasks
              <ArrowRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
