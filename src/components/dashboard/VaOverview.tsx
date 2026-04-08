'use client';

import Link from 'next/link';
import { TaskKind, TaskStatus, TaskWorkflowState, UserRole } from '@prisma/client';
import {
  Inbox,
  Clock,
  MessageSquareWarning,
  CheckCircle2,
  ArrowRight,
  BellRing,
} from 'lucide-react';

type VaTask = {
  id: string;
  kind: TaskKind | null;
  status: TaskStatus;
  workflowState: TaskWorkflowState;
  assignedUser?: { name: string } | null;
};

export type VaRole = 'VA_TITLE' | 'PROCESSOR_JR' | 'VA_PAYOFF' | 'VA_APPRAISAL';

const vaRoleLabel: Record<VaRole, string> = {
  [UserRole.VA_TITLE]: 'Title',
  [UserRole.PROCESSOR_JR]: 'JR Processor',
  [UserRole.VA_PAYOFF]: 'Payoff',
  [UserRole.VA_APPRAISAL]: 'Appraisal',
};

const vaRoleTaskKind: Record<VaRole, TaskKind> = {
  [UserRole.VA_TITLE]: TaskKind.VA_TITLE,
  [UserRole.PROCESSOR_JR]: TaskKind.VA_HOI,
  [UserRole.VA_PAYOFF]: TaskKind.VA_PAYOFF,
  [UserRole.VA_APPRAISAL]: TaskKind.VA_APPRAISAL,
};

function getNewBucketHref(role: VaRole) {
  if (role === UserRole.VA_APPRAISAL) return '/tasks?bucket=va-appraisal-new';
  return '/tasks?bucket=va-new-request';
}

