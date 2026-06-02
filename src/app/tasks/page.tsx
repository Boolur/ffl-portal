import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { prisma } from '@/lib/prisma';
import { TaskBucketsBoard } from '@/components/tasks/TaskBucketsBoard';
import { TaskDeskSection } from '@/components/tasks/TaskDeskSection';
import { TasksRouteSyncGate } from '@/components/tasks/TasksRouteSyncGate';
import { LoVaBorrowerProgressList } from '@/components/loanOfficer/LoVaBorrowerProgressList';
import { PaginatedTaskList } from '@/components/tasks/PaginatedTaskList';
import { buildLoVaBorrowerProgress } from '@/lib/loVaProgress';
import { isAdmin } from '@/lib/adminTiers';
import { canDeleteTasks } from '@/lib/taskPermissions';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { ClipboardCheck, FileCheck2, Home, Landmark, ShieldCheck } from 'lucide-react';
import { startPerfTimer } from '@/lib/perf';
import {
  getBucketDefinitionsForRole,
  getLoPilotBucketSets,
  getManagerDeskBucketSets,
  getManagerVaDeskBucketSets,
} from '@/lib/tasks/bucketDefinitions';
import { buildPaginatedBucketsForView } from '@/lib/tasks/buildPaginatedBuckets';
import { fetchTaskBucketPage, getScopedTaskCount } from '@/lib/tasks/fetchTaskRows';
import { getLoVaProgressTasks } from '@/lib/tasks/loVaProgressQuery';
import { defaultSortForRole } from '@/lib/tasks/taskBucketSort';
import { isTaskBucketId, type TaskBucketId } from '@/lib/tasks/types';
import type { Task } from '@/components/tasks/TaskList';

const MOCK_USER = {
  id: 'mock-user-id',
  name: 'Sarah Disclosure',
  role: UserRole.DISCLOSURE_SPECIALIST,
};

function normalizeRole(role?: string | null): UserRole {
  if (!role) return MOCK_USER.role;
  const normalized = role.trim().toUpperCase();
  const roles = Object.values(UserRole) as string[];
  if (!roles.includes(normalized)) return MOCK_USER.role;
  return normalized as UserRole;
}

function normalizeBucketFilter(value?: string): TaskBucketId | null {
  if (value && isTaskBucketId(value)) return value;
  return null;
}

type TasksPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const endPerf = startPerfTimer('page.tasks.render.total');
  const session = await getServerSession(authOptions);
  const sessionRole = normalizeRole(session?.user?.activeRole || session?.user?.role);
  const sessionUser = {
    name: session?.user?.name || MOCK_USER.name,
    role: sessionRole,
    id: session?.user?.id || '',
    email: session?.user?.email || '',
  };
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const rawBucket = resolvedSearchParams?.bucket;
  const rawTaskId = resolvedSearchParams?.taskId;
  const focusedTaskId =
    typeof rawTaskId === 'string' && rawTaskId.trim().length > 0
      ? rawTaskId.trim()
      : null;
  const bucket =
    normalizeBucketFilter(typeof rawBucket === 'string' ? rawBucket : undefined) || 'all';

  const userId = sessionUser.id || undefined;
  const isManagerLike = sessionRole === UserRole.MANAGER || isAdmin(sessionRole);
  const isDualDeskMode =
    sessionRole === UserRole.LOAN_OFFICER ||
    sessionRole === UserRole.LOA ||
    isManagerLike;

  const [
    scopedTaskCount,
    jrAssigneeOptions,
    roleBucketDefs,
    loPilotDefs,
    managerDeskDefs,
    managerVaDefs,
    loVaProgressTasks,
  ] = await Promise.all([
    getScopedTaskCount(sessionRole, userId),
    isAdmin(sessionRole) ||
    sessionRole === UserRole.MANAGER ||
    sessionRole === UserRole.PROCESSOR_JR
      ? prisma.user.findMany({
          where: {
            active: true,
            OR: [
              { role: UserRole.PROCESSOR_JR },
              { roles: { has: UserRole.PROCESSOR_JR } },
            ],
          },
          select: { id: true, name: true },
          orderBy: { name: 'asc' },
        })
      : Promise.resolve([]),
    Promise.resolve(getBucketDefinitionsForRole(sessionRole)),
    sessionRole === UserRole.LOAN_OFFICER || sessionRole === UserRole.LOA
      ? Promise.resolve(getLoPilotBucketSets())
      : Promise.resolve(null),
    isManagerLike ? Promise.resolve(getManagerDeskBucketSets()) : Promise.resolve(null),
    isManagerLike || sessionRole === UserRole.VA
      ? Promise.resolve(getManagerVaDeskBucketSets())
      : Promise.resolve(null),
    sessionRole === UserRole.LOAN_OFFICER ||
    sessionRole === UserRole.LOA ||
    isManagerLike
      ? getLoVaProgressTasks(sessionRole, userId)
      : Promise.resolve([]),
  ]);

  const [
    roleBuckets,
    dualDeskDisclosureBuckets,
    dualDeskQcBuckets,
    managerVaAppraisalBuckets,
    managerVaPayoffBuckets,
    managerVaTitleBuckets,
    managerVaHoiBuckets,
    flatListInitialPage,
  ] = await Promise.all([
    buildPaginatedBucketsForView(roleBucketDefs, sessionRole, userId),
    loPilotDefs
      ? buildPaginatedBucketsForView(loPilotDefs.disclosureBuckets, sessionRole, userId)
      : Promise.resolve([]),
    loPilotDefs
      ? buildPaginatedBucketsForView(loPilotDefs.qcBuckets, sessionRole, userId)
      : Promise.resolve([]),
    managerVaDefs && (isManagerLike || sessionRole === UserRole.VA)
      ? buildPaginatedBucketsForView(managerVaDefs.vaAppraisalBuckets, sessionRole, userId)
      : Promise.resolve([]),
    managerVaDefs && (isManagerLike || sessionRole === UserRole.VA)
      ? buildPaginatedBucketsForView(managerVaDefs.vaPayoffBuckets, sessionRole, userId)
      : Promise.resolve([]),
    managerVaDefs && (isManagerLike || sessionRole === UserRole.VA)
      ? buildPaginatedBucketsForView(managerVaDefs.vaTitleBuckets, sessionRole, userId)
      : Promise.resolve([]),
    managerVaDefs && isManagerLike
      ? buildPaginatedBucketsForView(managerVaDefs.vaHoiBuckets, sessionRole, userId)
      : Promise.resolve([]),
    !isDualDeskMode && roleBucketDefs.length === 0 && sessionRole !== UserRole.VA
      ? fetchTaskBucketPage({
          bucketId: '__all__',
          role: sessionRole,
          userId,
          sort: defaultSortForRole(sessionRole),
        }).then((page) => ({
          tasks: page.tasks as Task[],
          nextCursor: page.nextCursor,
          totalMatching: page.totalMatching,
          hasMore: page.hasMore,
        }))
      : Promise.resolve(null),
  ]);

  const managerDisclosureBuckets = managerDeskDefs
    ? await buildPaginatedBucketsForView(managerDeskDefs.disclosureBuckets, sessionRole, userId)
    : [];
  const managerQcBuckets = managerDeskDefs
    ? await buildPaginatedBucketsForView(managerDeskDefs.qcBuckets, sessionRole, userId)
    : [];

  const dualDeskRows = isDualDeskMode
    ? {
        disclosureBuckets:
          sessionRole === UserRole.LOAN_OFFICER || sessionRole === UserRole.LOA
            ? dualDeskDisclosureBuckets
            : managerDisclosureBuckets,
        qcBuckets:
          sessionRole === UserRole.LOAN_OFFICER || sessionRole === UserRole.LOA
            ? dualDeskQcBuckets
            : managerQcBuckets,
      }
    : null;

  const managerVaRows =
    managerVaDefs && (isManagerLike || sessionRole === UserRole.VA)
      ? {
          vaAppraisalBuckets: managerVaAppraisalBuckets,
          vaPayoffBuckets: managerVaPayoffBuckets,
          vaTitleBuckets: managerVaTitleBuckets,
          vaHoiBuckets: managerVaHoiBuckets,
        }
      : null;

  const loVaProgressItems = buildLoVaBorrowerProgress(loVaProgressTasks);
  const showLoVaPilot = sessionRole === UserRole.LOAN_OFFICER;
  const canDelete = canDeleteTasks(sessionRole);
  const showBuckets = roleBuckets.length > 0;
  const activeBucket = roleBuckets.find((b) => b.id === bucket)?.id || null;

  const roleTaskSubtitle: Record<string, string> = {
    [UserRole.LOAN_OFFICER]:
      'Manage submitted requests, complete LO actions, and track returns sent back to Disclosure.',
    [UserRole.LOA]:
      'Submit requests and monitor all loan officer workflows across Disclosure, QC, VA, and JR desks.',
    ADMIN: 'Oversee Disclosure, QC, and VA queues with full desk-level actions.',
    ADMIN_I: 'Oversee Disclosure, QC, and VA queues with full desk-level actions.',
    ADMIN_II: 'Oversee Disclosure, QC, and VA queues with full desk-level actions.',
    ADMIN_III: 'Oversee Disclosure, QC, and VA queues with full desk-level actions.',
    [UserRole.MANAGER]:
      'Oversee Disclosure, QC, and VA queues with full desk-level actions.',
    [UserRole.DISCLOSURE_SPECIALIST]: 'Work disclosure tasks by due date and status.',
    [UserRole.VA]:
      'Work all VA queues (Title, Payoff, Appraisal) without manager-level disclosure/QC views.',
    [UserRole.VA_TITLE]: 'Complete Title tasks and upload proof before finishing.',
    [UserRole.VA_PAYOFF]: 'Complete Payoff tasks and upload proof before finishing.',
    [UserRole.VA_APPRAISAL]:
      'Complete Appraisal Specialist tasks and upload proof before finishing.',
    [UserRole.QC]: 'Review and complete quality control tasks.',
    [UserRole.PROCESSOR_JR]: 'Complete JR Processor requests and upload proof before finishing.',
    [UserRole.PROCESSOR_SR]: 'Handle advanced processing tasks and escalations.',
  };

  const taskPageSubtitle =
    sessionRole === UserRole.VA
      ? ''
      : roleTaskSubtitle[sessionRole] || 'View and manage task status across your workflow.';

  const pageOutput = (
    <DashboardShell user={sessionUser}>
      <TasksRouteSyncGate>
        <div className="app-page-header flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h1 className="app-page-title">Tasks</h1>
            {taskPageSubtitle && <p className="app-page-subtitle">{taskPageSubtitle}</p>}
          </div>
          <div className="flex shrink-0 space-x-3">
            <span className="app-count-badge">{scopedTaskCount} Total Tasks</span>
          </div>
        </div>

        {dualDeskRows && (
          <div className="space-y-5">
            <TaskDeskSection
              title="Disclosure Requests"
              icon={<ClipboardCheck className="h-5 w-5" />}
              iconClassName="bg-blue-50 text-blue-600 ring-blue-100"
              buckets={dualDeskRows.disclosureBuckets}
              activeBucketId={
                dualDeskRows.disclosureBuckets.find((b) => b.id === bucket)?.id || null
              }
              canDelete={canDelete}
              currentRole={sessionRole}
              currentUserId={sessionUser.id}
              jrAssigneeOptions={jrAssigneeOptions}
              initialFocusedTaskId={focusedTaskId}
              bucketScrollMode="fixed"
              fixedScrollClassName="h-[540px] overflow-y-auto pr-1"
            />
            <TaskDeskSection
              title="QC Requests"
              icon={<ShieldCheck className="h-5 w-5" />}
              iconClassName="bg-violet-50 text-violet-600 ring-violet-100"
              buckets={dualDeskRows.qcBuckets}
              activeBucketId={dualDeskRows.qcBuckets.find((b) => b.id === bucket)?.id || null}
              canDelete={canDelete}
              currentRole={sessionRole}
              currentUserId={sessionUser.id}
              jrAssigneeOptions={jrAssigneeOptions}
              initialFocusedTaskId={focusedTaskId}
              bucketScrollMode="fixed"
              fixedScrollClassName="h-[540px] overflow-y-auto pr-1"
            />
            {showLoVaPilot && (
              <LoVaBorrowerProgressList items={loVaProgressItems} currentRole={sessionRole} />
            )}
            {sessionRole === UserRole.LOA && (
              <LoVaBorrowerProgressList items={loVaProgressItems} currentRole={sessionRole} />
            )}
            {isManagerLike && managerVaRows && (
              <>
                <TaskDeskSection
                  title="Appraisal Requests"
                  icon={<ShieldCheck className="h-5 w-5" />}
                  iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
                  buckets={managerVaRows.vaAppraisalBuckets}
                  activeBucketId={
                    managerVaRows.vaAppraisalBuckets.find((b) => b.id === bucket)?.id || null
                  }
                  canDelete={canDelete}
                  currentRole={sessionRole}
                  currentUserId={sessionUser.id}
                  jrAssigneeOptions={jrAssigneeOptions}
                  initialFocusedTaskId={focusedTaskId}
                  bucketScrollMode="fixed"
                  fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
                  enableBatchDelete
                />
                <TaskDeskSection
                  title="Payoff Requests"
                  icon={<Landmark className="h-5 w-5" />}
                  iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
                  buckets={managerVaRows.vaPayoffBuckets}
                  activeBucketId={
                    managerVaRows.vaPayoffBuckets.find((b) => b.id === bucket)?.id || null
                  }
                  canDelete={canDelete}
                  currentRole={sessionRole}
                  currentUserId={sessionUser.id}
                  jrAssigneeOptions={jrAssigneeOptions}
                  initialFocusedTaskId={focusedTaskId}
                  bucketScrollMode="fixed"
                  fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
                  enableBatchDelete
                />
                <TaskDeskSection
                  title="Title Requests"
                  icon={<FileCheck2 className="h-5 w-5" />}
                  iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
                  buckets={managerVaRows.vaTitleBuckets}
                  activeBucketId={
                    managerVaRows.vaTitleBuckets.find((b) => b.id === bucket)?.id || null
                  }
                  canDelete={canDelete}
                  currentRole={sessionRole}
                  currentUserId={sessionUser.id}
                  jrAssigneeOptions={jrAssigneeOptions}
                  initialFocusedTaskId={focusedTaskId}
                  bucketScrollMode="fixed"
                  fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
                  enableBatchDelete
                />
                <TaskDeskSection
                  title="JR Processor Requests"
                  icon={<Home className="h-5 w-5" />}
                  iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
                  buckets={managerVaRows.vaHoiBuckets}
                  activeBucketId={
                    managerVaRows.vaHoiBuckets.find((b) => b.id === bucket)?.id || null
                  }
                  canDelete={canDelete}
                  currentRole={sessionRole}
                  currentUserId={sessionUser.id}
                  jrAssigneeOptions={jrAssigneeOptions}
                  initialFocusedTaskId={focusedTaskId}
                  bucketScrollMode="fixed"
                  fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
                  enableBatchDelete
                />
                <LoVaBorrowerProgressList
                  items={loVaProgressItems}
                  mode="completed_only"
                  className="pt-1"
                  currentRole={sessionRole}
                />
              </>
            )}
          </div>
        )}

        {!isDualDeskMode && sessionRole === UserRole.VA && managerVaRows && (
          <div className="space-y-5">
            <TaskDeskSection
              title="Appraisals"
              icon={<ShieldCheck className="h-5 w-5" />}
              iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
              buckets={managerVaRows.vaAppraisalBuckets}
              activeBucketId={
                managerVaRows.vaAppraisalBuckets.find((b) => b.id === bucket)?.id || null
              }
              canDelete={canDelete}
              currentRole={sessionRole}
              currentUserId={sessionUser.id}
              jrAssigneeOptions={jrAssigneeOptions}
              initialFocusedTaskId={focusedTaskId}
              bucketScrollMode="fixed"
              fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
            />
            <TaskDeskSection
              title="Payoffs"
              icon={<Landmark className="h-5 w-5" />}
              iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
              buckets={managerVaRows.vaPayoffBuckets}
              activeBucketId={
                managerVaRows.vaPayoffBuckets.find((b) => b.id === bucket)?.id || null
              }
              canDelete={canDelete}
              currentRole={sessionRole}
              currentUserId={sessionUser.id}
              jrAssigneeOptions={jrAssigneeOptions}
              initialFocusedTaskId={focusedTaskId}
              bucketScrollMode="fixed"
              fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
            />
            <TaskDeskSection
              title="Title"
              icon={<FileCheck2 className="h-5 w-5" />}
              iconClassName="bg-rose-50 text-rose-600 ring-rose-100"
              buckets={managerVaRows.vaTitleBuckets}
              activeBucketId={
                managerVaRows.vaTitleBuckets.find((b) => b.id === bucket)?.id || null
              }
              canDelete={canDelete}
              currentRole={sessionRole}
              currentUserId={sessionUser.id}
              jrAssigneeOptions={jrAssigneeOptions}
              initialFocusedTaskId={focusedTaskId}
              bucketScrollMode="fixed"
              fixedScrollClassName="h-[300px] overflow-y-auto pr-1"
            />
          </div>
        )}

        {!isDualDeskMode && sessionRole !== UserRole.VA && showBuckets && (
          <TaskBucketsBoard
            buckets={roleBuckets}
            activeBucketId={activeBucket}
            canDelete={canDelete}
            currentRole={sessionRole}
            currentUserId={sessionUser.id}
            jrAssigneeOptions={jrAssigneeOptions}
            initialFocusedTaskId={focusedTaskId}
            bucketScrollMode={
              sessionRole === UserRole.DISCLOSURE_SPECIALIST || sessionRole === UserRole.QC
                ? 'fixed'
                : 'auto'
            }
            fixedScrollClassName={
              sessionRole === UserRole.DISCLOSURE_SPECIALIST || sessionRole === UserRole.QC
                ? 'h-[540px] overflow-y-auto pr-1'
                : undefined
            }
          />
        )}

        {!isDualDeskMode && sessionRole !== UserRole.VA && !showBuckets && (
          <PaginatedTaskList
            canDelete={canDelete}
            currentRole={sessionRole}
            currentUserId={sessionUser.id}
            jrAssigneeOptions={jrAssigneeOptions}
            initialFocusedTaskId={focusedTaskId}
            initialPage={flatListInitialPage ?? undefined}
            totalCount={scopedTaskCount}
          />
        )}
      </TasksRouteSyncGate>
    </DashboardShell>
  );

  endPerf({
    role: sessionRole,
    taskCount: scopedTaskCount,
  });
  return pageOutput;
}
