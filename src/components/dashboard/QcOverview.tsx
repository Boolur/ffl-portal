'use client';

import Link from 'next/link';
import { TaskKind, TaskStatus, TaskWorkflowState } from '@prisma/client';

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

  const newCount = qcTasks.filter((task) => {
    if (task.status === TaskStatus.COMPLETED) return false;
    return (
      task.workflowState !== TaskWorkflowState.WAITING_ON_LO &&
      task.workflowState !== TaskWorkflowState.WAITING_ON_LO_APPROVAL
    );
  }).length;

  const pendingLoCount = qcTasks.filter((task) => {
    return (
      task.status !== TaskStatus.COMPLETED &&
      (task.workflowState === TaskWorkflowState.WAITING_ON_LO ||
        task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL)
    );
  }).length;

  const completedCount = qcTasks.filter(
    (task) => task.status === TaskStatus.COMPLETED
  ).length;

  const cards = [
    {
      id: 'new',
      title: 'New QC Requests',
      subtitle: 'New or ready-to-work QC files.',
      count: newCount,
      href: '/tasks?bucket=new',
    },
    {
      id: 'pending-lo',
      title: 'Pending LO Tasks',
      subtitle: 'Waiting on loan officer responses for QC.',
      count: pendingLoCount,
      href: '/tasks?bucket=pending-lo',
    },
    {
      id: 'completed',
      title: 'Completed',
      subtitle: 'QC requests fully completed.',
      count: completedCount,
      href: '/tasks?bucket=completed',
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
