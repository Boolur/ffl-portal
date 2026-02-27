'use client';

import Link from 'next/link';
import {
  TaskKind,
  TaskStatus,
  TaskWorkflowState,
} from '@prisma/client';

type DisclosureTask = {
  id: string;
  kind: TaskKind | null;
  status: TaskStatus;
  workflowState: TaskWorkflowState;
};

function isDisclosureTask(task: DisclosureTask) {
  return task.kind === TaskKind.SUBMIT_DISCLOSURES;
}

export function DisclosureOverview({ tasks }: { tasks: DisclosureTask[] }) {
  const disclosureTasks = tasks.filter(isDisclosureTask);

  const newCount = disclosureTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.NONE
  ).length;

  const waitingMissingCount = disclosureTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.WAITING_ON_LO
  ).length;

  const waitingApprovalCount = disclosureTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL
  ).length;

  const loRespondedCount = disclosureTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
  ).length;

  const completedCount = disclosureTasks.filter(
    (task) => task.status === TaskStatus.COMPLETED
  ).length;

  const cards = [
    {
      id: 'new-disclosure',
      title: 'New Disclosure Requests',
      chipLabel: 'New',
      chipClassName: 'border-blue-200 bg-blue-50 text-blue-700',
      subtitle: 'Newly submitted files ready for first review.',
      count: newCount,
      href: '/tasks?bucket=new-disclosure',
    },
    {
      id: 'waiting-missing',
      title: 'Waiting for Missing/Incomplete Items',
      chipLabel: 'Pending LO',
      chipClassName: 'border-amber-200 bg-amber-50 text-amber-700',
      subtitle: 'Files waiting on LO follow-up before review can continue.',
      count: waitingMissingCount,
      href: '/tasks?bucket=waiting-missing',
    },
    {
      id: 'lo-responded',
      title: 'LO Responded (Needs Review)',
      chipLabel: 'Needs Review',
      chipClassName: 'border-violet-200 bg-violet-50 text-violet-700',
      subtitle: 'LO has replied and disclosure desk review is required.',
      count: loRespondedCount,
      href: '/tasks?bucket=lo-responded',
    },
    {
      id: 'waiting-approval',
      title: 'Waiting for Approval',
      chipLabel: 'Awaiting Approval',
      chipClassName: 'border-indigo-200 bg-indigo-50 text-indigo-700',
      subtitle: 'Initial figures sent to LO and pending approval/revision.',
      count: waitingApprovalCount,
      href: '/tasks?bucket=waiting-approval',
    },
    {
      id: 'completed-disclosure',
      title: 'Completed Disclosure Requests',
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      subtitle: 'Disclosure flow finished and marked complete.',
      count: completedCount,
      href: '/tasks?bucket=completed-disclosure',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
      {cards.map((card) => (
        <Link
          key={card.id}
          href={card.href}
          className="rounded-xl border border-border bg-card/70 p-4 hover:shadow-md transition-all hover:border-blue-300"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground leading-tight">
              {card.title}
            </p>
            <span className="app-count-badge shrink-0">{card.count}</span>
          </div>
          <span
            className={`mt-2 inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${card.chipClassName}`}
          >
            {card.chipLabel}
          </span>
          <p className="mt-2 text-xs text-muted-foreground">{card.subtitle}</p>
          <p className="mt-3 text-xs font-semibold text-primary">Open in Tasks</p>
        </Link>
      ))}
    </div>
  );
}
