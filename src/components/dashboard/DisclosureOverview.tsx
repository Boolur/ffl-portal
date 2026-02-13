'use client';

import Link from 'next/link';
import { TaskKind, TaskStatus, TaskWorkflowState } from '@prisma/client';

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

  const newCount = disclosureTasks.filter((task) => {
    if (task.status === TaskStatus.COMPLETED) return false;
    return (
      task.workflowState !== TaskWorkflowState.WAITING_ON_LO &&
      task.workflowState !== TaskWorkflowState.WAITING_ON_LO_APPROVAL
    );
  }).length;

  const pendingLoCount = disclosureTasks.filter((task) => {
    return (
      task.status !== TaskStatus.COMPLETED &&
      (task.workflowState === TaskWorkflowState.WAITING_ON_LO ||
        task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL)
    );
  }).length;

  const completedCount = disclosureTasks.filter(
    (task) => task.status === TaskStatus.COMPLETED
  ).length;

  const cards = [
    {
      id: 'new',
      title: 'New Disclosure Requests',
      subtitle: 'New or ready-to-work disclosure files.',
      count: newCount,
      href: '/tasks?bucket=new',
    },
    {
      id: 'pending-lo',
      title: 'Pending LO Tasks',
      subtitle: 'Waiting on loan officer approval or missing items.',
      count: pendingLoCount,
      href: '/tasks?bucket=pending-lo',
    },
    {
      id: 'completed',
      title: 'Completed',
      subtitle: 'Disclosure requests fully completed.',
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
          className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            {card.title}
          </p>
          <p className="mt-2 text-3xl font-bold text-slate-900">{card.count}</p>
          <p className="mt-2 text-sm text-slate-500">{card.subtitle}</p>
          <p className="mt-4 text-xs font-semibold text-blue-600">Open in Tasks</p>
        </Link>
      ))}
    </div>
  );
}
