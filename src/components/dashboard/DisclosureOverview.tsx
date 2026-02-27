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
      subtitle: 'Newly submitted files ready for first review.',
      count: newCount,
      href: '/tasks?bucket=new-disclosure',
    },
    {
      id: 'waiting-missing',
      title: 'Waiting for Missing/Incomplete Items',
      subtitle: 'Files waiting on LO follow-up before review can continue.',
      count: waitingMissingCount,
      href: '/tasks?bucket=waiting-missing',
    },
    {
      id: 'waiting-approval',
      title: 'Waiting for Approval',
      subtitle: 'Initial figures sent to LO and pending approval/revision.',
      count: waitingApprovalCount,
      href: '/tasks?bucket=waiting-approval',
    },
    {
      id: 'lo-responded',
      title: 'LO Responded (Needs Review)',
      subtitle: 'LO has replied and disclosure desk review is required.',
      count: loRespondedCount,
      href: '/tasks?bucket=lo-responded',
    },
    {
      id: 'completed-disclosure',
      title: 'Completed Disclosure Requests',
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
          className="rounded-xl border border-border bg-card p-5 shadow-sm hover:shadow-md transition-shadow"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {card.title}
          </p>
          <p className="mt-2 text-3xl font-bold text-foreground">{card.count}</p>
          <p className="mt-2 text-sm text-muted-foreground">{card.subtitle}</p>
          <p className="mt-4 text-xs font-semibold text-primary">Open in Tasks</p>
        </Link>
      ))}
    </div>
  );
}