export function VaOverview({ tasks, role }: { tasks: VaTask[]; role: VaRole }) {
  const scopedTasks = tasks.filter((task) => task.kind === vaRoleTaskKind[role]);
  const roleLabel = vaRoleLabel[role];
  const isAppraisal = role === UserRole.VA_APPRAISAL;
  const isHoiProcessor = role === UserRole.PROCESSOR_JR;
  const topBannerTone = isHoiProcessor
    ? {
        container:
          'border-sky-200 bg-gradient-to-r from-sky-50 to-cyan-50/50 hover:border-sky-300',
        glow: 'bg-sky-400',
        ring: 'ring-sky-100',
        iconActive: 'text-sky-600',
        iconIdle: 'text-slate-400',
        title: 'text-sky-950',
        subtitle: 'text-sky-800/80',
        count: 'text-sky-700 ring-sky-100',
        arrowWrap: 'bg-sky-100 text-sky-600',
      }
    : {
        container:
          'border-rose-200 bg-gradient-to-r from-rose-50 to-pink-50/50 hover:border-rose-300',
        glow: 'bg-rose-400',
        ring: 'ring-rose-100',
        iconActive: 'text-rose-600',
        iconIdle: 'text-slate-400',
        title: 'text-rose-950',
        subtitle: 'text-rose-800/80',
        count: 'text-rose-700 ring-rose-100',
        arrowWrap: 'bg-rose-100 text-rose-600',
      };
  const isJrPublicNewTask = (task: VaTask) =>
    task.status === TaskStatus.PENDING &&
    task.workflowState === TaskWorkflowState.NONE &&
    !task.assignedUser;

  const newCount = scopedTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      (isHoiProcessor
        ? isJrPublicNewTask(task)
        : isAppraisal
        ? task.workflowState === TaskWorkflowState.NONE
        : true)
  ).length;

  const myJrCount = isHoiProcessor
    ? scopedTasks.filter(
        (task) => task.status !== TaskStatus.COMPLETED && !isJrPublicNewTask(task)
      ).length
    : 0;

  const waitingMissingCount = scopedTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.WAITING_ON_LO
  ).length;

  const loRespondedCount = scopedTasks.filter(
    (task) =>
      task.status !== TaskStatus.COMPLETED &&
      task.workflowState === TaskWorkflowState.READY_TO_COMPLETE
  ).length;

  const completedCount = scopedTasks.filter((task) => task.status === TaskStatus.COMPLETED).length;

  const commonCards = [
    {
      id: 'va-new-request',
      title: `New ${isHoiProcessor ? '' : 'VA '}${roleLabel} Requests`,
      chipLabel: 'New',
      chipClassName: 'border-rose-200 bg-rose-50 text-rose-700 shadow-sm',
      icon: Inbox,
      iconClassName: 'bg-rose-100 text-rose-600',
      subtitle: `New ${roleLabel.toLowerCase()} requests ready to be worked.`,
      count: newCount,
      href: getNewBucketHref(role),
    },
    {
      id: 'va-completed-requests',
      title: `Completed ${isHoiProcessor ? '' : 'VA '}${roleLabel} Requests`,
      chipLabel: 'Completed',
      chipClassName: 'border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm',
      icon: CheckCircle2,
      iconClassName: 'bg-emerald-100 text-emerald-600',
      subtitle: `${roleLabel} tasks finished and marked complete.`,
      count: completedCount,
      href: isAppraisal
        ? '/tasks?bucket=va-appraisal-completed'
        : '/tasks?bucket=va-completed-requests',
    },
  ];

  const appraisalCards = isAppraisal
    ? [
        {
          id: 'va-appraisal-waiting-missing',
          title: 'Waiting Missing/Incomplete',
          chipLabel: 'Pending LO',
          chipClassName: 'border-amber-200 bg-amber-50 text-amber-700 shadow-sm',
          icon: Clock,
          iconClassName: 'bg-amber-100 text-amber-600',
          subtitle: 'Waiting on LO follow-up before appraisal can continue.',
          count: waitingMissingCount,
          href: '/tasks?bucket=va-appraisal-waiting-missing',
        },
        {
          id: 'va-appraisal-lo-responded',
          title: 'LO Responded (Review)',
          chipLabel: 'Needs Review',
          chipClassName: 'border-sky-200 bg-sky-50 text-sky-700 shadow-sm',
          icon: MessageSquareWarning,
          iconClassName: 'bg-sky-100 text-sky-600',
          subtitle: 'LO has replied and appraisal review is required.',
          count: loRespondedCount,
          href: '/tasks?bucket=va-appraisal-lo-responded',
        },
      ]
    : [];

  const cards = isAppraisal
    ? [commonCards[0], ...appraisalCards, commonCards[1]]
    : isHoiProcessor
    ? [
        commonCards[0],
        {
          id: 'jr-my-requests',
          title: 'My Requests',
          chipLabel: 'In Progress',
          chipClassName: 'border-sky-200 bg-sky-50 text-sky-700 shadow-sm',
          icon: Clock,
          iconClassName: 'bg-sky-100 text-sky-600',
          subtitle: 'Started JR processor tasks assigned to you.',
          count: myJrCount,
          href: '/tasks?bucket=jr-my-requests',
        },
        commonCards[1],
      ]
    : commonCards;

  return (
    <div className="space-y-6">
      <Link
        href={getNewBucketHref(role)}
        className={`group relative flex items-center justify-between overflow-hidden rounded-2xl border p-5 shadow-sm transition-all hover:shadow-md ${topBannerTone.container}`}
      >
        <div
          className={`absolute -left-6 -top-6 h-24 w-24 rounded-full opacity-10 blur-2xl transition-opacity group-hover:opacity-20 ${topBannerTone.glow}`}
        ></div>
        <div className="relative flex items-center gap-4">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white shadow-sm ring-1 ${topBannerTone.ring}`}
          >
            <BellRing
              className={`h-6 w-6 ${
                newCount > 0 ? `${topBannerTone.iconActive} animate-pulse` : topBannerTone.iconIdle
              }`}
            />
          </div>
          <div>
            <p className={`text-lg font-extrabold tracking-tight ${topBannerTone.title}`}>
              New {isHoiProcessor ? '' : 'VA '}{roleLabel} Requests
            </p>
            <p className={`text-sm font-medium ${topBannerTone.subtitle}`}>
              {newCount > 0
                ? `${newCount} request${newCount === 1 ? '' : 's'} ready to be worked.`
                : 'No new requests waiting right now.'}
            </p>
          </div>
        </div>
        <div className="relative flex items-center gap-4">
          <span
            className={`inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-white px-3 text-lg font-black shadow-sm ring-1 ${topBannerTone.count}`}
          >
            {newCount}
          </span>
          <div
            className={`flex h-8 w-8 items-center justify-center rounded-full opacity-0 transition-all group-hover:opacity-100 group-hover:translate-x-1 ${topBannerTone.arrowWrap}`}
          >
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </Link>

      <div
        className={`grid grid-cols-1 gap-5 md:grid-cols-2 ${
          isAppraisal ? 'xl:grid-cols-4' : isHoiProcessor ? 'xl:grid-cols-3' : ''
        }`}
      >
        {cards.map((card) => (
          <Link
            key={card.id}
            href={card.href}
            className="group relative flex flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-lg hover:border-rose-300 hover:ring-1 hover:ring-rose-100"
          >
            <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-slate-50 opacity-50 blur-3xl group-hover:bg-rose-50 transition-colors"></div>

            <div className="relative mb-4 flex items-start justify-between gap-3">
              <div
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${card.iconClassName} shadow-sm ring-1 ring-black/5`}
              >
                <card.icon className="h-5 w-5" />
              </div>
              <span className="inline-flex h-8 min-w-8 items-center justify-center rounded-full bg-slate-50 px-2.5 text-sm font-bold text-slate-700 ring-1 ring-slate-200/60 group-hover:bg-white group-hover:text-rose-700 group-hover:ring-rose-200 transition-colors">
                {card.count}
              </span>
            </div>

            <div className="relative flex-1">
              <h3 className="mb-2 text-sm font-extrabold leading-snug tracking-tight text-slate-900 group-hover:text-rose-950 transition-colors">
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

            <div className="relative mt-5 flex items-center text-xs font-bold text-rose-600 opacity-0 transition-all group-hover:opacity-100">
              Open in Tasks
              <ArrowRight className="ml-1.5 h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
