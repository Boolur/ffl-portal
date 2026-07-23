'use server';

import { prisma } from '@/lib/prisma';
import {
  DisclosureDecisionReason,
  NotificationOutboxEventType,
  NotificationOutboxStatus,
  Prisma,
  TaskKind,
  TaskPriority,
  TaskStatus,
  TaskWorkflowState,
  UserRole,
} from '@prisma/client';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { recordPerfMetric } from '@/lib/perf';
import { isAdmin, canAccessEmailSettings } from '@/lib/adminTiers';
import { canDeleteTask, canDeleteTasks } from '@/lib/taskPermissions';
import { appendLifecycleHistoryEvent } from '@/lib/taskLifecycleTimeline';
import { canLoanOfficerViewLoan } from '@/lib/loanOfficerVisibility';
import { PAYROLL_LENDER_OPTIONS } from '@/lib/payrollLenderOptions';
import {
  PROCESSING_ASSIGNMENT_THIRD_PARTY,
  PROCESSING_METHOD_IN_HOUSE,
  PROCESSING_METHOD_SELF_PROCESSED,
  PROCESSING_METHOD_THIRD_PARTY,
  getProcessingAssignmentLabel,
  getProcessingMethodLabel,
  isInHouseProcessingAssignmentGroup,
  isProcessingAssignmentGroup,
  isProcessingMethod,
} from '@/lib/processingRouting';
import {
  TASK_BUCKET_PAGE_SIZE,
  canUsePagedTaskBuckets,
  queryTaskBucketPage,
  queryTaskBucketCount,
  type TaskBucketCursor,
  type TaskBucketSort,
} from '@/lib/taskBucketQueries';

function isSubmissionTask(task: {
  kind: TaskKind | null;
  assignedRole: UserRole | null;
  title: string;
}) {
  return (
    task.kind === TaskKind.SUBMIT_DISCLOSURES ||
    task.kind === TaskKind.SUBMIT_QC ||
    task.kind === TaskKind.SUBMIT_PROCESSING ||
    (task.assignedRole === UserRole.DISCLOSURE_SPECIALIST &&
      task.title.toLowerCase().includes('disclosure')) ||
    (task.assignedRole === UserRole.QC && task.title.toLowerCase().includes('qc')) ||
    (task.assignedRole === UserRole.PROCESSOR_JR &&
      task.title.toLowerCase().includes('processing'))
  );
}

function normalizeSessionTaskRole(role?: string | null): UserRole | null {
  if (!role) return null;
  const normalized = role.trim().toUpperCase();
  return (Object.values(UserRole) as string[]).includes(normalized)
    ? (normalized as UserRole)
    : null;
}

function isDisclosureSubmissionTask(task: {
  kind: TaskKind | null;
  assignedRole: UserRole | null;
  title: string;
}) {
  return (
    task.kind === TaskKind.SUBMIT_DISCLOSURES ||
    (task.assignedRole === UserRole.DISCLOSURE_SPECIALIST &&
      task.title.toLowerCase().includes('disclosure'))
  );
}

function isQcSubmissionTask(task: {
  kind: TaskKind | null;
  assignedRole: UserRole | null;
  title: string;
}) {
  return (
    task.kind === TaskKind.SUBMIT_QC ||
    (task.assignedRole === UserRole.QC && task.title.toLowerCase().includes('qc'))
  );
}

function isProcessingSubmissionTask(task: {
  kind: TaskKind | null;
  assignedRole: UserRole | null;
  title: string;
}) {
  return (
    task.kind === TaskKind.SUBMIT_PROCESSING ||
    (task.assignedRole === UserRole.PROCESSOR_JR &&
      task.title.toLowerCase().includes('processing'))
  );
}

function isQcStyleSubmissionTask(task: {
  kind: TaskKind | null;
  assignedRole: UserRole | null;
  title: string;
}) {
  return isQcSubmissionTask(task) || isProcessingSubmissionTask(task);
}

const VA_TASK_BLUEPRINTS: Array<{
  kind: TaskKind;
  assignedRole: UserRole;
  title: string;
}> = [
  { kind: TaskKind.VA_TITLE, assignedRole: UserRole.VA_TITLE, title: 'VA: Title' },
  { kind: TaskKind.VA_HOI, assignedRole: UserRole.PROCESSOR_JR, title: 'HOI: Order Request' },
  { kind: TaskKind.VA_PAYOFF, assignedRole: UserRole.VA_PAYOFF, title: 'VA: Payoff' },
  { kind: TaskKind.VA_APPRAISAL, assignedRole: UserRole.VA_APPRAISAL, title: 'Appraisal Specialist' },
];

const QC_INVESTOR_ALLOWED_VALUES = new Set([
  'UWM',
  'KIND',
  'EPM',
  'SUN WEST',
  'AVEN',
  'BUTTON',
  'FREEDOM',
  'LOAN UNITED',
  'PENNYMAC',
  'FIGURE',
  'NFTY',
  'SPRING EQ',
  'OTHER',
]);

const QC_ONLY_INVESTORS = new Set(['FIGURE', 'NFTY', 'SPRING EQ']);
const QC_SKIP_TITLE_INVESTORS = new Set(['BUTTON']);

function isVaTaskKind(kind: TaskKind | null) {
  return (
    kind === TaskKind.VA_TITLE ||
    kind === TaskKind.VA_HOI ||
    kind === TaskKind.VA_PAYOFF ||
    kind === TaskKind.VA_APPRAISAL
  );
}

function getVaAssignedRoleForTask(task: {
  kind: TaskKind | null;
  assignedRole: UserRole | null;
}) {
  if (
    task.assignedRole === UserRole.VA_TITLE ||
    task.assignedRole === UserRole.VA_PAYOFF ||
    task.assignedRole === UserRole.VA_APPRAISAL ||
    task.assignedRole === UserRole.PROCESSOR_JR
  ) {
    return task.assignedRole;
  }
  const matched = VA_TASK_BLUEPRINTS.find((entry) => entry.kind === task.kind);
  return matched?.assignedRole || null;
}

const workflowStateEmailLabel: Record<TaskWorkflowState, string> = {
  [TaskWorkflowState.NONE]: 'None',
  [TaskWorkflowState.WAITING_ON_LO]: 'Waiting on LO',
  [TaskWorkflowState.WAITING_ON_LO_APPROVAL]: 'Waiting on LO Approval',
  [TaskWorkflowState.READY_TO_COMPLETE]: 'Returned to Disclosure',
};

const disclosureReasonEmailLabel: Record<DisclosureDecisionReason, string> = {
  [DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES]:
    'Approve Initial Disclosures',
  [DisclosureDecisionReason.MISSING_ITEMS]: 'Missing Items',
  [DisclosureDecisionReason.OTHER]: 'Other',
};

function getPortalBaseUrl() {
  const fromEnv = process.env.NEXTAUTH_URL?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv.replace(/\/$/, '') : 'http://localhost:3000';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildTaskNotificationHtml(input: {
  logoUrl: string;
  subject: string;
  eventLabel: string;
  deskLabel: string;
  deskTone: 'blue' | 'violet' | 'rose' | 'cyan';
  eventTone?: 'default' | 'danger';
  intro: string;
  ctaLabel: string;
  borrowerName: string;
  loanNumber: string;
  taskTitle: string;
  status: string;
  workflow: string;
  reason?: string | null;
  changedBy?: string | null;
  taskUrl: string;
}) {
  const palette =
    input.deskTone === 'violet'
      ? {
          headerGradient: 'linear-gradient(135deg,#f5f3ff,#eef2ff)',
          tagBg: '#ede9fe',
          tagText: '#6d28d9',
          buttonBg: '#7c3aed',
          buttonBorder: '#6d28d9',
          buttonGradient: 'linear-gradient(135deg,#8b5cf6,#7c3aed)',
          linkColor: '#7c3aed',
        }
      : input.deskTone === 'rose'
      ? {
          headerGradient: 'linear-gradient(135deg,#fff1f2,#ffe4e6)',
          tagBg: '#ffe4e6',
          tagText: '#be123c',
          buttonBg: '#e11d48',
          buttonBorder: '#be123c',
          buttonGradient: 'linear-gradient(135deg,#f43f5e,#e11d48)',
          linkColor: '#e11d48',
        }
      : input.deskTone === 'cyan'
      ? {
          headerGradient: 'linear-gradient(135deg,#ecfeff,#e0f2fe)',
          tagBg: '#cffafe',
          tagText: '#0e7490',
          buttonBg: '#0891b2',
          buttonBorder: '#0e7490',
          buttonGradient: 'linear-gradient(135deg,#06b6d4,#0891b2)',
          linkColor: '#0891b2',
        }
      : {
          headerGradient: 'linear-gradient(135deg,#eff6ff,#eef2ff)',
          tagBg: '#dbeafe',
          tagText: '#1d4ed8',
          buttonBg: '#1d4ed8',
          buttonBorder: '#1e40af',
          buttonGradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)',
          linkColor: '#2563eb',
        };
  const eventTagPalette =
    input.eventTone === 'danger'
      ? { bg: '#fee2e2', text: '#b91c1c' }
      : { bg: '#e2e8f0', text: '#334155' };
  const rows = [
    { label: 'Desk', value: input.deskLabel },
    { label: 'Update Type', value: input.eventLabel },
    { label: 'Borrower', value: input.borrowerName },
    { label: 'Loan Number', value: input.loanNumber },
    { label: 'Task', value: input.taskTitle },
    { label: 'Status', value: input.status },
    { label: 'Workflow', value: input.workflow },
    ...(input.reason ? [{ label: 'Reason', value: input.reason }] : []),
    ...(input.changedBy ? [{ label: 'Updated By', value: input.changedBy }] : []),
  ];

  const rowHtml = rows
    .map(
      (row) => `
        <tr>
          <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;width:160px;vertical-align:top;">${escapeHtml(
            row.label
          )}</td>
          <td style="padding:10px 0;color:#0f172a;font-size:14px;font-weight:600;">${escapeHtml(
            row.value
          )}</td>
        </tr>
      `
    )
    .join('');

  return `
  <div style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" style="max-width:680px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;background:${palette.headerGradient};">
          <table role="presentation" style="width:100%;">
            <tr>
              <td style="vertical-align:middle;">
                <img src="${escapeHtml(
                  input.logoUrl
                )}" alt="BISU Home Loans" width="180" style="display:block;width:180px;max-width:180px;height:auto;max-height:44px;object-fit:contain;" />
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:${palette.tagBg};color:${palette.tagText};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${escapeHtml(
                  input.deskLabel
                )}</span>
                <span style="display:inline-block;margin-left:8px;padding:6px 10px;border-radius:999px;background:${eventTagPalette.bg};color:${eventTagPalette.text};font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">${
                  input.eventTone === 'danger' ? 'Deleted' : 'Task Update'
                }</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 24px 12px;">
          <h1 style="margin:0 0 8px;font-size:22px;line-height:1.3;color:#0f172a;">${escapeHtml(
            input.subject
          )}</h1>
          <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">
            ${escapeHtml(input.intro)}
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:4px 24px 8px;">
          <table role="presentation" style="width:100%;border-collapse:collapse;">${rowHtml}</table>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 24px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
            <tr>
              <td bgcolor="${palette.buttonBg}" style="border-radius:12px;background:${palette.buttonBg};">
                <a
                  href="${escapeHtml(input.taskUrl)}"
                  style="display:inline-block;padding:14px 24px;border:1px solid ${palette.buttonBorder};border-radius:12px;background:${palette.buttonGradient};color:#ffffff;font-size:15px;line-height:1.2;font-weight:700;text-decoration:none;letter-spacing:0.01em;"
                >
                  ${escapeHtml(input.ctaLabel)}
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.5;">
            If the button above does not work, copy and paste this URL into your browser:<br />
            <a href="${escapeHtml(input.taskUrl)}" style="color:${palette.linkColor};text-decoration:none;">${escapeHtml(
    input.taskUrl
  )}</a>
          </p>
        </td>
      </tr>
    </table>
  </div>
  `;
}

type EmailAudience = 'LO' | 'DISCLOSURE' | 'QC' | 'VA' | 'JR';
type DeskType = 'DISCLOSURE' | 'QC' | 'VA' | 'JR';
type NotificationDeliveryMode = 'sync' | 'dual' | 'async';
const INLINE_OUTBOX_DRAIN_BATCH_SIZE = 3;

function getNotificationDeliveryMode(): NotificationDeliveryMode {
  const value = String(process.env.NOTIFICATION_DELIVERY_MODE || 'async')
    .trim()
    .toLowerCase();
  if (value === 'sync' || value === 'dual' || value === 'async') return value;
  return 'async';
}

async function kickInlineOutboxDrain(source: 'task-workflow' | 'va-fanout' | 'plus-one') {
  try {
    await drainNotificationOutboxBatch({ batchSize: INLINE_OUTBOX_DRAIN_BATCH_SIZE });
  } catch (error) {
    console.error(`[notifications.outbox] inline drain kick failed (${source})`, error);
  }
}

function getEffectiveReasonLabel(task: {
  workflowState: TaskWorkflowState;
  disclosureReason: DisclosureDecisionReason | null;
}) {
  if (task.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL) {
    return 'Approve Initial Figures';
  }
  if (task.workflowState === TaskWorkflowState.WAITING_ON_LO) {
    return 'Missing Items';
  }
  return task.disclosureReason
    ? disclosureReasonEmailLabel[task.disclosureReason]
    : null;
}

function getRoleSpecificEmailContent(input: {
  audience: EmailAudience;
  deskType: DeskType;
  eventLabel: string;
  borrowerName: string;
  loanNumber: string;
  taskTitle: string;
  status: TaskStatus;
  workflowLabel: string;
  reasonLabel: string | null;
  changedBy?: string | null;
}) {
  const deskLabel =
    input.deskType === 'QC'
      ? 'QC Desk'
      : input.deskType === 'JR'
      ? 'Jr Processing'
      : input.deskType === 'VA'
      ? 'VA Desk'
      : 'Disclosure Desk';
  const isQcTask = input.deskType === 'QC';
  const isVaTask = input.deskType === 'VA';
  const isJrTask = input.deskType === 'JR';
  const base = {
    eventLabel: input.eventLabel,
    intro:
      input.audience === 'LO'
        ? `A ${deskLabel} workflow update was posted in Federal First Lending Portal. Please review this task now.`
        : `A ${deskLabel} workflow update was posted in Federal First Lending Portal. Use the button below to review or track this task.`,
    ctaLabel:
      input.audience === 'LO' ? 'Open Task in Portal' : 'Track Task in Portal',
    statusLabel: input.status,
    workflowLabel: input.workflowLabel,
    reasonLabel: input.reasonLabel,
  };

  if (input.eventLabel === 'Sent to Loan Officer') {
    if (input.audience === 'LO') {
      const isApproval = input.reasonLabel === 'Approve Initial Figures';
      return {
        ...base,
        subject: `[FFL Portal] Action Required: ${input.borrowerName} (${input.loanNumber})`,
        eventLabel: isApproval
          ? 'Approve Initial Figures Required'
          : 'Missing Items Requested',
        intro: isApproval
          ? `${deskLabel} routed this file to you for approval of initial figures.`
          : `${deskLabel} routed this file to you for missing or corrected items.`,
        ctaLabel: isApproval
          ? 'Review & Approve Figures'
          : 'Review Missing Items',
        statusLabel: 'ACTION REQUIRED',
        workflowLabel: 'Waiting on LO',
      };
    }
    return {
      ...base,
      subject: `[FFL Portal] Waiting on LO: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'Waiting on LO',
      intro:
        'This request has been sent to the Loan Officer and is now waiting on LO response.',
      ctaLabel: 'Track Task in Portal',
      statusLabel: 'IN PROGRESS',
      workflowLabel: 'Waiting on LO',
    };
  }

  if (input.eventLabel === 'Loan Officer Responded') {
    if (input.audience === 'LO') {
      return {
        ...base,
        subject: `[FFL Portal] Response Sent: ${input.borrowerName} (${input.loanNumber})`,
        eventLabel: 'Response Sent to Disclosure',
        intro:
          'Your response was sent back to Disclosure. You can track progress from the task page.',
        statusLabel: 'SENT',
      };
    }
    return {
      ...base,
      subject: `[FFL Portal] Returned to ${isQcTask ? 'QC' : isJrTask ? 'Jr Processing' : isVaTask ? 'Appraisal VA' : 'Disclosure'}: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'LO Responded - Review Needed',
      intro:
        `Loan Officer response has been received. Review details and complete the next ${isQcTask ? 'QC' : isJrTask ? 'Jr Processing' : isVaTask ? 'appraisal VA' : 'disclosure'} action.`,
      ctaLabel: 'Review Response in Portal',
      statusLabel: 'REVIEW NEEDED',
      workflowLabel: isQcTask
        ? 'Returned to QC'
        : isJrTask
        ? 'LO Responded (Review)'
        : isVaTask
        ? 'LO Responded (Review)'
        : 'Returned to Disclosure',
    };
  }

  if (input.eventLabel === 'Loan Officer Approved Figures') {
    if (input.audience === 'LO') {
      return {
        ...base,
        subject: `[FFL Portal] Approval Submitted: ${input.borrowerName} (${input.loanNumber})`,
        eventLabel: 'Approval Sent to Disclosure',
        intro:
          'Your approval was submitted successfully. Disclosure Desk will complete the next step.',
        statusLabel: 'SENT',
      };
    }
    return {
      ...base,
      subject: `[FFL Portal] LO Approved Figures: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'LO Approved Initial Figures',
      intro:
        'Loan Officer approved the initial figures. Proceed with disclosure completion steps.',
      ctaLabel: 'Complete Disclosure Task',
      statusLabel: 'READY TO COMPLETE',
      workflowLabel: 'Returned to Disclosure',
      reasonLabel: 'Approve Initial Figures',
    };
  }

  if (input.eventLabel === 'Loan Officer Requested Revision') {
    if (input.audience === 'LO') {
      return {
        ...base,
        subject: `[FFL Portal] Revision Submitted: ${input.borrowerName} (${input.loanNumber})`,
        eventLabel: 'Revision Request Sent',
        intro:
          'Your revision request was sent back to Disclosure for updates.',
        statusLabel: 'SENT',
      };
    }
    return {
      ...base,
      subject: `[FFL Portal] LO Requested Revision: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'Revision Needed - Returned to Disclosure',
      intro:
        'Loan Officer requested revisions. Review the notes and prepare the next disclosure update.',
      ctaLabel: 'Review Revision Request',
      statusLabel: 'REVISION NEEDED',
      workflowLabel: 'Returned to Disclosure',
      reasonLabel: 'Missing Items',
    };
  }

  if (input.eventLabel === 'New Request Submitted') {
    if (input.audience === 'LO') {
      return {
        ...base,
        subject: `[FFL Portal] Request Submitted: ${input.borrowerName} (${input.loanNumber})`,
        eventLabel: 'Submission Received',
        intro:
          `Your new request has been submitted and is now queued with ${deskLabel}.`,
      };
    }
    return {
      ...base,
      subject: `[FFL Portal] New ${isQcTask ? 'QC' : isJrTask ? 'Processing' : isVaTask ? 'VA' : 'Disclosure'} Request: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'New Request Submitted',
      intro:
        `A new ${isQcTask ? 'QC' : isJrTask ? 'processing' : isVaTask ? 'VA' : 'disclosure'} request is in your queue. Review details and take action.`,
      ctaLabel: 'Open New Request',
      statusLabel: 'NEW',
      workflowLabel: isQcTask
        ? 'New QC Request'
        : isJrTask
        ? 'New Processing Request'
        : isVaTask
        ? 'New VA Request'
        : 'New Disclosure Request',
    };
  }

  if (input.eventLabel === 'Disclosure Request Started') {
    const starterName = input.changedBy?.trim() || 'Disclosure Desk';
    if (input.audience === 'LO') {
      return {
        ...base,
        subject: `[FFL Portal] ${starterName} started your disclosure request: ${input.borrowerName} (${input.loanNumber})`,
        eventLabel: 'Disclosure Request Started',
        intro: `${starterName} has started your disclosure request and is actively working this file.`,
        ctaLabel: 'Track Disclosure Request',
        statusLabel: 'IN PROGRESS',
        workflowLabel: 'New Disclosure Request',
      };
    }
    return {
      ...base,
      subject: `[FFL Portal] Request Started: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'Disclosure Request Started',
      intro: `${starterName} claimed this disclosure request and has started working it.`,
      ctaLabel: 'Track Task in Portal',
      statusLabel: 'IN PROGRESS',
      workflowLabel: 'New Disclosure Request',
    };
  }

  if (input.eventLabel === 'QC Request Started' || input.eventLabel === 'Processing Request Started') {
    const isProcessingStarted = input.eventLabel === 'Processing Request Started';
    const starterName = input.changedBy?.trim() || (isProcessingStarted ? 'Jr Processing' : 'QC Desk');
    if (input.audience === 'LO') {
      return {
        ...base,
        subject: `[FFL Portal] ${starterName} started your ${isProcessingStarted ? 'processing' : 'QC'} request: ${input.borrowerName} (${input.loanNumber})`,
        eventLabel: isProcessingStarted ? 'Processing Request Started' : 'QC Request Started',
        intro: `${starterName} has started your ${isProcessingStarted ? 'processing' : 'QC'} request and is actively working this file.`,
        ctaLabel: isProcessingStarted ? 'Track Processing Request' : 'Track QC Request',
        statusLabel: 'IN PROGRESS',
        workflowLabel: isProcessingStarted ? 'New Processing Request' : 'New QC Request',
      };
    }
    return {
      ...base,
      subject: `[FFL Portal] ${isProcessingStarted ? 'Processing' : 'QC'} Request Started: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: isProcessingStarted ? 'Processing Request Started' : 'QC Request Started',
      intro: `${starterName} claimed this ${isProcessingStarted ? 'processing' : 'QC'} request and has started working it.`,
      ctaLabel: 'Track Task in Portal',
      statusLabel: 'IN PROGRESS',
      workflowLabel: isProcessingStarted ? 'New Processing Request' : 'New QC Request',
    };
  }

  if (input.eventLabel === 'Request Deleted') {
    if (input.audience === 'LO') {
      return {
        ...base,
        subject: `[FFL Portal] Request Deleted: ${input.borrowerName} (${input.loanNumber})`,
        eventLabel: 'Request Deleted',
        intro: `${deskLabel} removed this request from the queue.`,
        ctaLabel: 'View Tasks',
        statusLabel: 'DELETED',
      };
    }
    return {
      ...base,
      subject: `[FFL Portal] ${deskLabel} Request Deleted: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'Request Deleted',
      intro: 'This request was deleted from the workflow queue.',
      ctaLabel: 'View Task Queue',
      statusLabel: 'DELETED',
      workflowLabel: isQcTask
        ? 'QC Queue'
        : isJrTask
        ? 'Jr Processing Queue'
        : isVaTask
        ? 'VA Queue'
        : 'Disclosure Queue',
    };
  }

  return {
    ...base,
    subject: `[FFL Portal] ${input.eventLabel}: ${input.borrowerName} (${input.loanNumber})`,
  };
}

async function createInAppNotificationsForAudience(input: {
  recipientEmails: string[];
  taskId: string;
  eventLabel: string;
  title: string;
  message: string;
  href: string;
}) {
  if (input.recipientEmails.length === 0) return;

  const recipientUsers = await prisma.user.findMany({
    where: {
      active: true,
      email: { in: input.recipientEmails },
    },
    select: { id: true },
  });

  if (recipientUsers.length === 0) return;

  await prisma.notification.createMany({
    data: recipientUsers.map((user) => ({
      userId: user.id,
      taskId: input.taskId,
      eventLabel: input.eventLabel,
      title: input.title,
      message: input.message,
      href: input.href,
    })),
  });
}

type VaCreatedTaskNotification = {
  id: string;
  kind: TaskKind;
  title: string;
  assignedRole: UserRole;
};

type TaskWorkflowNotificationPayload = {
  taskId: string;
  eventLabel: string;
  changedBy?: string | null;
};

type VaFanoutNotificationPayload = {
  loanId: string;
  createdTasks: VaCreatedTaskNotification[];
  changedBy?: string | null;
};

type PlusOneSubmittedNotificationPayload = {
  taskId: string;
  changedBy?: string | null;
};

function getExponentialBackoffMs(attempt: number) {
  const clampedAttempt = Math.max(1, Math.min(6, attempt));
  const baseMs = 15_000 * 2 ** (clampedAttempt - 1);
  return Math.min(baseMs, 20 * 60 * 1000);
}

async function enqueueNotificationOutboxEvent(input: {
  eventType: NotificationOutboxEventType;
  payload: Prisma.JsonObject;
  maxAttempts?: number;
  idempotencyKey?: string;
}) {
  try {
    await prisma.notificationOutbox.create({
      data: {
        eventType: input.eventType,
        payload: input.payload,
        idempotencyKey:
          input.idempotencyKey ||
          `${input.eventType}:${randomUUID()}`,
        maxAttempts: Math.max(1, Math.min(20, input.maxAttempts ?? 8)),
      },
    });
  } catch (error) {
    console.error('Failed to enqueue notification outbox event:', error);
    throw error;
  }
}

function asSubmissionObject(
  value: Prisma.JsonValue | null | undefined
): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

function valueText(value: unknown, fallback = 'Not provided') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function normalizeLenderNameForMatch(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function resolveLenderDisplayName(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return 'Not provided';
  const normalizedRaw = normalizeLenderNameForMatch(raw);
  const exactMatch = PAYROLL_LENDER_OPTIONS.find(
    (lender) => lender.trim().toLowerCase() === raw.toLowerCase()
  );
  if (exactMatch) return exactMatch;
  const normalizedMatch = PAYROLL_LENDER_OPTIONS.find(
    (lender) => normalizeLenderNameForMatch(lender) === normalizedRaw
  );
  return normalizedMatch || raw;
}

function isPayrollLenderSelection(value: unknown) {
  const normalizedRaw = normalizeLenderNameForMatch(value);
  return (
    normalizedRaw.length > 0 &&
    PAYROLL_LENDER_OPTIONS.some(
      (lender) => normalizeLenderNameForMatch(lender) === normalizedRaw
    )
  );
}

function formatCurrencyForEmail(value: unknown) {
  const raw = String(value ?? '').replace(/[$,\s]/g, '').trim();
  const amount = Number(raw);
  if (!Number.isFinite(amount)) return valueText(value);
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

async function getInlineBrandLogoAttachment() {
  try {
    const content = await readFile(`${process.cwd()}/public/logo.png`);
    return {
      logoUrl: 'cid:plus-one-brand-logo',
      inlineAttachments: [
        {
          name: 'bisu-home-loans-logo.png',
          contentType: 'image/png',
          contentBytes: content.toString('base64'),
          contentId: 'plus-one-brand-logo',
        },
      ],
    };
  } catch (error) {
    console.error('[email] Failed to load inline brand logo; falling back to logo URL.', error);
    const portalBaseUrl = getPortalBaseUrl();
    return {
      logoUrl: process.env.EMAIL_BRAND_LOGO_URL?.trim() || `${portalBaseUrl}/logo.png`,
      inlineAttachments: [],
    };
  }
}

function buildPlusOneShowcaseEmailHtml(input: {
  logoUrl: string;
  taskUrl: string;
  borrowerName: string;
  loanNumber: string;
  primaryLoanOfficerName: string;
  secondaryLoanOfficerName: string;
  loanAmount: string;
  projectedRevenue: string;
  lender: string;
  loanType: string;
  loanProgram: string;
  channel: string;
  leadSource: string;
  leadVendor?: string | null;
  nextMilestone: string;
  notes?: string | null;
}) {
  const metricCards = [
    { label: 'Loan Amount', value: input.loanAmount },
    { label: 'Projected Revenue', value: input.projectedRevenue },
    { label: 'Lender', value: input.lender },
  ];
  const metricHtml = metricCards
    .map(
      (card) => `
        <td width="33.333%" align="center" valign="middle" style="width:33.333%;padding:0 8px 12px;text-align:center;vertical-align:middle;">
          <table role="presentation" width="100%" height="138" align="center" style="width:100%;height:138px;border-collapse:separate;border-spacing:0;border:1px solid #93c5fd;background:#eff6ff;border-radius:18px;">
            <tr>
              <td height="138" align="center" valign="middle" style="height:138px;padding:0 14px;text-align:center;vertical-align:middle;">
                <center>
                  <div style="width:100%;margin:0 auto;text-align:center;color:#2f88c7;font-size:13px;line-height:1.25;font-weight:900;letter-spacing:.04em;text-transform:uppercase;">${escapeHtml(card.label)}</div>
                  <div style="width:100%;margin:10px auto 0;text-align:center;color:#165a93;font-size:30px;line-height:1.05;font-weight:950;">${escapeHtml(card.value)}</div>
                </center>
              </td>
            </tr>
          </table>
        </td>
      `
    )
    .join('');
  const secondaryName = input.secondaryLoanOfficerName.trim();
  const headlineLoanOfficerNames =
    secondaryName && secondaryName.toUpperCase() !== 'N/A'
      ? `${input.primaryLoanOfficerName} & ${secondaryName}`
      : input.primaryLoanOfficerName;

  return `
  <div style="margin:0;padding:28px;background:#eef7fd;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" style="max-width:760px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #bfdbfe;border-radius:24px;overflow:hidden;box-shadow:0 18px 50px rgba(47,136,199,.16);">
      <tr>
        <td style="padding:24px 28px;background:linear-gradient(135deg,#f8fbff,#e7f3fb 48%,#dbeafe);border-bottom:1px solid #bfdbfe;">
          <table role="presentation" style="width:100%;">
            <tr>
              <td style="vertical-align:middle;">
                <img src="${escapeHtml(input.logoUrl)}" alt="BISU Home Loans" width="210" style="display:block;width:210px;max-width:210px;height:auto;max-height:56px;border:0;outline:none;text-decoration:none;object-fit:contain;" />
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <span style="display:inline-block;padding:8px 12px;border-radius:999px;background:#10b981;color:#ffffff;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase;">New +1 Submitted</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:34px 28px 12px;text-align:center;">
          <p style="margin:0 0 10px;color:#2f88c7;font-size:13px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;">Production Spotlight</p>
          <h1 style="margin:0 auto 10px;max-width:620px;color:#1e5f97;font-size:32px;line-height:1.15;font-weight:950;">${escapeHtml(headlineLoanOfficerNames)} just submitted a new +1</h1>
          <p style="margin:0 auto;max-width:560px;color:#475569;font-size:15px;line-height:1.7;">
            The sales floor has a new file to celebrate. Here are the key details for ${escapeHtml(input.borrowerName)}.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 18px 28px;">
          <table role="presentation" align="center" style="width:100%;max-width:690px;margin:0 auto;border-collapse:separate;border-spacing:0;">
            <tr>${metricHtml}</tr>
          </table>
        </td>
      </tr>
    </table>
  </div>
  `;
}

async function sendPlusOneSubmittedNotifications(input: PlusOneSubmittedNotificationPayload) {
  const task = await prisma.task.findUnique({
    where: { id: input.taskId },
    select: {
      id: true,
      kind: true,
      submissionData: true,
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
          amount: true,
          loanOfficer: { select: { name: true } },
          secondaryLoanOfficer: { select: { name: true } },
        },
      },
    },
  });
  if (!task || task.kind !== TaskKind.SUBMIT_PLUS_ONE) return false;

  const data = asSubmissionObject(task.submissionData);
  const primaryLoanOfficerName = valueText(data.loanOfficer, task.loan.loanOfficer?.name || 'Loan Officer');
  const secondaryLoanOfficerName =
    valueText(data.secondaryLoanOfficerName, task.loan.secondaryLoanOfficer?.name || '') ||
    'N/A';
  const borrowerName = task.loan.borrowerName;
  const loanNumber = task.loan.loanNumber;
  const portalBaseUrl = getPortalBaseUrl();
  const brandLogo = await getInlineBrandLogoAttachment();
  const taskUrl = `${portalBaseUrl}/`;
  const leadSource = valueText(data.leadSource);
  const leadVendor = leadSource === 'Lead Buy' ? valueText(data.leadVendor, '') : '';

  const emailInput = {
    logoUrl: brandLogo.logoUrl,
    taskUrl,
    borrowerName,
    loanNumber,
    primaryLoanOfficerName,
    secondaryLoanOfficerName,
    loanAmount: formatCurrencyForEmail(data.loanAmount ?? task.loan.amount),
    projectedRevenue: formatCurrencyForEmail(data.projectedRevenue),
    lender: resolveLenderDisplayName(data.lender),
    loanType: valueText(data.loanType),
    loanProgram: valueText(data.loanProgram),
    channel: valueText(data.channel, 'Not specified'),
    leadSource,
    leadVendor,
    nextMilestone: valueText(data.nextMilestone),
    notes: String(data.notes ?? '').trim() || null,
  };
  const subject = `[BISU] New +1 Submitted: ${borrowerName} (${loanNumber})`;
  const html = buildPlusOneShowcaseEmailHtml(emailInput);
  const text = [
    'New +1 Submitted',
    `Primary Loan Officer: ${emailInput.primaryLoanOfficerName}`,
    `Secondary Loan Officer: ${emailInput.secondaryLoanOfficerName}`,
    `Borrower: ${borrowerName}`,
    `Loan Number: ${loanNumber}`,
    `Loan Amount: ${emailInput.loanAmount}`,
    `Projected Revenue: ${emailInput.projectedRevenue}`,
    `Lender: ${emailInput.lender}`,
    `Loan Type: ${emailInput.loanType}`,
    `Loan Program: ${emailInput.loanProgram}`,
    `Channel: ${emailInput.channel}`,
    `Lead Source: ${emailInput.leadSource}`,
    emailInput.leadVendor ? `Lead Vendor: ${emailInput.leadVendor}` : null,
    `Next Milestone: ${emailInput.nextMilestone}`,
    emailInput.notes ? `Notes: ${emailInput.notes}` : null,
    `View in Portal: ${taskUrl}`,
  ]
    .filter(Boolean)
    .join('\n');

  const recipients = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: { in: [UserRole.LOAN_OFFICER, UserRole.LOA, UserRole.MANAGER] } },
        { roles: { hasSome: [UserRole.LOAN_OFFICER, UserRole.LOA, UserRole.MANAGER] } },
      ],
    },
    select: { id: true, email: true },
  });
  const uniqueRecipients = Array.from(
    new Map(
      recipients
        .map((user) => ({ ...user, email: user.email.trim().toLowerCase() }))
        .filter((user) => user.email)
        .map((user) => [user.email, user])
    ).values()
  );
  if (uniqueRecipients.length === 0) return false;

  await prisma.notification.createMany({
    data: uniqueRecipients.map((user) => ({
      userId: user.id,
      taskId: task.id,
      eventLabel: 'Submit +1 Submitted',
      title: `New +1: ${borrowerName}`,
      message: `${primaryLoanOfficerName} submitted a +1 for ${borrowerName} (${loanNumber}).`,
      href: '/',
    })),
    skipDuplicates: true,
  });

  await sendEmail({
    to: uniqueRecipients.map((recipient) => recipient.email),
    subject,
    html,
    text,
    inlineAttachments: brandLogo.inlineAttachments,
    label: 'plus-one-submitted',
  });

  return true;
}

function hasRenderableSubmissionFields(data: Record<string, unknown>): boolean {
  return Object.entries(data).some(([key, value]) => {
    if (key === 'notesHistory') return false;
    return (
      value !== null &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    );
  });
}

function buildLoanSubmissionFallback(loan: {
  loanNumber: string;
  borrowerName: string;
  borrowerPhone: string | null;
  borrowerEmail: string | null;
  amount: Prisma.Decimal;
  propertyAddress: string | null;
}): Record<string, unknown> {
  const borrowerName = loan.borrowerName?.trim() || '';
  const [firstName, ...lastNameParts] = borrowerName.split(/\s+/).filter(Boolean);
  const lastName = lastNameParts.join(' ');
  return {
    arriveLoanNumber: loan.loanNumber,
    borrowerFirstName: firstName || borrowerName || 'Unknown',
    borrowerLastName: lastName || '',
    borrowerPhone: loan.borrowerPhone || '',
    borrowerEmail: loan.borrowerEmail || '',
    loanAmount: loan.amount?.toString?.() ?? '',
    ...(loan.propertyAddress ? { subjectPropertyAddress: loan.propertyAddress } : {}),
  };
}

function mergeSubmissionDataWithLoanFallback(
  source: Prisma.JsonValue | null | undefined,
  fallback: Record<string, unknown>
): Prisma.JsonObject {
  const sourceObject = asSubmissionObject(source);
  const merged: Record<string, unknown> = { ...fallback, ...sourceObject };
  if (!hasRenderableSubmissionFields(merged)) {
    return fallback as Prisma.JsonObject;
  }
  return merged as Prisma.JsonObject;
}

function stripDeskHistoryFromSubmissionData(
  source: Prisma.JsonObject
): Prisma.JsonObject {
  const next = { ...source } as Record<string, unknown>;
  // Downstream VA/JR tasks should not inherit upstream desk actors.
  delete next.notesHistory;
  delete next.lifecycleHistory;
  return next as Prisma.JsonObject;
}

async function ensureVaTasksForLoanFromQcCompletion(loanId: string, qcTaskId?: string) {
  const createdKinds = await prisma.$transaction(async (tx) => {
    const loanSnapshot = await tx.loan.findUnique({
      where: { id: loanId },
      select: {
        loanNumber: true,
        borrowerName: true,
        borrowerPhone: true,
        borrowerEmail: true,
        amount: true,
        propertyAddress: true,
      },
    });
    if (!loanSnapshot) {
      return [] as TaskKind[];
    }
    const loanFallbackSubmissionData = buildLoanSubmissionFallback(loanSnapshot);

    const sourceQcSubmission = qcTaskId
      ? await tx.task.findUnique({
          where: { id: qcTaskId },
          select: { submissionData: true, kind: true, assignedRole: true, title: true },
        })
      : await tx.task.findFirst({
          where: {
            loanId,
            OR: [
              { kind: TaskKind.SUBMIT_QC },
              { assignedRole: UserRole.QC, title: { contains: 'qc', mode: 'insensitive' } },
            ],
          },
          select: {
            submissionData: true,
            kind: true,
            assignedRole: true,
            title: true,
          },
          orderBy: {
            updatedAt: 'desc',
          },
        });
    const sourceIsQcSubmissionTask = sourceQcSubmission
      ? isQcSubmissionTask({
          kind: sourceQcSubmission.kind,
          assignedRole: sourceQcSubmission.assignedRole,
          title: sourceQcSubmission.title || '',
        })
      : false;
    // Safety rail: VA fanout is only allowed from QC submission tasks (including legacy QC rows).
    if (!sourceQcSubmission || !sourceIsQcSubmissionTask) {
      return [] as TaskKind[];
    }
    const qcSubmissionDataRaw = mergeSubmissionDataWithLoanFallback(
      sourceQcSubmission?.submissionData,
      loanFallbackSubmissionData
    );
    const qcSubmissionData = stripDeskHistoryFromSubmissionData(qcSubmissionDataRaw);

    const qcInvestorValue = String(
      (qcSubmissionData as Record<string, unknown>)?.investor ?? ''
    )
      .trim()
      .toUpperCase();
    if (QC_ONLY_INVESTORS.has(qcInvestorValue)) {
      return [] as TaskKind[];
    }
    const vaTaskBlueprintsForInvestor = QC_SKIP_TITLE_INVESTORS.has(qcInvestorValue)
      ? VA_TASK_BLUEPRINTS.filter((blueprint) => blueprint.kind !== TaskKind.VA_TITLE)
      : VA_TASK_BLUEPRINTS;

    const existingKinds = await tx.task.findMany({
      where: { loanId },
      select: { kind: true, assignedRole: true },
    });

    const has = (kind: TaskKind, assignedRole: UserRole) =>
      existingKinds.some((task) => task.kind === kind || task.assignedRole === assignedRole);

    const toCreate = vaTaskBlueprintsForInvestor.filter(
      (blueprint) => !has(blueprint.kind, blueprint.assignedRole)
    );

    if (toCreate.length > 0) {
      await tx.task.createMany({
        data: toCreate.map((task) => ({
          loanId,
          title: task.title,
          kind: task.kind,
          status: TaskStatus.PENDING,
          priority: TaskPriority.NORMAL,
          assignedRole: task.assignedRole,
          submissionData: qcSubmissionData,
          dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
        })),
      });
    }

    const vaKinds = new Set(vaTaskBlueprintsForInvestor.map((entry) => entry.kind));
    const existingVaTasks = await tx.task.findMany({
      where: {
        loanId,
        kind: { in: Array.from(vaKinds) },
      },
      select: {
        id: true,
        submissionData: true,
      },
    });
    for (const vaTask of existingVaTasks) {
      const dataObj = asSubmissionObject(vaTask.submissionData);
      const hasDetails = hasRenderableSubmissionFields(dataObj);
      if (hasDetails) continue;
      await tx.task.update({
        where: { id: vaTask.id },
        data: { submissionData: qcSubmissionData },
      });
    }

    await tx.loan.update({
      where: { id: loanId },
      data: { stage: 'SUBMIT_TO_UW_PREP' },
    });

    return toCreate.map((task) => task.kind);
  });

  if (createdKinds.length === 0) return [] as VaCreatedTaskNotification[];

  const createdTasks = await prisma.task.findMany({
    where: {
      loanId,
      kind: { in: createdKinds },
    },
    select: {
      id: true,
      kind: true,
      title: true,
      assignedRole: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const pickedByKind = new Map<TaskKind, VaCreatedTaskNotification>();
  for (const task of createdTasks) {
    if (!task.kind || !task.assignedRole) continue;
    if (!createdKinds.includes(task.kind)) continue;
    if (!pickedByKind.has(task.kind)) {
      pickedByKind.set(task.kind, {
        id: task.id,
        kind: task.kind,
        title: task.title,
        assignedRole: task.assignedRole,
      });
    }
  }

  return createdKinds
    .map((kind) => pickedByKind.get(kind))
    .filter((task): task is VaCreatedTaskNotification => Boolean(task));
}

async function sendVaFanoutNotifications(input: {
  loanId: string;
  createdTasks: VaCreatedTaskNotification[];
  changedBy?: string | null;
}) {
  if (input.createdTasks.length === 0) return;

  const [loan, managerUsers] = await Promise.all([
    prisma.loan.findUnique({
      where: { id: input.loanId },
      select: { borrowerName: true, loanNumber: true },
    }),
    prisma.user.findMany({
      where: {
        active: true,
        OR: [{ role: UserRole.MANAGER }, { roles: { has: UserRole.MANAGER } }],
      },
      select: { email: true },
    }),
  ]);
  if (!loan) return;

  const rolesToNotify = Array.from(
    new Set(input.createdTasks.map((task) => task.assignedRole))
  );
  const vaUsers = await prisma.user.findMany({
    where: {
      active: true,
      OR: rolesToNotify.flatMap((role) => [{ role }, { roles: { has: role } }]),
    },
    select: { email: true, role: true, roles: true },
  });

  const recipientsByRole = new Map<UserRole, string[]>();
  for (const role of rolesToNotify) {
    const recipients = vaUsers
      .filter((user) => user.role === role || user.roles.includes(role))
      .map((user) => user.email.trim().toLowerCase())
      .filter(Boolean);
    recipientsByRole.set(role, Array.from(new Set(recipients)));
  }

  const portalBaseUrl = getPortalBaseUrl();
  const logoUrl =
    process.env.EMAIL_BRAND_LOGO_URL?.trim() || `${portalBaseUrl}/logo.png`;

  for (const task of input.createdTasks) {
    const recipients = recipientsByRole.get(task.assignedRole) || [];
    if (recipients.length === 0) continue;
    const taskUrl = `${portalBaseUrl}/tasks?taskId=${encodeURIComponent(task.id)}`;
    const subject = `[FFL Portal] New ${task.title} Request: ${loan.borrowerName} (${loan.loanNumber})`;
    const intro = `${input.changedBy?.trim() || 'QC Desk'} completed QC and created this ${task.title} request for your queue.`;
    const isJrTask = task.assignedRole === UserRole.PROCESSOR_JR;
    const deskLabel = isJrTask ? 'JR Processor' : 'VA Desk';
    const deskTone = isJrTask ? 'cyan' : 'rose';
    const openLabel = isJrTask ? 'Open JR Processor Request' : 'Open VA Request';
    const workflowLabel = isJrTask ? 'New JR Processor Request' : 'New VA Request';

    await createInAppNotificationsForAudience({
      recipientEmails: recipients,
      taskId: task.id,
      eventLabel: 'New VA Request Submitted',
      title: subject.replace(/^\[FFL Portal\]\s*/i, ''),
      message: `${loan.borrowerName} (${loan.loanNumber}) - ${intro}`,
      href: `/tasks?taskId=${encodeURIComponent(task.id)}`,
    });

    const html = buildTaskNotificationHtml({
      logoUrl,
      subject,
      eventLabel: 'New VA Request Submitted',
      deskLabel,
      deskTone,
      intro,
      ctaLabel: openLabel,
      borrowerName: loan.borrowerName,
      loanNumber: loan.loanNumber,
      taskTitle: task.title,
      status: 'NEW',
      workflow: workflowLabel,
      reason: null,
      changedBy: input.changedBy || null,
      taskUrl,
    });
    const text = [
      `Desk: ${deskLabel}`,
      'Event: New VA Request Submitted',
      `Borrower: ${loan.borrowerName}`,
      `Loan Number: ${loan.loanNumber}`,
      `Task: ${task.title}`,
      'Status: NEW',
      `Workflow: ${workflowLabel}`,
      input.changedBy ? `Changed By: ${input.changedBy}` : null,
      `Open Task: ${taskUrl}`,
    ]
      .filter(Boolean)
      .join('\n');

    await Promise.allSettled(
      recipients.map((to) =>
        sendEmail({
          to,
          subject,
          html,
          text,
        })
      )
    );
  }

  const managerRecipients = Array.from(
    new Set(
      managerUsers
        .map((user) => user.email.trim().toLowerCase())
        .filter(Boolean)
    )
  );
  if (managerRecipients.length === 0) return;

  const tasksSummary = input.createdTasks.map((task) => `- ${task.title}`).join('\n');
  const managerTaskUrl = `${portalBaseUrl}/tasks`;
  const managerSubject = `[FFL Portal] VA Task Set Created from QC: ${loan.borrowerName} (${loan.loanNumber})`;
  const managerText = [
    'Desk: VA Desk',
    'Event: New VA Task Set Created',
    `Borrower: ${loan.borrowerName}`,
    `Loan Number: ${loan.loanNumber}`,
    'Created Tasks:',
    tasksSummary,
    input.changedBy ? `Changed By: ${input.changedBy}` : null,
    `Open Tasks: ${managerTaskUrl}`,
  ]
    .filter(Boolean)
    .join('\n');
  const managerHtml = `
  <div style="margin:0;padding:24px;background:#fff7f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" style="max-width:680px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #fbcfe8;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #fbcfe8;background:linear-gradient(135deg,#fff1f2,#ffe4e6);">
          <h2 style="margin:0;font-size:20px;color:#9f1239;">${escapeHtml(managerSubject)}</h2>
        </td>
      </tr>
      <tr>
        <td style="padding:20px 24px;">
          <p style="margin:0 0 10px;font-size:14px;color:#334155;">
            ${escapeHtml(input.changedBy?.trim() || 'QC Desk')} completed QC and created these VA tasks:
          </p>
          <ul style="margin:0 0 14px 20px;padding:0;color:#0f172a;font-size:14px;line-height:1.6;">
            ${input.createdTasks
              .map((task) => `<li>${escapeHtml(task.title)}</li>`)
              .join('')}
          </ul>
          <p style="margin:0;font-size:13px;color:#64748b;">
            Borrower: <strong>${escapeHtml(loan.borrowerName)}</strong><br/>
            Loan Number: <strong>${escapeHtml(loan.loanNumber)}</strong>
          </p>
          <p style="margin:14px 0 0;">
            <a href="${escapeHtml(managerTaskUrl)}" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#e11d48;color:#fff;text-decoration:none;font-weight:700;">Open Tasks</a>
          </p>
        </td>
      </tr>
    </table>
  </div>
  `;

  await createInAppNotificationsForAudience({
    recipientEmails: managerRecipients,
    taskId: input.createdTasks[0].id,
    eventLabel: 'New VA Task Set Created',
    title: managerSubject.replace(/^\[FFL Portal\]\s*/i, ''),
    message: `${loan.borrowerName} (${loan.loanNumber}) - ${input.createdTasks.length} VA tasks were created from QC completion.`,
    href: '/tasks',
  });

  await Promise.allSettled(
    managerRecipients.map((to) =>
      sendEmail({
        to,
        subject: managerSubject,
        html: managerHtml,
        text: managerText,
      })
    )
  );
}

async function sendTaskWorkflowNotificationsByTaskId(input: {
  taskId: string;
  eventLabel: string;
  changedBy?: string | null;
}) {
  try {
    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        kind: true,
        assignedRole: true,
        title: true,
        status: true,
        workflowState: true,
        disclosureReason: true,
        loanId: true,
        submissionData: true,
      },
    });
    if (!task) return false;

    const vaRole = getVaAssignedRoleForTask(task);
    const processingSubmissionTask = isProcessingSubmissionTask(task);
    const isJrDeskTask = task.kind === TaskKind.VA_HOI || vaRole === UserRole.PROCESSOR_JR;
    const deskType: DeskType = processingSubmissionTask
      ? 'JR'
      : isVaTaskKind(task.kind)
      ? isJrDeskTask
        ? 'JR'
        : 'VA'
      : isQcSubmissionTask(task)
      ? 'QC'
      : 'DISCLOSURE';
    const isQcTask = deskType === 'QC';
    const deskLabel =
      isQcTask
        ? 'QC Desk'
        : deskType === 'JR'
        ? 'Jr Processing'
        : deskType === 'VA'
        ? 'VA Desk'
        : 'Disclosure Desk';
    const teamRole =
      deskType === 'QC'
        ? UserRole.QC
        : deskType === 'JR'
        ? UserRole.PROCESSOR_JR
        : deskType === 'VA'
        ? vaRole
        : UserRole.DISCLOSURE_SPECIALIST;
    if ((deskType === 'VA' || deskType === 'JR') && !teamRole) return false;
    const teamAudience: EmailAudience =
      deskType === 'QC'
        ? 'QC'
        : deskType === 'JR'
        ? 'JR'
        : deskType === 'VA'
        ? 'VA'
        : 'DISCLOSURE';

    const [loan, teamUsers, managerUsers] = await Promise.all([
      prisma.loan.findUnique({
        where: { id: task.loanId },
        select: {
          loanNumber: true,
          borrowerName: true,
          loanOfficer: {
            select: { email: true, name: true, active: true },
          },
          secondaryLoanOfficer: {
            select: { email: true, name: true, active: true },
          },
          visibilitySubmitterUser: {
            select: { email: true, name: true, active: true },
          },
        },
      }),
      prisma.user.findMany({
        where: {
          active: true,
          OR: [{ role: teamRole! }, { roles: { has: teamRole! } }],
        },
        select: { email: true },
      }),
      prisma.user.findMany({
        where: {
          active: true,
          OR: [{ role: UserRole.MANAGER }, { roles: { has: UserRole.MANAGER } }],
        },
        select: { email: true },
      }),
    ]);

    if (!loan) return false;

    const teamRecipientSet = new Set<string>();
    for (const user of teamUsers) {
      if (user.email?.trim()) {
        teamRecipientSet.add(user.email.trim().toLowerCase());
      }
    }
    for (const manager of managerUsers) {
      if (manager.email?.trim()) {
        teamRecipientSet.add(manager.email.trim().toLowerCase());
      }
    }
    const loanOfficerEmail =
      loan.loanOfficer?.active && loan.loanOfficer.email?.trim()
        ? loan.loanOfficer.email.trim().toLowerCase()
        : null;
    const secondaryLoanOfficerEmail =
      loan.secondaryLoanOfficer?.active && loan.secondaryLoanOfficer.email?.trim()
        ? loan.secondaryLoanOfficer.email.trim().toLowerCase()
        : null;
    const visibilitySubmitterEmail =
      loan.visibilitySubmitterUser?.active && loan.visibilitySubmitterUser.email?.trim()
        ? loan.visibilitySubmitterUser.email.trim().toLowerCase()
        : null;
    const submissionDataObj =
      task.submissionData && typeof task.submissionData === 'object' && !Array.isArray(task.submissionData)
        ? (task.submissionData as Record<string, unknown>)
        : null;
    const loaSubmitterEmailRaw = submissionDataObj?.loaSubmitterEmail;
    const loaSubmitterEmail =
      typeof loaSubmitterEmailRaw === 'string' && loaSubmitterEmailRaw.trim()
        ? loaSubmitterEmailRaw.trim().toLowerCase()
        : null;
    const observerRecipientSet = new Set<string>();
    if (loanOfficerEmail && !teamRecipientSet.has(loanOfficerEmail)) {
      observerRecipientSet.add(loanOfficerEmail);
    }
    if (secondaryLoanOfficerEmail && !teamRecipientSet.has(secondaryLoanOfficerEmail)) {
      observerRecipientSet.add(secondaryLoanOfficerEmail);
    }
    if (visibilitySubmitterEmail && !teamRecipientSet.has(visibilitySubmitterEmail)) {
      observerRecipientSet.add(visibilitySubmitterEmail);
    }
    if (loaSubmitterEmail && !teamRecipientSet.has(loaSubmitterEmail)) {
      observerRecipientSet.add(loaSubmitterEmail);
    }
    if (teamRecipientSet.size === 0 && observerRecipientSet.size === 0) return false;

    const portalBaseUrl = getPortalBaseUrl();
    const taskUrl = `${portalBaseUrl}/tasks?taskId=${encodeURIComponent(task.id)}`;
    const logoUrl =
      process.env.EMAIL_BRAND_LOGO_URL?.trim() || `${portalBaseUrl}/logo.png`;
    const workflowLabel = workflowStateEmailLabel[task.workflowState];
    const reasonLabel = getEffectiveReasonLabel(task);

    const sendByAudience = async (audience: EmailAudience, recipients: string[]) => {
      if (recipients.length === 0) return;
      const normalizedRecipients = Array.from(
        new Set(
          recipients
            .map((entry) => entry.trim().toLowerCase())
            .filter(Boolean)
        )
      );
      if (normalizedRecipients.length === 0) return;

      const copy = getRoleSpecificEmailContent({
        audience,
        deskType,
        eventLabel: input.eventLabel,
        borrowerName: loan.borrowerName,
        loanNumber: loan.loanNumber,
        taskTitle: task.title,
        status: task.status,
        workflowLabel,
        reasonLabel,
        changedBy: input.changedBy,
      });

      try {
        await createInAppNotificationsForAudience({
          recipientEmails: normalizedRecipients,
          taskId: task.id,
          eventLabel: copy.eventLabel,
          title: copy.subject.replace(/^\[FFL Portal\]\s*/i, ''),
          message: `${loan.borrowerName} (${loan.loanNumber}) - ${copy.intro}`,
          href: `/tasks?taskId=${encodeURIComponent(task.id)}`,
        });
      } catch (error) {
        // Keep email delivery resilient even if in-app notifications fail.
        console.error('Failed to create in-app task notifications:', error);
      }

      const bodyLines = [
        `Desk: ${deskLabel}`,
        `Event: ${copy.eventLabel}`,
        `Borrower: ${loan.borrowerName}`,
        `Loan Number: ${loan.loanNumber}`,
        `Task: ${task.title}`,
        `Status: ${copy.statusLabel}`,
        `Workflow: ${copy.workflowLabel}`,
        copy.reasonLabel ? `Reason: ${copy.reasonLabel}` : 'Reason: Not specified',
        input.changedBy ? `Changed By: ${input.changedBy}` : null,
        `Open Task: ${taskUrl}`,
      ].filter(Boolean) as string[];

      const html = buildTaskNotificationHtml({
        logoUrl,
        subject: copy.subject,
        eventLabel: copy.eventLabel,
        deskLabel,
        deskTone: isQcTask ? 'violet' : deskType === 'JR' ? 'cyan' : deskType === 'VA' ? 'rose' : 'blue',
        eventTone: input.eventLabel === 'Request Deleted' ? 'danger' : 'default',
        intro: copy.intro,
        ctaLabel: copy.ctaLabel,
        borrowerName: loan.borrowerName,
        loanNumber: loan.loanNumber,
        taskTitle: task.title,
        status: String(copy.statusLabel),
        workflow: copy.workflowLabel,
        reason: copy.reasonLabel,
        changedBy: input.changedBy || null,
        taskUrl,
      });

      await Promise.allSettled(
        normalizedRecipients.map((to) =>
          sendEmail({
            to,
            subject: copy.subject,
            html,
            text: bodyLines.join('\n'),
          })
        )
      );
    };

    await sendByAudience(
      teamAudience,
      Array.from(teamRecipientSet)
    );
    if (observerRecipientSet.size > 0) {
      await sendByAudience('LO', Array.from(observerRecipientSet));
    }
    return true;
  } catch (error) {
    console.error('Failed to send task workflow notifications:', error);
    return false;
  }
}

async function dispatchTaskWorkflowNotification(input: TaskWorkflowNotificationPayload) {
  try {
    const mode = getNotificationDeliveryMode();
    const payload: Prisma.JsonObject = {
      taskId: input.taskId,
      eventLabel: input.eventLabel,
      changedBy: input.changedBy ?? null,
    };
    const enqueue = async () =>
      enqueueNotificationOutboxEvent({
        eventType: NotificationOutboxEventType.TASK_WORKFLOW,
        payload,
        idempotencyKey: `task-workflow:${input.taskId}:${input.eventLabel}:${Date.now()}:${randomUUID()}`,
      });

    if (mode === 'sync') {
      await sendTaskWorkflowNotificationsByTaskId(input);
      return;
    }
    try {
      await enqueue();
    } catch (error) {
      // Fail open for core workflows: if outbox is unavailable, preserve user action
      // and send via the legacy synchronous path.
      console.error(
        '[notifications.outbox] enqueue failed for task workflow; falling back to synchronous send',
        error
      );
      await sendTaskWorkflowNotificationsByTaskId(input);
      return;
    }
    if (mode === 'dual') {
      await sendTaskWorkflowNotificationsByTaskId(input);
      return;
    }
    await kickInlineOutboxDrain('task-workflow');
  } catch (error) {
    // Never fail user workflows due to notification subsystem issues.
    console.error(
      '[notifications.outbox] task workflow dispatch failed; continuing without blocking workflow',
      error
    );
  }
}

async function dispatchVaFanoutNotifications(input: VaFanoutNotificationPayload) {
  if (!input.createdTasks.length) return;
  const mode = getNotificationDeliveryMode();
  const payload: Prisma.JsonObject = {
    loanId: input.loanId,
    changedBy: input.changedBy ?? null,
    createdTasks: input.createdTasks as unknown as Prisma.JsonArray,
  };
  const enqueue = async () =>
    enqueueNotificationOutboxEvent({
      eventType: NotificationOutboxEventType.VA_FANOUT,
      payload,
      idempotencyKey: `va-fanout:${input.loanId}:${Date.now()}:${randomUUID()}`,
    });

  if (mode === 'sync') {
    await sendVaFanoutNotifications(input);
    return;
  }
  try {
    await enqueue();
  } catch (error) {
    // Fail open for QC completion fanout: if outbox write fails, keep workflow intact.
    console.error(
      '[notifications.outbox] enqueue failed for VA fanout; falling back to synchronous send',
      error
    );
    await sendVaFanoutNotifications(input);
    return;
  }
  if (mode === 'dual') {
    await sendVaFanoutNotifications(input);
    return;
  }
  await kickInlineOutboxDrain('va-fanout');
}

async function dispatchPlusOneSubmittedNotification(input: PlusOneSubmittedNotificationPayload) {
  try {
    const mode = getNotificationDeliveryMode();
    const payload: Prisma.JsonObject = {
      taskId: input.taskId,
      changedBy: input.changedBy ?? null,
    };
    const enqueue = async () =>
      enqueueNotificationOutboxEvent({
        eventType: NotificationOutboxEventType.PLUS_ONE_SUBMITTED,
        payload,
        idempotencyKey: `plus-one:${input.taskId}:${Date.now()}:${randomUUID()}`,
      });

    if (mode === 'sync') {
      await sendPlusOneSubmittedNotifications(input);
      return;
    }
    try {
      await enqueue();
    } catch (error) {
      console.error(
        '[notifications.outbox] enqueue failed for +1; falling back to synchronous send',
        error
      );
      await sendPlusOneSubmittedNotifications(input);
      return;
    }
    if (mode === 'dual') {
      await sendPlusOneSubmittedNotifications(input);
      return;
    }
    await kickInlineOutboxDrain('plus-one');
  } catch (error) {
    console.error(
      '[notifications.outbox] +1 dispatch failed; continuing without blocking submission',
      error
    );
  }
}

type DrainNotificationOutboxResult = {
  processed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseTaskWorkflowPayload(payload: Prisma.JsonValue): TaskWorkflowNotificationPayload | null {
  if (!isRecord(payload)) return null;
  const taskId = String(payload.taskId ?? '').trim();
  const eventLabel = String(payload.eventLabel ?? '').trim();
  const changedByRaw = payload.changedBy;
  const changedBy =
    typeof changedByRaw === 'string' && changedByRaw.trim().length > 0
      ? changedByRaw.trim()
      : null;
  if (!taskId || !eventLabel) return null;
  return { taskId, eventLabel, changedBy };
}

function parseVaFanoutPayload(payload: Prisma.JsonValue): VaFanoutNotificationPayload | null {
  if (!isRecord(payload)) return null;
  const loanId = String(payload.loanId ?? '').trim();
  const changedByRaw = payload.changedBy;
  const changedBy =
    typeof changedByRaw === 'string' && changedByRaw.trim().length > 0
      ? changedByRaw.trim()
      : null;
  if (!loanId) return null;
  const rawCreatedTasks = Array.isArray(payload.createdTasks) ? payload.createdTasks : [];
  const createdTasks: VaCreatedTaskNotification[] = [];
  for (const row of rawCreatedTasks) {
    if (!isRecord(row)) continue;
    const id = String(row.id ?? '').trim();
    const kindRaw = String(row.kind ?? '').trim();
    const title = String(row.title ?? '').trim();
    const assignedRoleRaw = String(row.assignedRole ?? '').trim();
    if (!id || !kindRaw || !title || !assignedRoleRaw) continue;
    const kind = (Object.values(TaskKind) as string[]).includes(kindRaw)
      ? (kindRaw as TaskKind)
      : null;
    const assignedRole = (Object.values(UserRole) as string[]).includes(assignedRoleRaw)
      ? (assignedRoleRaw as UserRole)
      : null;
    if (!kind || !assignedRole) continue;
    createdTasks.push({ id, kind, title, assignedRole });
  }
  if (!createdTasks.length) return null;
  return { loanId, changedBy, createdTasks };
}

function parsePlusOneSubmittedPayload(
  payload: Prisma.JsonValue
): PlusOneSubmittedNotificationPayload | null {
  if (!isRecord(payload)) return null;
  const taskId = String(payload.taskId ?? '').trim();
  const changedByRaw = payload.changedBy;
  const changedBy =
    typeof changedByRaw === 'string' && changedByRaw.trim().length > 0
      ? changedByRaw.trim()
      : null;
  if (!taskId) return null;
  return { taskId, changedBy };
}

async function processNotificationOutboxJob(job: {
  id: string;
  eventType: NotificationOutboxEventType;
  payload: Prisma.JsonValue;
  attempts: number;
  maxAttempts: number;
}) {
  let delivered = false;
  if (job.eventType === NotificationOutboxEventType.TASK_WORKFLOW) {
    const parsed = parseTaskWorkflowPayload(job.payload);
    if (!parsed) {
      throw new Error('Invalid TASK_WORKFLOW payload.');
    }
    delivered = await sendTaskWorkflowNotificationsByTaskId(parsed);
  } else if (job.eventType === NotificationOutboxEventType.VA_FANOUT) {
    const parsed = parseVaFanoutPayload(job.payload);
    if (!parsed) {
      throw new Error('Invalid VA_FANOUT payload.');
    }
    await sendVaFanoutNotifications(parsed);
    delivered = true;
  } else if (job.eventType === NotificationOutboxEventType.PLUS_ONE_SUBMITTED) {
    const parsed = parsePlusOneSubmittedPayload(job.payload);
    if (!parsed) {
      throw new Error('Invalid PLUS_ONE_SUBMITTED payload.');
    }
    delivered = await sendPlusOneSubmittedNotifications(parsed);
  }

  if (!delivered) {
    throw new Error('Notification delivery returned unsuccessful result.');
  }
}

export async function drainNotificationOutboxBatch(input?: { batchSize?: number }) {
  const startedAt = Date.now();
  const batchSize = Math.max(1, Math.min(50, Math.floor(input?.batchSize ?? 20)));
  const now = new Date();
  const result: DrainNotificationOutboxResult = {
    processed: 0,
    sent: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };

  const candidates = await prisma.notificationOutbox.findMany({
    where: {
      status: { in: [NotificationOutboxStatus.PENDING, NotificationOutboxStatus.RETRY] },
      nextAttemptAt: { lte: now },
    },
    orderBy: [{ nextAttemptAt: 'asc' }, { createdAt: 'asc' }],
    take: batchSize,
    select: {
      id: true,
    },
  });

  for (const candidate of candidates) {
    const claim = await prisma.notificationOutbox.updateMany({
      where: {
        id: candidate.id,
        status: { in: [NotificationOutboxStatus.PENDING, NotificationOutboxStatus.RETRY] },
      },
      data: {
        status: NotificationOutboxStatus.PROCESSING,
        processingStartedAt: new Date(),
      },
    });
    if (claim.count === 0) {
      result.skipped += 1;
      continue;
    }

    const job = await prisma.notificationOutbox.findUnique({
      where: { id: candidate.id },
      select: {
        id: true,
        eventType: true,
        payload: true,
        attempts: true,
        maxAttempts: true,
      },
    });
    if (!job) {
      result.skipped += 1;
      continue;
    }

    result.processed += 1;
    try {
      await processNotificationOutboxJob(job);
      await prisma.notificationOutbox.update({
        where: { id: job.id },
        data: {
          status: NotificationOutboxStatus.SENT,
          sentAt: new Date(),
          lastError: null,
          processingStartedAt: null,
          attempts: { increment: 1 },
        },
      });
      result.sent += 1;
    } catch (error) {
      const nextAttemptCount = job.attempts + 1;
      const exhausted = nextAttemptCount >= job.maxAttempts;
      await prisma.notificationOutbox.update({
        where: { id: job.id },
        data: {
          status: exhausted ? NotificationOutboxStatus.FAILED : NotificationOutboxStatus.RETRY,
          attempts: nextAttemptCount,
          nextAttemptAt: exhausted
            ? now
            : new Date(Date.now() + getExponentialBackoffMs(nextAttemptCount)),
          processingStartedAt: null,
          lastError: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown error',
        },
      });
      if (exhausted) {
        result.failed += 1;
      } else {
        result.retried += 1;
      }
    }
  }

  console.info('[notifications.outbox] Drain batch complete', {
    batchSize,
    elapsedMs: Date.now() - startedAt,
    ...result,
  });
  return result;
}

export async function getNotificationOutboxStats() {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role as UserRole | undefined;
  // Email Settings is Admin III only per the admin tier spec.
  if (!canAccessEmailSettings(role ? [role] : [])) {
    return {
      mode: 'unauthorized' as const,
      pending: 0,
      processing: 0,
      retry: 0,
      sent24h: 0,
      failed: 0,
    };
  }
  const [pending, processing, retry, sent24h, failed] = await Promise.all([
    prisma.notificationOutbox.count({
      where: {
        status: NotificationOutboxStatus.PENDING,
      },
    }),
    prisma.notificationOutbox.count({
      where: {
        status: NotificationOutboxStatus.PROCESSING,
      },
    }),
    prisma.notificationOutbox.count({
      where: {
        status: NotificationOutboxStatus.RETRY,
      },
    }),
    prisma.notificationOutbox.count({
      where: {
        status: NotificationOutboxStatus.SENT,
        sentAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.notificationOutbox.count({
      where: {
        status: NotificationOutboxStatus.FAILED,
      },
    }),
  ]);
  return {
    mode: getNotificationDeliveryMode(),
    pending,
    processing,
    retry,
    sent24h,
    failed,
  };
}

export async function requeueFailedNotificationOutbox(limit = 100) {
  const session = await getServerSession(authOptions);
  const role = session?.user?.role as UserRole | undefined;
  if (!canAccessEmailSettings(role ? [role] : [])) {
    return { success: false, error: 'Not authorized.' };
  }
  const take = Math.max(1, Math.min(500, Math.floor(limit)));
  const failedIds = await prisma.notificationOutbox.findMany({
    where: { status: NotificationOutboxStatus.FAILED },
    orderBy: { createdAt: 'asc' },
    take,
    select: { id: true },
  });
  if (!failedIds.length) return { success: true, updated: 0 };

  const { count } = await prisma.notificationOutbox.updateMany({
    where: { id: { in: failedIds.map((row) => row.id) } },
    data: {
      status: NotificationOutboxStatus.RETRY,
      nextAttemptAt: new Date(),
      lastError: null,
      processingStartedAt: null,
    },
  });
  return { success: true, updated: count };
}

export async function updateTaskStatus(
  taskId: string,
  newStatus: TaskStatus,
  options?: {
    noteMessage?: string;
    skipProofRequirement?: boolean;
    markNotNeeded?: boolean;
    bypassDisclosureApproval?: boolean;
  }
) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) {
      return { success: false, error: 'Not authenticated.' };
    }

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        status: true,
        kind: true,
        assignedRole: true,
        assignedUserId: true,
        assignedUser: {
          select: {
            name: true,
          },
        },
        loanId: true,
        parentTaskId: true,
        disclosureReason: true,
        workflowState: true,
        loanOfficerApprovedAt: true,
        submissionData: true,
        loan: {
          select: {
            loanOfficerId: true,
            secondaryLoanOfficerId: true,
            visibilitySubmitterUserId: true,
          },
        },
      },
    });

    if (!existing) return { success: false, error: 'Task not found.' };

    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    const isAssignedToUser = existing.assignedUserId === userId;
    const isAssignedToRole =
      existing.assignedRole === role ||
      (role === UserRole.PROCESSOR_JR &&
        (existing.assignedRole === UserRole.VA_HOI || existing.kind === TaskKind.VA_HOI)) ||
      (role === UserRole.VA &&
        (existing.assignedRole === UserRole.VA_TITLE ||
          existing.assignedRole === UserRole.VA_PAYOFF ||
          existing.assignedRole === UserRole.VA_APPRAISAL ||
          (existing.kind !== TaskKind.VA_HOI && isVaTaskKind(existing.kind))));
    const isLoanOwner =
      role === UserRole.LOAN_OFFICER &&
      existing.loan &&
      canLoanOfficerViewLoan(existing.loan, userId);

    if (!canManageAll && !isAssignedToUser && !isAssignedToRole && !isLoanOwner) {
      return { success: false, error: 'Not authorized to update this task.' };
    }
    if (!canManageAll && role === UserRole.PROCESSOR_JR && isJrTaskOwnedByDifferentUser(existing, userId)) {
      return { success: false, error: 'This JR task is assigned to another processor.' };
    }

    if (existing.status === newStatus) {
      return { success: true };
    }

    const isVaKind =
      existing.kind === TaskKind.VA_TITLE ||
      existing.kind === TaskKind.VA_HOI ||
      existing.kind === TaskKind.VA_PAYOFF ||
      existing.kind === TaskKind.VA_APPRAISAL;

    const isVaRole =
      role === UserRole.VA ||
      role === UserRole.VA_TITLE ||
      role === UserRole.VA_PAYOFF ||
      role === UserRole.VA_APPRAISAL;

    const isSubmissionWorkflowTask = isSubmissionTask(existing);
    const normalizedNoteMessage = String(options?.noteMessage ?? '').trim();
    const skipProofRequirement = Boolean(options?.skipProofRequirement);
    const markNotNeeded = Boolean(options?.markNotNeeded);
    const bypassDisclosureApproval = Boolean(options?.bypassDisclosureApproval);
    const canMarkNotNeeded =
      markNotNeeded &&
      (existing.kind === TaskKind.VA_APPRAISAL || existing.kind === TaskKind.VA_PAYOFF);
    const canSkipProofForNotNeeded =
      skipProofRequirement &&
      (existing.kind === TaskKind.VA_PAYOFF || existing.kind === TaskKind.VA_APPRAISAL) &&
      (role === UserRole.VA ||
        role === UserRole.VA_APPRAISAL ||
        role === UserRole.VA_PAYOFF ||
        role === UserRole.MANAGER ||
        isAdmin(role));
    const canBypassDisclosureApproval =
      bypassDisclosureApproval &&
      skipProofRequirement &&
      newStatus === TaskStatus.COMPLETED &&
      isDisclosureSubmissionTask(existing) &&
      (role === UserRole.DISCLOSURE_SPECIALIST || role === UserRole.MANAGER || isAdmin(role));

    // Loan Officers should not use generic status transitions for submission tasks.
    // Their workflow is controlled through disclosure/QC response actions instead.
    if (role === UserRole.LOAN_OFFICER && isSubmissionWorkflowTask) {
      return {
        success: false,
        error:
          'Loan Officers cannot change status for submitted disclosure/QC requests from this control.',
      };
    }

    if (
      newStatus === TaskStatus.COMPLETED &&
      (isVaKind ||
        isVaRole ||
        (isSubmissionWorkflowTask && !isQcStyleSubmissionTask(existing)))
    ) {
      const proofCount = await prisma.taskAttachment.count({
        where: { taskId, purpose: 'PROOF' },
      });
      if (proofCount < 1 && !canSkipProofForNotNeeded && !canBypassDisclosureApproval) {
        return {
          success: false,
          error: 'Upload proof (PDF/Image) before completing this task.',
        };
      }
    }

    if (newStatus === TaskStatus.COMPLETED && existing.kind === TaskKind.VA_HOI) {
      const checklistItems = getSavedJrChecklistItemsFromSubmissionData(existing.submissionData);
      const allCompleted =
        checklistItems !== null &&
        checklistItems.every(
          (item) =>
            item.status === 'COMPLETED' ||
            (item.id === JR_VOE_ROW_ID && item.status === 'NOT_REQUIRED')
        );
      const allProofAttached =
        checklistItems !== null &&
        checklistItems.every((item) =>
          isJrChecklistProofRequired(item) ? getJrChecklistProofAttachments(item).length > 0 : true
        );
      if (!allCompleted || !allProofAttached) {
        return {
          success: false,
          error:
            'JR Processor task can only be completed when HOI is Completed with proof, Submitted to Underwriting is Completed, and VOE is either Completed with proof or marked Not Required.',
        };
      }
    }

    if (
      newStatus === TaskStatus.COMPLETED &&
      isSubmissionWorkflowTask &&
      !canBypassDisclosureApproval
    ) {
      if (
        existing.workflowState === TaskWorkflowState.WAITING_ON_LO ||
        existing.workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL
      ) {
        return {
          success: false,
          error:
            'This task is waiting on Loan Officer response. It cannot be completed yet.',
        };
      }
    }

    if (
      newStatus === TaskStatus.COMPLETED &&
      isDisclosureSubmissionTask(existing) &&
      !canBypassDisclosureApproval
    ) {
      if (
        existing.disclosureReason ===
          DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES &&
        !existing.loanOfficerApprovedAt
      ) {
        return {
          success: false,
          error:
            'Loan Officer approval is required before completing this disclosure task.',
        };
      }
    }

    const actorName = session?.user?.name || 'Unknown';
    const isQcSubmissionWorkflowTask = isQcStyleSubmissionTask(existing);
    const shouldAppendStatusHistory = isQcSubmissionWorkflowTask || isVaKind;
    const statusHistoryMessage = `Status changed to ${newStatus.replace('_', ' ')}.`;
    let submissionDataWithTimeline = shouldAppendStatusHistory
      ? appendSubmissionHistoryEntry(existing.submissionData, {
          author: actorName,
          role,
          message: statusHistoryMessage,
          entryType: 'status',
        })
      : existing.submissionData;
    if (isVaKind && normalizedNoteMessage) {
      submissionDataWithTimeline = appendSubmissionHistoryEntry(
        submissionDataWithTimeline ?? existing.submissionData,
        {
          author: actorName,
          role,
          message: normalizedNoteMessage,
          entryType: 'note',
        }
      );
    }

    const shouldClaimVaTask =
      isVaKind && newStatus === TaskStatus.IN_PROGRESS && !existing.assignedUserId;
    const nextWorkflowState =
      newStatus === TaskStatus.COMPLETED
        ? TaskWorkflowState.NONE
        : existing.workflowState ?? TaskWorkflowState.NONE;
    const lifecycleEventType =
      newStatus === TaskStatus.COMPLETED
        ? 'COMPLETED'
        : newStatus === TaskStatus.IN_PROGRESS
        ? 'STARTED'
        : 'STATUS_CHANGED';
    submissionDataWithTimeline = appendLifecycleHistoryEvent(submissionDataWithTimeline, {
      actorName,
      actorRole: role,
      eventType: lifecycleEventType,
      fromStatus: existing.status,
      toStatus: newStatus,
      fromWorkflow: existing.workflowState,
      toWorkflow: nextWorkflowState,
      fromAssignedUserId: existing.assignedUserId,
      toAssignedUserId: shouldClaimVaTask ? userId : existing.assignedUserId,
      fromAssignedUserName: existing.assignedUser?.name || null,
      toAssignedUserName: shouldClaimVaTask ? actorName : existing.assignedUser?.name || null,
      fromAssignedRole: existing.assignedRole,
      toAssignedRole: existing.assignedRole,
      note: normalizedNoteMessage || null,
    }) as Prisma.JsonObject;

    if (shouldClaimVaTask) {
      const claimResult = await prisma.task.updateMany({
        where: {
          id: taskId,
          assignedUserId: null,
        },
        data: {
          status: newStatus,
          assignedUserId: userId,
          workflowState: nextWorkflowState,
          completedAt: null,
          ...(submissionDataWithTimeline
            ? { submissionData: submissionDataWithTimeline }
            : {}),
        },
      });
      if (claimResult.count === 0) {
        const freshTask = await prisma.task.findUnique({
          where: { id: taskId },
          select: { assignedUser: { select: { name: true } } },
        });
        const starterName = freshTask?.assignedUser?.name?.trim() || 'another team member';
        return {
          success: false,
          error: `This task has already been started by ${starterName}.`,
        };
      }
    } else {
      await prisma.task.update({
        where: { id: taskId },
        data: {
          status: newStatus,
          workflowState: nextWorkflowState,
          completedAt: newStatus === 'COMPLETED' ? new Date() : null,
          ...((canSkipProofForNotNeeded || canMarkNotNeeded) && newStatus === 'COMPLETED'
            ? { disclosureReason: DisclosureDecisionReason.OTHER }
            : {}),
          ...(submissionDataWithTimeline
            ? { submissionData: submissionDataWithTimeline }
            : {}),
        },
      });
    }

    // LO response completion -> unpause parent disclosure task
    if (
      newStatus === TaskStatus.COMPLETED &&
      existing.kind === TaskKind.LO_NEEDS_INFO &&
      existing.parentTaskId
    ) {
      await prisma.task.update({
        where: { id: existing.parentTaskId },
        data: {
          status: TaskStatus.PENDING,
          workflowState: TaskWorkflowState.READY_TO_COMPLETE,
          loanOfficerApprovedAt:
            existing.disclosureReason ===
            DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
              ? new Date()
              : undefined,
        },
      });
    }

    // QC completion → auto-create VA tasks (idempotent)
    if (newStatus === TaskStatus.COMPLETED) {
      const isDisclosuresSubmission = isDisclosureSubmissionTask(existing);

      if (isDisclosuresSubmission) {
        await prisma.loan.update({
          where: { id: existing.loanId },
          data: { stage: 'DISCLOSURES_SENT' },
        });
      }

      const isQcSubmission = existing.kind === TaskKind.SUBMIT_QC;

      if (isQcSubmission) {
        const createdVaTasks = await ensureVaTasksForLoanFromQcCompletion(
          existing.loanId,
          existing.id
        );
        await dispatchVaFanoutNotifications({
          loanId: existing.loanId,
          createdTasks: createdVaTasks,
          changedBy: session?.user?.name || null,
        });
      }
    }

    if (
      newStatus === TaskStatus.COMPLETED &&
      existing.kind === TaskKind.LO_NEEDS_INFO &&
      existing.parentTaskId
    ) {
      await dispatchTaskWorkflowNotification({
        taskId: existing.parentTaskId,
        eventLabel: 'Task Returned to Disclosure',
        changedBy: session?.user?.name,
      });
    } else if (newStatus === TaskStatus.COMPLETED) {
      await dispatchTaskWorkflowNotification({
        taskId,
        eventLabel: 'Task Completed',
        changedBy: session?.user?.name,
      });
    } else {
      await dispatchTaskWorkflowNotification({
        taskId,
        eventLabel: 'Task Status Updated',
        changedBy: session?.user?.name,
      });
    }
    
    revalidatePath('/tasks');
    return { success: true };
  } catch (error) {
    console.error('Failed to update task:', error);
    return { success: false, error: 'Failed to update task' };
  } finally {
    recordPerfMetric('action.updateTaskStatus', Date.now() - perfStartedAt, {
      taskId,
      newStatus,
    });
  }
}

type PlusOnePayload = {
  loanOfficerName?: string;
  loanOfficerId?: string;
  secondaryLoanOfficerId?: string | null;
  borrowerFirstName: string;
  borrowerLastName: string;
  borrowerPhone?: string;
  borrowerEmail?: string;
  arriveLoanNumber: string;
  loanAmount?: string;
  notes?: string;
  submissionData?: Prisma.InputJsonValue;
};

function parseMoneyNumber(value: unknown) {
  const raw = String(value ?? '').replace(/[$,\s]/g, '').trim();
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeAriveLoanNumber(value: unknown) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

export async function createPlusOneSubmission(payload: PlusOnePayload) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const sessionUserId = session?.user?.id as string | undefined;
    if (!role || !sessionUserId) return { success: false, error: 'Not authenticated.' };
    if (role !== UserRole.LOAN_OFFICER && role !== UserRole.LOA) {
      return { success: false, error: 'Only Loan Officers and LO Assistants can submit +1.' };
    }

    const normalizedArriveLoanNumber = payload.arriveLoanNumber.trim();
    if (!normalizedArriveLoanNumber) {
      return { success: false, error: 'Arrive Loan Number is required.' };
    }
    const normalizedArriveLoanKey = normalizeAriveLoanNumber(normalizedArriveLoanNumber);
    const existingLoanWithAriveNumber = await prisma.loan.findMany({
      where: {
        loanNumber: {
          contains: normalizedArriveLoanNumber,
          mode: 'insensitive',
        },
      },
      select: {
        id: true,
        loanNumber: true,
        borrowerName: true,
      },
      take: 25,
    });
    const duplicateLoan = existingLoanWithAriveNumber.find(
      (loan) => normalizeAriveLoanNumber(loan.loanNumber) === normalizedArriveLoanKey
    );
    if (duplicateLoan) {
      return {
        success: false,
        code: 'DUPLICATE_ARIVE_LOAN_NUMBER',
        error: `A +1 cannot be submitted because Arive Loan Number ${normalizedArriveLoanNumber} already exists in the portal${duplicateLoan.borrowerName ? ` for ${duplicateLoan.borrowerName}` : ''}. Please use the existing file instead of submitting a duplicate +1.`,
      };
    }
    if (!payload.loanOfficerId) {
      return { success: false, error: 'Please select the Primary Loan Officer.' };
    }
    if (payload.secondaryLoanOfficerId === undefined) {
      return { success: false, error: 'Please select the Secondary Loan Officer (or N/A).' };
    }
    const normalizedSecondaryLoanOfficerId = payload.secondaryLoanOfficerId?.trim() || null;
    if (
      normalizedSecondaryLoanOfficerId &&
      normalizedSecondaryLoanOfficerId === payload.loanOfficerId
    ) {
      return { success: false, error: 'Primary and Secondary Loan Officer must be different users.' };
    }

    const submissionObject =
      payload.submissionData &&
      typeof payload.submissionData === 'object' &&
      !Array.isArray(payload.submissionData)
        ? (payload.submissionData as Record<string, unknown>)
        : {};
    const requiredFields: Array<{ key: string; label: string }> = [
      { key: 'borrowerFirstName', label: 'Borrower First Name' },
      { key: 'borrowerLastName', label: 'Borrower Last Name' },
      { key: 'arriveLoanNumber', label: 'Arrive Loan Number' },
      { key: 'lender', label: 'Lender / Investor' },
      { key: 'loanType', label: 'Loan Type' },
      { key: 'loanAmount', label: 'Loan Amount' },
      { key: 'projectedRevenue', label: 'Projected Revenue' },
      { key: 'leadSource', label: 'Lead Source' },
      { key: 'nextMilestone', label: 'Next Milestone' },
    ];
    const leadSource = String(submissionObject.leadSource ?? '').trim();
    if (leadSource === 'Lead Buy') {
      requiredFields.push({ key: 'leadVendor', label: 'Lead Vendor' });
    }
    const missingFields = requiredFields
      .filter(({ key }) => !String(submissionObject[key] ?? '').trim())
      .map(({ label }) => label);
    if (missingFields.length > 0) {
      return {
        success: false,
        error: `Please complete required fields before submitting: ${missingFields.join(', ')}.`,
      };
    }
    if (!isPayrollLenderSelection(submissionObject.lender)) {
      return {
        success: false,
        error: 'Please select a valid Lender / Investor from the dropdown.',
      };
    }
    if (parseMoneyNumber(submissionObject.projectedRevenue) <= 0) {
      return {
        success: false,
        error: 'Projected Revenue is required and must be greater than $0.',
      };
    }

    const loanOfficerUser = await prisma.user.findUnique({
      where: { id: payload.loanOfficerId },
      select: { id: true, name: true, role: true, roles: true },
    });
    const hasLoanOfficerRole =
      loanOfficerUser?.role === UserRole.LOAN_OFFICER ||
      loanOfficerUser?.roles.includes(UserRole.LOAN_OFFICER);
    if (!loanOfficerUser || !hasLoanOfficerRole) {
      return { success: false, error: 'Selected Primary Loan Officer is invalid.' };
    }

    let secondaryLoanOfficerUser:
      | { id: string; name: string; role: UserRole; roles: UserRole[] }
      | null = null;
    if (normalizedSecondaryLoanOfficerId) {
      secondaryLoanOfficerUser = await prisma.user.findUnique({
        where: { id: normalizedSecondaryLoanOfficerId },
        select: { id: true, name: true, role: true, roles: true },
      });
      const hasSecondaryLoanOfficerRole =
        secondaryLoanOfficerUser?.role === UserRole.LOAN_OFFICER ||
        secondaryLoanOfficerUser?.roles.includes(UserRole.LOAN_OFFICER);
      if (!secondaryLoanOfficerUser || !hasSecondaryLoanOfficerRole) {
        return { success: false, error: 'Selected Secondary Loan Officer is invalid.' };
      }
    }

    const visibilitySubmitterUserId =
      sessionUserId &&
      sessionUserId !== loanOfficerUser.id &&
      sessionUserId !== normalizedSecondaryLoanOfficerId
        ? sessionUserId
        : null;
    const borrowerName = `${payload.borrowerFirstName} ${payload.borrowerLastName}`.trim();

    let loan = await prisma.loan.findFirst({
      where: { loanNumber: normalizedArriveLoanNumber },
    });
    if (!loan) {
      loan = await prisma.loan.create({
        data: {
          loanNumber: normalizedArriveLoanNumber,
          borrowerName,
          borrowerPhone: payload.borrowerPhone?.trim() || null,
          borrowerEmail: payload.borrowerEmail?.trim() || null,
          amount: parseMoneyNumber(payload.loanAmount),
          program: String(submissionObject.loanProgram ?? '').trim() || null,
          loanOfficerId: loanOfficerUser.id,
          secondaryLoanOfficerId: normalizedSecondaryLoanOfficerId,
          visibilitySubmitterUserId,
        },
      });
    } else {
      const shouldReassignLoanOfficer = loan.loanOfficerId !== loanOfficerUser.id;
      const shouldUpdateSecondaryLoanOfficer =
        (loan.secondaryLoanOfficerId || null) !== normalizedSecondaryLoanOfficerId;
      const shouldUpdateVisibilitySubmitter =
        (loan.visibilitySubmitterUserId || null) !== visibilitySubmitterUserId;
      if (
        shouldReassignLoanOfficer ||
        shouldUpdateSecondaryLoanOfficer ||
        shouldUpdateVisibilitySubmitter
      ) {
        loan = await prisma.loan.update({
          where: { id: loan.id },
          data: {
            ...(shouldReassignLoanOfficer ? { loanOfficerId: loanOfficerUser.id } : {}),
            ...(shouldUpdateSecondaryLoanOfficer
              ? { secondaryLoanOfficerId: normalizedSecondaryLoanOfficerId }
              : {}),
            ...(shouldUpdateVisibilitySubmitter ? { visibilitySubmitterUserId } : {}),
            borrowerPhone: payload.borrowerPhone?.trim() || loan.borrowerPhone || null,
            borrowerEmail: payload.borrowerEmail?.trim() || loan.borrowerEmail || null,
          },
        });
      }
    }

    const resolvedLenderName = resolveLenderDisplayName(submissionObject.lender);
    const finalSubmissionData: Prisma.JsonObject = {
      ...submissionObject,
      workflowVersion: 'plus-one-v1',
      submittedAt: new Date().toISOString(),
      submittedById: sessionUserId,
      submittedByName: session?.user?.name || payload.loanOfficerName || loanOfficerUser.name,
      loanOfficer: loanOfficerUser.name,
      loanOfficerId: loanOfficerUser.id,
      secondaryLoanOfficerId: normalizedSecondaryLoanOfficerId,
      secondaryLoanOfficerName: secondaryLoanOfficerUser?.name || 'N/A',
      arriveLoanNumber: normalizedArriveLoanNumber,
      borrowerFirstName: payload.borrowerFirstName,
      borrowerLastName: payload.borrowerLastName,
      borrowerPhone: payload.borrowerPhone || '',
      borrowerEmail: payload.borrowerEmail || '',
      lender: resolvedLenderName,
      loanAmount: payload.loanAmount || String(submissionObject.loanAmount ?? ''),
      notes: payload.notes || String(submissionObject.notes ?? ''),
    };
    if (role === UserRole.LOA && session?.user?.email) {
      finalSubmissionData.loaSubmitterEmail = session.user.email.trim().toLowerCase();
      finalSubmissionData.loaSubmitterName =
        session.user.name || payload.loanOfficerName || 'Loan Officer Assistant';
      finalSubmissionData.loaSubmitterId = sessionUserId;
    }

    const createdTask = await prisma.task.create({
      data: {
        loanId: loan.id,
        title: 'Submit +1',
        kind: TaskKind.SUBMIT_PLUS_ONE,
        description: payload.notes || null,
        submissionData: finalSubmissionData,
        status: TaskStatus.COMPLETED,
        priority: TaskPriority.NORMAL,
        completedAt: new Date(),
      },
    });

    await dispatchPlusOneSubmittedNotification({
      taskId: createdTask.id,
      changedBy: session?.user?.name || loanOfficerUser.name,
    });

    revalidatePath('/');
    return { success: true, taskId: createdTask.id, loanId: loan.id };
  } catch (error) {
    console.error('Failed to create +1 submission:', error);
    return { success: false, error: 'Failed to submit +1. Please try again.' };
  } finally {
    recordPerfMetric('action.createPlusOneSubmission', Date.now() - perfStartedAt, {
      loanNumber: payload.arriveLoanNumber,
    });
  }
}

type SubmissionType = 'DISCLOSURES' | 'QC';

type SubmissionPayload = {
  submissionType: SubmissionType;
  loanOfficerName?: string;
  loanOfficerId?: string;
  secondaryLoanOfficerId?: string | null;
  borrowerFirstName: string;
  borrowerLastName: string;
  borrowerPhone?: string;
  borrowerEmail?: string;
  arriveLoanNumber: string;
  loanAmount?: string;
  notes?: string;
  submissionData?: Prisma.InputJsonValue;
  buttonRequiredAttachments?: {
    avm?: boolean;
    titleSheet?: boolean;
    pricingSheet?: boolean;
  };
};

const disclosureEmployerReadonlyFields: Array<{
  key:
    | 'employerName'
    | 'employerAddress'
    | 'employerDurationLineOfWork'
  label: string;
}> = [
  { key: 'employerName', label: 'Employer Name' },
  { key: 'employerAddress', label: 'Employer Address' },
  {
    key: 'employerDurationLineOfWork',
    label: 'Employer - Duration in Line of Work',
  },
];

const disclosureAlwaysRequiredReadonlyFields: Array<{
  key:
    | 'yearBuiltProperty'
    | 'mannerInWhichTitleWillBeHeld';
  label: string;
}> = [
  { key: 'yearBuiltProperty', label: 'Year Built (Property)' },
  {
    key: 'mannerInWhichTitleWillBeHeld',
    label: 'Manner in Which Title Will be Held',
  },
];

const disclosureYearAquiredReadonlyField: {
  key: 'yearAquired';
  label: string;
} = { key: 'yearAquired', label: 'Year Aquired' };

export async function createSubmissionTask(payload: SubmissionPayload) {
  const perfStartedAt = Date.now();
  try {
    const {
      submissionType,
      loanOfficerName,
      loanOfficerId,
      secondaryLoanOfficerId,
      borrowerFirstName,
      borrowerLastName,
      borrowerPhone,
      borrowerEmail,
      arriveLoanNumber,
      loanAmount,
      notes,
      submissionData,
      buttonRequiredAttachments,
    } = payload;
    const normalizedArriveLoanNumber = arriveLoanNumber.trim();
    if (!normalizedArriveLoanNumber) {
      return {
        success: false,
        error: 'Arrive Loan Number is required. Please enter the exact Arrive loan number.',
      };
    }

    if (submissionType === 'DISCLOSURES') {
      const submissionObject =
        submissionData &&
        typeof submissionData === 'object' &&
        !Array.isArray(submissionData)
          ? (submissionData as Record<string, unknown>)
          : null;

      if (!submissionObject) {
        return {
          success: false,
          error:
            'MISMO data is required. Please upload MISMO 3.4 with all required fields.',
        };
      }

      const leadSource = String(submissionObject.leadSource ?? '').trim();
      const leadVendor = String(submissionObject.leadVendor ?? '').trim();
      if (!leadSource) {
        return {
          success: false,
          error: 'Lead Source is required before submitting Disclosures.',
        };
      }
      if (leadSource === 'Lead Buy' && !leadVendor) {
        return {
          success: false,
          error: 'Lead Vendor is required when Lead Source is Lead Buy.',
        };
      }

      const investor = String(submissionObject.investor ?? '').trim().toUpperCase();
      if (investor === 'BUTTON') {
        const runId = String(submissionObject.runId ?? '').trim();
        const pricingOption = String(submissionObject.pricingOption ?? '').trim();
        if (!runId || !pricingOption) {
          return {
            success: false,
            error: 'Run ID and Pricing Option are required for Button submissions.',
          };
        }
        const hasRequiredButtonAttachments =
          Boolean(buttonRequiredAttachments?.avm) &&
          Boolean(buttonRequiredAttachments?.titleSheet) &&
          Boolean(buttonRequiredAttachments?.pricingSheet);
        if (!hasRequiredButtonAttachments) {
          return {
            success: false,
            error: 'Attach AVM, Title Sheet, and Pricing Sheet for Button submissions.',
          };
        }
      }
      const hasMultipleBorrowers = Boolean(submissionObject.hasMultipleBorrowers);
      const normalizedBorrowerEmail = String(
        submissionObject.borrowerEmail ?? borrowerEmail ?? ''
      )
        .trim()
        .toLowerCase();
      const normalizedCoBorrowerEmail = String(
        submissionObject.coBorrowerEmail ?? ''
      )
        .trim()
        .toLowerCase();
      const hasButtonBorrowerEmailMatch =
        investor === 'BUTTON' &&
        hasMultipleBorrowers &&
        Boolean(normalizedBorrowerEmail) &&
        Boolean(normalizedCoBorrowerEmail) &&
        normalizedBorrowerEmail === normalizedCoBorrowerEmail;
      if (hasButtonBorrowerEmailMatch) {
        return {
          success: false,
          error:
            "You cant have the Borrower and Co borrower's emails match for Button. Please reupload when done.",
        };
      }

      const resolvedBorrowerPhone = String(
        submissionObject.borrowerPhone ?? borrowerPhone ?? ''
      ).trim();
      const resolvedBorrowerEmail = String(
        submissionObject.borrowerEmail ?? borrowerEmail ?? ''
      ).trim();
      if (!resolvedBorrowerPhone || !resolvedBorrowerEmail) {
        return {
          success: false,
          error:
            'Borrower Phone and Borrower Email are required from MISMO. Please complete them in Arrive and re-export MISMO 3.4.',
        };
      }

      const qualificationStatus = String(
        submissionObject.qualificationStatus ?? ''
      ).trim();
      if (qualificationStatus !== 'Yes') {
        return {
          success: false,
          error: 'Qualification Status must be set to Yes before submitting.',
        };
      }

      const incomeProfileRaw =
        submissionObject.incomeProfile &&
        typeof submissionObject.incomeProfile === 'object' &&
        !Array.isArray(submissionObject.incomeProfile)
          ? (submissionObject.incomeProfile as Record<string, unknown>)
          : null;
      const hasAnyIncomeItems = Boolean(incomeProfileRaw?.hasAnyIncomeItems);
      const hasEmploymentIncome = Boolean(incomeProfileRaw?.hasEmploymentIncome);
      const isVaIrrrl = Boolean(incomeProfileRaw?.isVaIrrrl);
      const employmentFieldsRequired = isVaIrrrl
        ? false
        : hasAnyIncomeItems
        ? hasEmploymentIncome
        : true;
      const loanProgram = String(submissionObject.loanProgram ?? '')
        .trim()
        .toUpperCase();
      const loanPurposeType = String(submissionObject.loanPurposeType ?? '')
        .trim()
        .toUpperCase();
      const isPurchaseLikeLoan =
        loanProgram === 'PURCHASE' || loanPurposeType === 'PURCHASE';

      const disclosureReadonlyRequiredFields = [
        ...(employmentFieldsRequired ? disclosureEmployerReadonlyFields : []),
        ...disclosureAlwaysRequiredReadonlyFields,
        ...(isPurchaseLikeLoan ? [] : [disclosureYearAquiredReadonlyField]),
      ];

      const missingFields = disclosureReadonlyRequiredFields
        .filter(({ key }) => !String(submissionObject[key] ?? '').trim())
        .map(({ label }) => label);

      if (missingFields.length > 0) {
        return {
          success: false,
          error: `MISMO is missing required fields: ${missingFields.join(
            ', '
          )}. Please complete them in Arrive before exporting MISMO 3.4.`,
        };
      }
    }

    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const sessionUserId = session?.user?.id as string | undefined;
    const sessionUser = sessionUserId
      ? await prisma.user.findUnique({
          where: { id: sessionUserId },
          select: {
            id: true,
            loDisclosureSubmissionEnabled: true,
            loQcSubmissionEnabled: true,
          },
        })
      : null;

    if (
      role === UserRole.LOAN_OFFICER &&
      submissionType === 'DISCLOSURES' &&
      !sessionUser?.loDisclosureSubmissionEnabled
    ) {
      return {
        success: false,
        error: 'Submit for Disclosures is disabled for your user by Admin.',
      };
    }

    let processingMethod = '';
    let processingAssignmentGroup: string | null = null;
    let processingAssignmentLabel: string | null = null;
    if (submissionType === 'QC') {
      if (
        role === UserRole.LOAN_OFFICER &&
        !sessionUser?.loQcSubmissionEnabled
      ) {
        return {
          success: false,
          error: 'Submit for Processing is disabled for your user by Admin.',
        };
      }
      if (!sessionUserId) {
        return { success: false, error: 'Not authenticated.' };
      }

      const submissionObject =
        submissionData &&
        typeof submissionData === 'object' &&
        !Array.isArray(submissionData)
          ? (submissionData as Record<string, unknown>)
          : null;
      const leadSource = String(submissionObject?.leadSource ?? '').trim();
      const leadVendor = String(submissionObject?.leadVendor ?? '').trim();
      if (!leadSource) {
        return {
          success: false,
          error: 'Lead Source is required before submitting Processing.',
        };
      }
      if (leadSource === 'Lead Buy' && !leadVendor) {
        return {
          success: false,
          error: 'Lead Vendor is required when Lead Source is Lead Buy.',
        };
      }
      const qcInvestor = String(submissionObject?.investor ?? '').trim().toUpperCase();
      if (!qcInvestor || !QC_INVESTOR_ALLOWED_VALUES.has(qcInvestor)) {
        return {
          success: false,
          error: 'Investor is required before submitting Processing.',
        };
      }
      const qcNotes = String(notes ?? submissionObject?.notesGoals ?? '').trim();
      if (qcInvestor === 'OTHER' && !qcNotes) {
        return {
          success: false,
          error: 'Notes / Goals are required when Investor is set to Other.',
        };
      }

      const qcCashBack = String(submissionObject?.cashBack ?? '').trim();
      const qcProjectedRevenue = String(submissionObject?.projectedRevenue ?? '').trim();
      if (!qcCashBack || !qcProjectedRevenue) {
        return {
          success: false,
          error:
            'Cash Back and Projected Revenue are required before submitting Processing.',
        };
      }
      if (parseMoneyNumber(qcProjectedRevenue) <= 0) {
        return {
          success: false,
          error: 'Projected Revenue is required and must be greater than $0 before submitting Processing.',
        };
      }

      processingMethod = String(submissionObject?.processingMethod ?? '').trim();
      if (!isProcessingMethod(processingMethod)) {
        return {
          success: false,
          error: 'Please select a Processing Method before submitting Processing.',
        };
      }

      if (processingMethod === PROCESSING_METHOD_IN_HOUSE) {
        const assignmentGroup = String(submissionObject?.processingAssignmentGroup ?? '').trim();
        if (!isInHouseProcessingAssignmentGroup(assignmentGroup)) {
          return {
            success: false,
            error: 'Please select an in-house Processor for in-house Processing.',
          };
        }
        processingAssignmentGroup = assignmentGroup;
      } else if (processingMethod === PROCESSING_METHOD_THIRD_PARTY) {
        processingAssignmentGroup = PROCESSING_ASSIGNMENT_THIRD_PARTY;
      } else if (processingMethod === PROCESSING_METHOD_SELF_PROCESSED) {
        processingAssignmentGroup = null;
      }

      if (
        processingAssignmentGroup &&
        !isProcessingAssignmentGroup(processingAssignmentGroup)
      ) {
        return {
          success: false,
          error: 'Please select a valid Processing routing group.',
        };
      }
      processingAssignmentLabel = getProcessingAssignmentLabel(processingAssignmentGroup);
    }

    if (!loanOfficerId) {
      return {
        success: false,
        error: 'Please select the Primary Loan Officer for this request.',
      };
    }
    if (secondaryLoanOfficerId === undefined) {
      return {
        success: false,
        error: 'Please select the Secondary Loan Officer (or N/A) for this request.',
      };
    }

    const normalizedSecondaryLoanOfficerId = secondaryLoanOfficerId?.trim() || null;
    if (normalizedSecondaryLoanOfficerId && normalizedSecondaryLoanOfficerId === loanOfficerId) {
      return {
        success: false,
        error: 'Primary and Secondary Loan Officer must be different users.',
      };
    }

    const loanOfficerUser = await prisma.user.findUnique({
      where: { id: loanOfficerId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        roles: true,
      },
    });
    const hasLoanOfficerRole =
      loanOfficerUser?.role === UserRole.LOAN_OFFICER ||
      loanOfficerUser?.roles.includes(UserRole.LOAN_OFFICER);
    if (!loanOfficerUser || !hasLoanOfficerRole) {
      return {
        success: false,
        error: 'Selected Primary Loan Officer is invalid. Please choose an active Loan Officer.',
      };
    }

    let secondaryLoanOfficerUser:
      | {
          id: string;
          name: string;
          email: string;
          role: UserRole;
          roles: UserRole[];
        }
      | null = null;
    if (normalizedSecondaryLoanOfficerId) {
      secondaryLoanOfficerUser = await prisma.user.findUnique({
        where: { id: normalizedSecondaryLoanOfficerId },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          roles: true,
        },
      });
      const hasSecondaryLoanOfficerRole =
        secondaryLoanOfficerUser?.role === UserRole.LOAN_OFFICER ||
        secondaryLoanOfficerUser?.roles.includes(UserRole.LOAN_OFFICER);
      if (!secondaryLoanOfficerUser || !hasSecondaryLoanOfficerRole) {
        return {
          success: false,
          error: 'Selected Secondary Loan Officer is invalid. Please choose an active Loan Officer or N/A.',
        };
      }
    }

    if (!loanOfficerUser) {
      return { success: false, error: 'No loan officer user found' };
    }
    const visibilitySubmitterUserId =
      sessionUserId &&
      sessionUserId !== loanOfficerUser.id &&
      sessionUserId !== normalizedSecondaryLoanOfficerId
        ? sessionUserId
        : null;

    // Find or create loan
    let loan = await prisma.loan.findFirst({
      where: { loanNumber: normalizedArriveLoanNumber },
    });

    const targetStage =
      submissionType === 'QC' ? 'PROCESSING' : 'DISCLOSURES_PENDING';

    if (!loan) {
      loan = await prisma.loan.create({
        data: {
          loanNumber: normalizedArriveLoanNumber,
          borrowerName: `${borrowerFirstName} ${borrowerLastName}`.trim(),
          borrowerPhone: borrowerPhone?.trim() || null,
          borrowerEmail: borrowerEmail?.trim() || null,
          amount: Number(loanAmount || 0),
          loanOfficerId: loanOfficerUser.id,
          secondaryLoanOfficerId: normalizedSecondaryLoanOfficerId,
          visibilitySubmitterUserId,
          stage: targetStage,
        },
      });
    } else {
      // If LOA selected a Loan Officer, ensure ownership follows that selection
      // so the chosen LO immediately sees the request in their portal.
      const shouldReassignLoanOfficer = loan.loanOfficerId !== loanOfficerUser.id;
      const shouldUpdateSecondaryLoanOfficer =
        (loan.secondaryLoanOfficerId || null) !== normalizedSecondaryLoanOfficerId;
      const shouldUpdateVisibilitySubmitter =
        (loan.visibilitySubmitterUserId || null) !== visibilitySubmitterUserId;
      const shouldPromoteIntakeStage = loan.stage === 'INTAKE';
      if (
        shouldReassignLoanOfficer ||
        shouldPromoteIntakeStage ||
        shouldUpdateSecondaryLoanOfficer ||
        shouldUpdateVisibilitySubmitter
      ) {
        loan = await prisma.loan.update({
          where: { id: loan.id },
          data: {
            ...(shouldPromoteIntakeStage ? { stage: targetStage } : {}),
            ...(shouldReassignLoanOfficer ? { loanOfficerId: loanOfficerUser.id } : {}),
            ...(shouldUpdateSecondaryLoanOfficer
              ? { secondaryLoanOfficerId: normalizedSecondaryLoanOfficerId }
              : {}),
            ...(shouldUpdateVisibilitySubmitter
              ? { visibilitySubmitterUserId }
              : {}),
            borrowerPhone: borrowerPhone?.trim() || loan.borrowerPhone || null,
            borrowerEmail: borrowerEmail?.trim() || loan.borrowerEmail || null,
          },
        });
      }
    }

    const taskTitle =
      submissionType === 'QC'
        ? 'Submit for Processing'
        : 'Submit for Disclosures';

    const assignedRole =
      submissionType === 'QC'
        ? UserRole.PROCESSOR_JR
        : UserRole.DISCLOSURE_SPECIALIST;

    const kind =
      submissionType === 'QC' ? TaskKind.SUBMIT_PROCESSING : TaskKind.SUBMIT_DISCLOSURES;

    let finalSubmissionData = submissionData;
    if (submissionType === 'QC') {
      const dataObj =
        finalSubmissionData && typeof finalSubmissionData === 'object' && !Array.isArray(finalSubmissionData)
          ? { ...(finalSubmissionData as Record<string, unknown>) }
          : {};
      dataObj.workflowVersion = 'processing-v1';
      dataObj.legacyWorkflow = false;
      dataObj.processingMethod = processingMethod;
      dataObj.processingMethodLabel = getProcessingMethodLabel(processingMethod);
      dataObj.processingAssignmentGroup = processingAssignmentGroup;
      dataObj.processingAssignmentLabel = processingAssignmentLabel;
      finalSubmissionData = dataObj as Prisma.JsonObject;
    }
    if (notes?.trim()) {
      const dataObj = (finalSubmissionData && typeof finalSubmissionData === 'object')
        ? { ...(finalSubmissionData as Record<string, unknown>) }
        : {};
      
      const initialNote = {
        author: session?.user?.name || loanOfficerName || 'Loan Officer',
        role: role || UserRole.LOAN_OFFICER,
        message: `Initial Submission Notes: ${notes.trim()}`,
        date: new Date().toISOString(),
      };
      
      dataObj.notesHistory = [initialNote];
      finalSubmissionData = dataObj as Prisma.JsonObject;
    }
    if (role === UserRole.LOA && session?.user?.email) {
      const dataObj =
        finalSubmissionData && typeof finalSubmissionData === 'object' && !Array.isArray(finalSubmissionData)
          ? { ...(finalSubmissionData as Record<string, unknown>) }
          : {};
      dataObj.loaSubmitterEmail = session.user.email.trim().toLowerCase();
      dataObj.loaSubmitterName = session.user.name || loanOfficerName || 'Loan Officer Assistant';
      if (sessionUserId) dataObj.loaSubmitterId = sessionUserId;
      finalSubmissionData = dataObj as Prisma.JsonObject;
    }

    const createdTask = await prisma.task.create({
      data: {
        loanId: loan.id,
        title: taskTitle,
        kind,
        description: notes || null,
        submissionData: finalSubmissionData ?? undefined,
        status:
          submissionType === 'QC' && processingMethod === PROCESSING_METHOD_SELF_PROCESSED
            ? TaskStatus.COMPLETED
            : TaskStatus.PENDING,
        priority: TaskPriority.NORMAL,
        assignedRole:
          submissionType === 'QC' && processingMethod === PROCESSING_METHOD_SELF_PROCESSED
            ? null
            : assignedRole,
        completedAt:
          submissionType === 'QC' && processingMethod === PROCESSING_METHOD_SELF_PROCESSED
            ? new Date()
            : null,
        dueDate:
          submissionType === 'QC' && processingMethod === PROCESSING_METHOD_SELF_PROCESSED
            ? null
            : new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    try {
      await dispatchTaskWorkflowNotification({
        taskId: createdTask.id,
        eventLabel: 'New Request Submitted',
        changedBy: session?.user?.name || loanOfficerName || null,
      });
    } catch (notificationError) {
      console.error('Submission created but notification dispatch failed:', notificationError);
    }

    try {
      revalidatePath('/tasks');
      revalidatePath('/');
    } catch (revalidateError) {
      console.error('Submission created but cache revalidation failed:', revalidateError);
    }

    return { success: true, taskId: createdTask.id, loanId: loan.id };
  } catch (error) {
    console.error('Failed to create submission task:', error);
    let detail = '';
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002') {
        detail = 'A record with that Arrive loan number is already associated with conflicting data.';
      } else if (error.code === 'P2003') {
        detail = 'One of the selected users (Primary or Secondary Loan Officer) is no longer valid. Please refresh and re-select.';
      } else if (error.code === 'P2025') {
        detail = 'The loan record was not found or was modified. Please refresh and try again.';
      } else {
        detail = `Database error (${error.code}).`;
      }
    } else if (error instanceof Prisma.PrismaClientValidationError) {
      detail = 'Invalid data format was submitted. Please refresh and re-import your MISMO 3.4 file.';
    } else if (error instanceof Error) {
      detail = error.message ? `Details: ${error.message}` : '';
    }
    return {
      success: false,
      error: detail
        ? `Failed to submit task. ${detail}`
        : 'Failed to submit task. Please try again, or refresh and re-import your MISMO 3.4 file.',
    };
  } finally {
    recordPerfMetric('action.createSubmissionTask', Date.now() - perfStartedAt, {
      submissionType: payload.submissionType,
      loanNumber: payload.arriveLoanNumber,
    });
  }
}

type RequestInfoInput = {
  reason: DisclosureDecisionReason;
  message?: string;
  qcChecklist?: {
    items: Array<{
      id: string;
      label: string;
      status: 'GREEN_CHECK' | 'RED_X' | 'YELLOW';
      noteOption:
        | 'CONFIRMED_IN_FILE'
        | 'NOT_NEEDED'
        | 'FREE_AND_CLEAR'
        | 'PURCHASE_NOT_NEEDED'
        | 'NOT_APPLICABLE'
        | 'MISSING_FROM_FILE'
        | 'OTHER';
      noteText?: string;
    }>;
    summaryMessage?: string;
  };
};

const QC_CHECKLIST_NOTE_OPTIONS = new Set([
  'CONFIRMED_IN_FILE',
  'NOT_NEEDED',
  'FREE_AND_CLEAR',
  'PURCHASE_NOT_NEEDED',
  'NOT_APPLICABLE',
  'MISSING_FROM_FILE',
  'OTHER',
] as const);

type ParsedQcChecklistItem = {
  id: string;
  label: string;
  status: 'GREEN_CHECK' | 'RED_X' | 'YELLOW';
  noteOption:
    | 'CONFIRMED_IN_FILE'
    | 'NOT_NEEDED'
    | 'FREE_AND_CLEAR'
    | 'PURCHASE_NOT_NEEDED'
    | 'NOT_APPLICABLE'
    | 'MISSING_FROM_FILE'
    | 'OTHER';
  noteText: string;
};

type ParsedQcChecklist = {
  items: ParsedQcChecklistItem[];
  summaryMessage: string;
};

function parseQcChecklistInput(input: RequestInfoInput['qcChecklist']): ParsedQcChecklist | null {
  if (!input || !Array.isArray(input.items) || input.items.length === 0) return null;
  const parsedItems: ParsedQcChecklistItem[] = [];
  for (const raw of input.items) {
    const id = String(raw?.id ?? '').trim();
    const label = String(raw?.label ?? '').trim();
    const status = raw?.status;
    const noteOption = raw?.noteOption;
    const noteText = String(raw?.noteText ?? '').trim();
    if (!id || !label) return null;
    if (status !== 'GREEN_CHECK' && status !== 'RED_X' && status !== 'YELLOW') return null;
    if (
      typeof noteOption !== 'string' ||
      !QC_CHECKLIST_NOTE_OPTIONS.has(noteOption as ParsedQcChecklistItem['noteOption'])
    ) {
      return null;
    }
    if (noteOption === 'MISSING_FROM_FILE' && !noteText) return null;
    parsedItems.push({
      id,
      label,
      status,
      noteOption,
      noteText,
    });
  }

  const summaryMessage = String(input.summaryMessage ?? '').trim();
  return { items: parsedItems, summaryMessage };
}

function appendSubmissionHistoryEntry(
  submissionData: Prisma.JsonValue | null | undefined,
  entry: {
    author: string;
    role: UserRole;
    message: string;
    entryType?: string;
  }
) {
  const dataObj =
    submissionData && typeof submissionData === 'object' && !Array.isArray(submissionData)
      ? { ...(submissionData as Record<string, unknown>) }
      : {};
  const notes = Array.isArray(dataObj.notesHistory) ? [...dataObj.notesHistory] : [];
  notes.push({
    author: entry.author,
    role: entry.role,
    message: entry.message,
    date: new Date().toISOString(),
    ...(entry.entryType ? { entryType: entry.entryType } : {}),
  });
  dataObj.notesHistory = notes;
  return dataObj as Prisma.JsonObject;
}

export async function addTaskNote(taskId: string, message: string) {
  try {
    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    const isDeskRole =
      role === UserRole.DISCLOSURE_SPECIALIST ||
      role === UserRole.QC ||
      role === UserRole.VA ||
      role === UserRole.VA_TITLE ||
      role === UserRole.VA_PAYOFF ||
      role === UserRole.VA_APPRAISAL ||
      role === UserRole.PROCESSOR_JR;
    if (!canManageAll && !isDeskRole) {
      return { success: false, error: 'Not authorized to add notes to this task.' };
    }

    const trimmed = message.trim();
    if (!trimmed) return { success: false, error: 'Note cannot be empty.' };

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        status: true,
        submissionData: true,
      },
    });
    if (!task) return { success: false, error: 'Task not found.' };
    if (task.status === TaskStatus.COMPLETED) {
      return { success: false, error: 'Cannot add notes to a completed task.' };
    }

    const actorName = session?.user?.name || 'Unknown';
    const updatedData = appendSubmissionHistoryEntry(task.submissionData, {
      author: actorName,
      role,
      message: trimmed,
      entryType: 'note',
    });

    await prisma.task.update({
      where: { id: taskId },
      data: { submissionData: updatedData as Prisma.JsonObject },
    });

    revalidatePath('/tasks');
    return { success: true };
  } catch (error) {
    console.error('Failed to add task note:', error);
    return { success: false, error: 'Failed to add note.' };
  }
}

type JrChecklistStatus = 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED' | 'NOT_REQUIRED';
type JrProofAttachmentInput = {
  attachmentId: string;
  filename: string;
};
type JrChecklistItemInput = {
  id: string;
  label: string;
  status: JrChecklistStatus;
  proofAttachmentId?: string | null;
  proofFilename?: string | null;
  proofAttachments?: JrProofAttachmentInput[];
  note?: string | null;
  noteUpdatedAt?: string | null;
  noteAuthor?: string | null;
  noteRole?: UserRole | null;
};

type JrProcessorAssignedValue =
  | 'ALISON_OMOTO'
  | 'BEN_WANG'
  | 'CARRIE_JOHNSON'
  | 'CHRISTY_HORSTMAN'
  | 'DEREK_SOUCIE'
  | 'DEVON_CARAG'
  | 'DOREEN_SCHEAR'
  | 'GEORGE_ISRAEL'
  | 'HANH_NGUYEN'
  | 'JENNIFER_ALVA'
  | 'JESSICA_ADAIR'
  | 'JO_LANDIS'
  | 'KIM_GORDON'
  | 'KIM_MARTIN'
  | 'LAUNNA_ECKERT'
  | 'MONICA_VINEY'
  | 'NANCY_CALIGARIS'
  | 'RACHAEL_WOOLRIGDGE'
  | 'RACHEL_HANCOCK'
  | 'ROMI_HIRAYAMA'
  | 'RYAN_KATAOKA'
  | 'SARABETH_DUONG'
  | 'SHAILI_RYAN'
  | 'TERRI_WITTE'
  | 'THAO_NGUYEN'
  | 'TIANA_TORRES'
  | 'TIMOTHY_CRUZ'
  | 'TYLER_HANCOCK';

const JR_CHECKLIST_TEMPLATE: Array<{ id: string; label: string }> = [
  { id: 'ordered-hoi', label: 'HOI' },
  { id: 'ordered-voe', label: 'VOE' },
  { id: 'submitted-underwriting', label: 'Submitted to Underwriting' },
];

const JR_CHECKLIST_STATUS_SET = new Set<JrChecklistStatus>([
  'ORDERED',
  'MISSING_ITEMS',
  'COMPLETED',
  'NOT_REQUIRED',
]);
const JR_VOE_ROW_ID = 'ordered-voe';
const JR_UNDERWRITING_ROW_ID = 'submitted-underwriting';
const JR_PROCESSOR_ASSIGNED_SET = new Set<JrProcessorAssignedValue>([
  'ALISON_OMOTO',
  'BEN_WANG',
  'CARRIE_JOHNSON',
  'CHRISTY_HORSTMAN',
  'DEREK_SOUCIE',
  'DEVON_CARAG',
  'DOREEN_SCHEAR',
  'GEORGE_ISRAEL',
  'HANH_NGUYEN',
  'JENNIFER_ALVA',
  'JESSICA_ADAIR',
  'JO_LANDIS',
  'KIM_GORDON',
  'KIM_MARTIN',
  'LAUNNA_ECKERT',
  'MONICA_VINEY',
  'NANCY_CALIGARIS',
  'RACHAEL_WOOLRIGDGE',
  'RACHEL_HANCOCK',
  'ROMI_HIRAYAMA',
  'RYAN_KATAOKA',
  'SARABETH_DUONG',
  'SHAILI_RYAN',
  'TERRI_WITTE',
  'THAO_NGUYEN',
  'TIANA_TORRES',
  'TIMOTHY_CRUZ',
  'TYLER_HANCOCK',
]);

function normalizeJrProcessorAssigned(
  input: unknown
): JrProcessorAssignedValue | null | undefined {
  if (input === undefined) return undefined;
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  if (JR_PROCESSOR_ASSIGNED_SET.has(raw as JrProcessorAssignedValue)) {
    return raw as JrProcessorAssignedValue;
  }
  return undefined;
}

function getJrChecklistProofAttachments(
  item: Pick<JrChecklistItemInput, 'proofAttachmentId' | 'proofFilename' | 'proofAttachments'>
) {
  if (Array.isArray(item.proofAttachments) && item.proofAttachments.length > 0) {
    return item.proofAttachments;
  }
  if (item.proofAttachmentId && item.proofFilename) {
    return [
      {
        attachmentId: item.proofAttachmentId,
        filename: item.proofFilename,
      },
    ];
  }
  return [];
}

function parseJrChecklistItems(input: JrChecklistItemInput[]): JrChecklistItemInput[] | null {
  if (!Array.isArray(input) || input.length !== JR_CHECKLIST_TEMPLATE.length) return null;
  const expectedById = new Map(JR_CHECKLIST_TEMPLATE.map((item) => [item.id, item.label]));
  const parsed: JrChecklistItemInput[] = [];
  for (const row of input) {
    const id = String(row?.id ?? '').trim();
    const label = String(row?.label ?? '').trim();
    const status = String(row?.status ?? '').trim() as JrChecklistStatus;
    const proofAttachmentId = String(row?.proofAttachmentId ?? '').trim();
    const proofFilename = String(row?.proofFilename ?? '').trim();
    const proofAttachmentsRaw = Array.isArray(row?.proofAttachments) ? row.proofAttachments : [];
    const note = String(row?.note ?? '').trim();
    const noteUpdatedAt = String(row?.noteUpdatedAt ?? '').trim();
    const noteAuthor = String(row?.noteAuthor ?? '').trim();
    const noteRoleRaw = String(row?.noteRole ?? '').trim();
    const noteRole =
      noteRoleRaw.length > 0 && (Object.values(UserRole) as string[]).includes(noteRoleRaw)
        ? (noteRoleRaw as UserRole)
        : null;
    if (!id || !label || !expectedById.has(id)) return null;
    if (label !== expectedById.get(id)) return null;
    if (!JR_CHECKLIST_STATUS_SET.has(status)) return null;
    if (status === 'NOT_REQUIRED' && id !== JR_VOE_ROW_ID) return null;
    const proofAttachments = proofAttachmentsRaw
      .map((attachment) => {
        if (!attachment || typeof attachment !== 'object') return null;
        const attachmentId = String(
          (attachment as { attachmentId?: unknown }).attachmentId ?? ''
        ).trim();
        const filename = String((attachment as { filename?: unknown }).filename ?? '').trim();
        if (!attachmentId || !filename) return null;
        return {
          attachmentId,
          filename,
        };
      })
      .filter((attachment): attachment is JrProofAttachmentInput => Boolean(attachment));
    if (proofAttachments.length === 0 && proofAttachmentId && proofFilename) {
      proofAttachments.push({
        attachmentId: proofAttachmentId,
        filename: proofFilename,
      });
    }
    const primaryProofAttachment = proofAttachments[0] ?? null;
    parsed.push({
      id,
      label,
      status,
      proofAttachmentId: primaryProofAttachment?.attachmentId ?? null,
      proofFilename: primaryProofAttachment?.filename ?? null,
      proofAttachments,
      note: note || null,
      noteUpdatedAt: noteUpdatedAt || null,
      noteAuthor: noteAuthor || null,
      noteRole,
    });
  }
  const uniqueIds = new Set(parsed.map((row) => row.id));
  if (uniqueIds.size !== JR_CHECKLIST_TEMPLATE.length) return null;
  return JR_CHECKLIST_TEMPLATE.map((template) => parsed.find((row) => row.id === template.id)!) as JrChecklistItemInput[];
}

function isJrChecklistProofRequired(item: Pick<JrChecklistItemInput, 'id' | 'status'>) {
  if (item.id === JR_UNDERWRITING_ROW_ID) return false;
  return item.status === 'COMPLETED';
}

function buildJrChecklistSummary(items: JrChecklistItemInput[]) {
  const ordered = items.filter((item) => item.status === 'ORDERED').length;
  const missing = items.filter((item) => item.status === 'MISSING_ITEMS').length;
  const completed = items.filter((item) => item.status === 'COMPLETED').length;
  const notRequired = items.filter((item) => item.status === 'NOT_REQUIRED').length;
  return `JR checklist updated: ${completed} completed, ${ordered} ordered, ${missing} missing/action required, ${notRequired} not required.`;
}

function getSavedJrChecklistItemsFromSubmissionData(
  submissionData: Prisma.JsonValue | null | undefined
): JrChecklistItemInput[] | null {
  if (!submissionData || typeof submissionData !== 'object' || Array.isArray(submissionData)) {
    return null;
  }
  const dataObj = submissionData as Record<string, unknown>;
  const jrChecklistRaw =
    dataObj.jrChecklist && typeof dataObj.jrChecklist === 'object' && !Array.isArray(dataObj.jrChecklist)
      ? (dataObj.jrChecklist as Record<string, unknown>)
      : null;
  const itemsRaw = Array.isArray(jrChecklistRaw?.items) ? jrChecklistRaw.items : null;
  if (!itemsRaw) return null;
  return parseJrChecklistItems(itemsRaw as JrChecklistItemInput[]);
}

function canBypassDeskStartLock(role: UserRole) {
  return isAdmin(role) || role === UserRole.MANAGER;
}

function isStartLockedDeskTask(task: {
  kind: TaskKind | null;
  status: TaskStatus;
  workflowState: TaskWorkflowState;
}) {
  if (!task.kind) return false;
  const isDeskKind =
    task.kind === TaskKind.SUBMIT_DISCLOSURES ||
    task.kind === TaskKind.SUBMIT_QC ||
    task.kind === TaskKind.SUBMIT_PROCESSING ||
    task.kind === TaskKind.VA_TITLE ||
    task.kind === TaskKind.VA_PAYOFF ||
    task.kind === TaskKind.VA_APPRAISAL ||
    task.kind === TaskKind.VA_HOI;

  return isDeskKind && task.status === TaskStatus.PENDING && task.workflowState === TaskWorkflowState.NONE;
}

function isJrTaskOwnedByDifferentUser(task: {
  kind: TaskKind | null;
  assignedUserId: string | null;
}, userId: string) {
  return task.kind === TaskKind.VA_HOI && Boolean(task.assignedUserId) && task.assignedUserId !== userId;
}

export async function saveJrProcessorChecklist(
  taskId: string,
  items: JrChecklistItemInput[],
  processorAssigned?: string | null,
  processorAssignedNote?: string | null
) {
  try {
    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) {
      return { success: false, error: 'Not authenticated.' };
    }

    const parsedItems = parseJrChecklistItems(items);
    if (!parsedItems) {
      return { success: false, error: 'Invalid JR checklist payload.' };
    }

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        workflowState: true,
        assignedRole: true,
        assignedUserId: true,
        submissionData: true,
      },
    });

    if (!existing) return { success: false, error: 'Task not found.' };
    if (existing.kind !== TaskKind.VA_HOI) {
      return { success: false, error: 'Only JR Processor tasks support this checklist.' };
    }
    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    const canManageJrTask =
      (role === UserRole.PROCESSOR_JR &&
        !isJrTaskOwnedByDifferentUser(existing, userId)) ||
      existing.assignedUserId === userId;
    if (!canManageAll && !canManageJrTask) {
      return { success: false, error: 'Not authorized to update this checklist.' };
    }

    const dataObj =
      existing.submissionData &&
      typeof existing.submissionData === 'object' &&
      !Array.isArray(existing.submissionData)
        ? { ...(existing.submissionData as Record<string, unknown>) }
        : {};

    const existingChecklistRaw =
      dataObj.jrChecklist &&
      typeof dataObj.jrChecklist === 'object' &&
      !Array.isArray(dataObj.jrChecklist)
        ? (dataObj.jrChecklist as Record<string, unknown>)
        : null;

    if (existing.status === TaskStatus.COMPLETED) {
      const canUpdateCompletedProcessorAssignment =
        role === UserRole.PROCESSOR_JR || role === UserRole.MANAGER || isAdmin(role);
      if (!canUpdateCompletedProcessorAssignment) {
        return {
          success: false,
          error: 'JR checklist is locked after task completion. Ask a manager to reopen the task.',
        };
      }
      const normalizedProcessorAssignedInput = normalizeJrProcessorAssigned(processorAssigned);
      if (processorAssigned !== undefined && normalizedProcessorAssignedInput === undefined) {
        return { success: false, error: 'Invalid processor assignment.' };
      }
      const existingProcessorAssigned = normalizeJrProcessorAssigned(
        existingChecklistRaw?.processorAssigned
      );
      const normalizedProcessorAssigned =
        normalizedProcessorAssignedInput === undefined
          ? (existingProcessorAssigned ?? null)
          : normalizedProcessorAssignedInput;
      const existingItems = Array.isArray(existingChecklistRaw?.items)
        ? (existingChecklistRaw?.items as Prisma.JsonValue[])
        : [];
      const existingProcessorAssignedNote =
        String(existingChecklistRaw?.processorAssignedNote ?? '').trim() || null;
      dataObj.jrChecklist = {
        items: existingItems,
        processorAssigned: normalizedProcessorAssigned,
        processorAssignedNote: existingProcessorAssignedNote,
        updatedAt: new Date().toISOString(),
        updatedBy: session?.user?.name || 'Team Member',
      };
      await prisma.task.update({
        where: { id: taskId },
        data: {
          submissionData: dataObj as Prisma.JsonObject,
          workflowState: existing.workflowState,
        },
      });

      revalidatePath('/tasks');
      revalidatePath('/');
      return { success: true };
    } else if (!canBypassDeskStartLock(role) && isStartLockedDeskTask(existing)) {
      return { success: false, error: 'Start this task before editing the JR checklist.' };
    }

    const proofAttachmentIds = Array.from(
      new Set(
        parsedItems.flatMap((item) =>
          getJrChecklistProofAttachments(item).map((attachment) => attachment.attachmentId)
        )
      )
    );
    if (proofAttachmentIds.length > 0) {
      const attachmentCount = await prisma.taskAttachment.count({
        where: {
          id: { in: proofAttachmentIds },
          taskId,
        },
      });
      if (attachmentCount !== proofAttachmentIds.length) {
        return { success: false, error: 'One or more checklist proof attachments are invalid.' };
      }
    }

    const normalizedProcessorAssignedInput = normalizeJrProcessorAssigned(processorAssigned);
    if (processorAssigned !== undefined && normalizedProcessorAssignedInput === undefined) {
      return { success: false, error: 'Invalid processor assignment.' };
    }
    const existingProcessorAssigned = normalizeJrProcessorAssigned(
      existingChecklistRaw?.processorAssigned
    );
    const normalizedProcessorAssigned =
      normalizedProcessorAssignedInput === undefined
        ? (existingProcessorAssigned ?? null)
        : normalizedProcessorAssignedInput;
    const normalizedProcessorAssignedNote =
      processorAssignedNote === undefined
        ? String(existingChecklistRaw?.processorAssignedNote ?? '').trim() || null
        : String(processorAssignedNote ?? '').trim() || null;
    const existingItemsRaw = existingChecklistRaw?.items;
    const existingNotesByRowId = new Map<string, string>();
    const existingProofAttachmentIdsByRowId = new Map<string, string[]>();
    const existingParsedItems = Array.isArray(existingItemsRaw)
      ? parseJrChecklistItems(existingItemsRaw as JrChecklistItemInput[])
      : null;
    if (existingParsedItems) {
      for (const item of existingParsedItems) {
        existingNotesByRowId.set(item.id, String(item.note ?? '').trim());
        existingProofAttachmentIdsByRowId.set(
          item.id,
          getJrChecklistProofAttachments(item).map((attachment) => attachment.attachmentId)
        );
      }
    }

    const nowIso = new Date().toISOString();
    const normalizedItems = parsedItems.map((item) => {
      const nextNote = (item.note || '').trim();
      if (!nextNote) {
        return {
          ...item,
          note: null,
          noteUpdatedAt: null,
          noteAuthor: null,
          noteRole: null,
        };
      }
      const previousNote = (existingNotesByRowId.get(item.id) || '').trim();
      const noteChanged = previousNote !== nextNote;
      return {
        ...item,
        note: nextNote,
        noteUpdatedAt: noteChanged ? nowIso : item.noteUpdatedAt || nowIso,
        noteAuthor: noteChanged ? session?.user?.name || 'Team Member' : item.noteAuthor || null,
        noteRole: noteChanged ? role : item.noteRole || role,
      };
    });

    dataObj.jrChecklist = {
      items: normalizedItems,
      processorAssigned: normalizedProcessorAssigned,
      processorAssignedNote: normalizedProcessorAssignedNote,
      updatedAt: new Date().toISOString(),
      updatedBy: session?.user?.name || 'Team Member',
    };

    const changedProofRows = normalizedItems
      .map((item) => {
        const previousAttachmentIds = existingProofAttachmentIdsByRowId.get(item.id) || [];
        const nextAttachmentIds = getJrChecklistProofAttachments(item).map(
          (attachment) => attachment.attachmentId
        );
        if (previousAttachmentIds.join('|') === nextAttachmentIds.join('|')) return null;
        if (nextAttachmentIds.length > 0 && previousAttachmentIds.length === 0) {
          return `${item.label} (uploaded)`;
        }
        if (nextAttachmentIds.length === 0 && previousAttachmentIds.length > 0) {
          return `${item.label} (removed)`;
        }
        return `${item.label} (updated)`;
      })
      .filter((entry): entry is string => Boolean(entry));
    if (changedProofRows.length > 0) {
      const notes = Array.isArray(dataObj.notesHistory) ? [...dataObj.notesHistory] : [];
      const summaryParts: string[] = [];
      if (changedProofRows.length > 0) {
        summaryParts.push(`JR attachments updated: ${changedProofRows.join(', ')}.`);
      }
      notes.push({
        author: session?.user?.name || 'Team Member',
        role,
        message: summaryParts.join(' ').trim(),
        date: new Date().toISOString(),
      });
      dataObj.notesHistory = notes;
    }

    const allCompleted = normalizedItems.every(
      (item) => item.status === 'COMPLETED' || (item.id === JR_VOE_ROW_ID && item.status === 'NOT_REQUIRED')
    );
    const allProofAttached = normalizedItems.every((item) =>
      isJrChecklistProofRequired(item) ? getJrChecklistProofAttachments(item).length > 0 : true
    );

    await prisma.task.update({
      where: { id: taskId },
      data: {
        submissionData: dataObj as Prisma.JsonObject,
        workflowState:
          allCompleted && allProofAttached
            ? TaskWorkflowState.READY_TO_COMPLETE
            : TaskWorkflowState.NONE,
      },
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to save JR checklist:', error);
    return { success: false, error: 'Failed to save JR checklist.' };
  }
}

export async function addJrProcessorNote(taskId: string, note: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) {
      return { success: false, error: 'Not authenticated.' };
    }

    const message = String(note ?? '').trim();
    if (!message) {
      return { success: false, error: 'Note cannot be empty.' };
    }

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        workflowState: true,
        assignedRole: true,
        assignedUserId: true,
        submissionData: true,
      },
    });

    if (!existing) return { success: false, error: 'Task not found.' };
    if (existing.kind !== TaskKind.VA_HOI) {
      return { success: false, error: 'Only JR Processor tasks support JR notes.' };
    }
    if (existing.status === TaskStatus.COMPLETED) {
      return {
        success: false,
        error: 'JR notes are locked after task completion. Ask a manager to reopen the task.',
      };
    }

    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    const canManageJrTask =
      (role === UserRole.PROCESSOR_JR &&
        !isJrTaskOwnedByDifferentUser(existing, userId)) ||
      existing.assignedUserId === userId;
    if (!canManageAll && !canManageJrTask) {
      return { success: false, error: 'Not authorized to add a JR note.' };
    }
    if (!canBypassDeskStartLock(role) && isStartLockedDeskTask(existing)) {
      return { success: false, error: 'Start this task before adding JR notes.' };
    }

    const dataObj = appendSubmissionHistoryEntry(existing.submissionData, {
      author: session?.user?.name || 'Team Member',
      role,
      message,
      entryType: 'note',
    });

    await prisma.task.update({
      where: { id: taskId },
      data: {
        submissionData: dataObj,
      },
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to add JR note:', error);
    return { success: false, error: 'Failed to add JR note.' };
  }
}

export async function releaseJrTaskToQueue(taskId: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) {
      return { success: false, error: 'Not authenticated.' };
    }

    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    const canRelease = canManageAll || role === UserRole.PROCESSOR_JR;
    if (!canRelease) {
      return { success: false, error: 'Not authorized to release JR tasks.' };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        workflowState: true,
        assignedUserId: true,
        assignedUser: { select: { name: true } },
        assignedRole: true,
        submissionData: true,
      },
    });
    if (!task) return { success: false, error: 'Task not found.' };
    if (task.kind !== TaskKind.VA_HOI) {
      return { success: false, error: 'Only JR Processor tasks can be released.' };
    }
    if (task.status === TaskStatus.COMPLETED) {
      return { success: false, error: 'Completed JR tasks cannot be released.' };
    }
    if (!canManageAll && task.assignedUserId !== userId) {
      return { success: false, error: 'Only the assigned JR can release this task.' };
    }
    if (
      task.assignedUserId === null &&
      task.status === TaskStatus.PENDING &&
      task.workflowState === TaskWorkflowState.NONE
    ) {
      return { success: true };
    }

    const actorName = session?.user?.name || 'Team Member';
    let updatedSubmissionData = appendLifecycleHistoryEvent(task.submissionData, {
      actorName,
      actorRole: role,
      eventType: 'ASSIGNMENT_CHANGED',
      fromStatus: task.status,
      toStatus: TaskStatus.PENDING,
      fromWorkflow: task.workflowState,
      toWorkflow: TaskWorkflowState.NONE,
      fromAssignedUserId: task.assignedUserId,
      toAssignedUserId: null,
      fromAssignedUserName: task.assignedUser?.name || null,
      toAssignedUserName: null,
      fromAssignedRole: task.assignedRole,
      toAssignedRole: task.assignedRole,
      note: 'Released JR task back to public queue.',
    });
    updatedSubmissionData = appendSubmissionHistoryEntry(
      updatedSubmissionData as Prisma.JsonValue,
      {
      author: actorName,
      role,
      message: 'Released JR task back to New JR Processor Requests.',
      entryType: 'status',
      }
    );

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.PENDING,
        workflowState: TaskWorkflowState.NONE,
        assignedUserId: null,
        submissionData: updatedSubmissionData as Prisma.InputJsonValue,
      },
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to release JR task:', error);
    return { success: false, error: 'Failed to release JR task.' };
  }
}

export async function releaseVaSpecialistTaskToQueue(taskId: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) {
      return { success: false, error: 'Not authenticated.' };
    }

    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    const isVaSpecialistRole =
      role === UserRole.VA_TITLE ||
      role === UserRole.VA_PAYOFF ||
      role === UserRole.VA_APPRAISAL ||
      role === UserRole.VA;
    if (!canManageAll && !isVaSpecialistRole) {
      return { success: false, error: 'Not authorized to release VA tasks.' };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        workflowState: true,
        assignedUserId: true,
        assignedUser: { select: { name: true } },
        assignedRole: true,
        submissionData: true,
      },
    });
    if (!task) return { success: false, error: 'Task not found.' };

    const isVaSpecialistKind =
      task.kind === TaskKind.VA_TITLE ||
      task.kind === TaskKind.VA_PAYOFF ||
      task.kind === TaskKind.VA_APPRAISAL;
    if (!isVaSpecialistKind) {
      return { success: false, error: 'Only VA specialist tasks can be released.' };
    }
    if (task.status === TaskStatus.COMPLETED) {
      return { success: false, error: 'Completed VA tasks cannot be released.' };
    }
    if (task.workflowState !== TaskWorkflowState.NONE) {
      return {
        success: false,
        error:
          'Cannot release a VA task once it has been sent to the LO. Reset the workflow first.',
      };
    }
    if (!canManageAll && task.assignedUserId !== userId) {
      return { success: false, error: 'Only the assigned VA can release this task.' };
    }
    if (task.assignedUserId === null && task.status === TaskStatus.PENDING) {
      return { success: true };
    }

    const actorName = session?.user?.name || 'Team Member';
    let updatedSubmissionData = appendLifecycleHistoryEvent(task.submissionData, {
      actorName,
      actorRole: role,
      eventType: 'ASSIGNMENT_CHANGED',
      fromStatus: task.status,
      toStatus: TaskStatus.PENDING,
      fromWorkflow: task.workflowState,
      toWorkflow: TaskWorkflowState.NONE,
      fromAssignedUserId: task.assignedUserId,
      toAssignedUserId: null,
      fromAssignedUserName: task.assignedUser?.name || null,
      toAssignedUserName: null,
      fromAssignedRole: task.assignedRole,
      toAssignedRole: task.assignedRole,
      note: 'Released VA task back to public queue.',
    });
    updatedSubmissionData = appendSubmissionHistoryEntry(
      updatedSubmissionData as Prisma.JsonValue,
      {
        author: actorName,
        role,
        message: 'Released this VA task back to the New queue.',
        entryType: 'status',
      }
    );

    const updateResult = await prisma.task.updateMany({
      where: {
        id: taskId,
        assignedUserId: { not: null },
        workflowState: TaskWorkflowState.NONE,
        status: { not: TaskStatus.COMPLETED },
      },
      data: {
        status: TaskStatus.PENDING,
        workflowState: TaskWorkflowState.NONE,
        assignedUserId: null,
        submissionData: updatedSubmissionData as Prisma.InputJsonValue,
      },
    });
    if (updateResult.count === 0) {
      return {
        success: false,
        error: 'Task state changed; refresh and try again.',
      };
    }

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to release VA task:', error);
    return { success: false, error: 'Failed to release VA task.' };
  }
}

export async function reopenCompletedVaTaskToNew(taskId: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    if (!role) {
      return { success: false, error: 'Not authenticated.' };
    }

    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    if (!canManageAll) {
      return { success: false, error: 'Only Admin/Manager can reopen completed VA tasks.' };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        workflowState: true,
        assignedUserId: true,
        assignedUser: { select: { name: true } },
        assignedRole: true,
        submissionData: true,
      },
    });
    if (!task) return { success: false, error: 'Task not found.' };

    const isCompletedVaTask =
      task.status === TaskStatus.COMPLETED &&
      (task.kind === TaskKind.VA_TITLE ||
        task.kind === TaskKind.VA_PAYOFF ||
        task.kind === TaskKind.VA_APPRAISAL);
    if (!isCompletedVaTask) {
      return { success: false, error: 'Only completed VA tasks can be returned to New.' };
    }

    const actorName = session?.user?.name || 'Team Member';
    let updatedSubmissionData = appendLifecycleHistoryEvent(task.submissionData, {
      actorName,
      actorRole: role,
      eventType: 'STATUS_CHANGED',
      fromStatus: task.status,
      toStatus: TaskStatus.PENDING,
      fromWorkflow: task.workflowState,
      toWorkflow: TaskWorkflowState.NONE,
      fromAssignedUserId: task.assignedUserId,
      toAssignedUserId: null,
      fromAssignedUserName: task.assignedUser?.name || null,
      toAssignedUserName: null,
      fromAssignedRole: task.assignedRole,
      toAssignedRole: task.assignedRole,
      note: 'Manager returned completed VA task to New.',
    });
    updatedSubmissionData = appendSubmissionHistoryEntry(
      updatedSubmissionData as Prisma.JsonValue,
      {
        author: actorName,
        role,
        message: 'Manager returned this completed VA task to the New bucket.',
        entryType: 'status',
      }
    );

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.PENDING,
        workflowState: TaskWorkflowState.NONE,
        completedAt: null,
        assignedUserId: null,
        submissionData: updatedSubmissionData as Prisma.InputJsonValue,
      },
    });

    await dispatchTaskWorkflowNotification({
      taskId,
      eventLabel: 'Task Reopened to New',
      changedBy: actorName,
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to reopen completed VA task:', error);
    return { success: false, error: 'Failed to return task to New.' };
  }
}

export async function returnCompletedJrTaskToAssigned(
  taskId: string,
  note?: string
) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    if (!role) {
      return { success: false, error: 'Not authenticated.' };
    }

    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    if (!canManageAll) {
      return {
        success: false,
        error: 'Only Admin/Manager can return completed JR tasks.',
      };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        workflowState: true,
        assignedUserId: true,
        assignedUser: { select: { name: true } },
        assignedRole: true,
        submissionData: true,
      },
    });
    if (!task) return { success: false, error: 'Task not found.' };
    if (task.kind !== TaskKind.VA_HOI) {
      return {
        success: false,
        error: 'Only JR Processor tasks can be returned to Assigned.',
      };
    }
    if (task.status !== TaskStatus.COMPLETED) {
      return {
        success: false,
        error: 'Only completed JR tasks can be returned to Assigned.',
      };
    }
    if (!task.assignedUserId) {
      return {
        success: false,
        error:
          'This completed JR task has no assignee. Reassign it to a JR processor before returning it.',
      };
    }

    const actorName = session?.user?.name || 'Team Member';
    const trimmedNote = (note || '').trim();
    const defaultReason = 'Manager returned completed JR task for revisions.';
    const lifecycleNote = trimmedNote
      ? `${defaultReason} Reason: ${trimmedNote}`
      : defaultReason;
    const historyMessage = trimmedNote
      ? `Manager returned this completed JR task to Assigned for revisions. Reason: ${trimmedNote}`
      : 'Manager returned this completed JR task to Assigned for revisions.';

    let updatedSubmissionData = appendLifecycleHistoryEvent(task.submissionData, {
      actorName,
      actorRole: role,
      eventType: 'STATUS_CHANGED',
      fromStatus: task.status,
      toStatus: TaskStatus.IN_PROGRESS,
      fromWorkflow: task.workflowState,
      toWorkflow: TaskWorkflowState.NONE,
      fromAssignedUserId: task.assignedUserId,
      toAssignedUserId: task.assignedUserId,
      fromAssignedUserName: task.assignedUser?.name || null,
      toAssignedUserName: task.assignedUser?.name || null,
      fromAssignedRole: task.assignedRole,
      toAssignedRole: task.assignedRole,
      note: lifecycleNote,
    });
    updatedSubmissionData = appendSubmissionHistoryEntry(
      updatedSubmissionData as Prisma.JsonValue,
      {
        author: actorName,
        role,
        message: historyMessage,
        entryType: 'status',
      }
    );

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: TaskStatus.IN_PROGRESS,
        workflowState: TaskWorkflowState.NONE,
        completedAt: null,
        submissionData: updatedSubmissionData as Prisma.InputJsonValue,
      },
    });

    await dispatchTaskWorkflowNotification({
      taskId,
      eventLabel: 'JR Task Returned to Assigned',
      changedBy: actorName,
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to return completed JR task:', error);
    return { success: false, error: 'Failed to return JR task.' };
  }
}

export async function reassignJrTask(taskId: string, nextAssignedUserId: string) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    if (!role) {
      return { success: false, error: 'Not authenticated.' };
    }
    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    if (!canManageAll) {
      return { success: false, error: 'Only Admin/Manager can reassign JR tasks.' };
    }

    const normalizedTargetId = String(nextAssignedUserId ?? '').trim();
    if (!normalizedTargetId) {
      return { success: false, error: 'Select a JR processor to reassign.' };
    }

    const [task, targetUser] = await Promise.all([
      prisma.task.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          kind: true,
          status: true,
          workflowState: true,
          assignedUserId: true,
          assignedUser: { select: { name: true } },
          assignedRole: true,
          submissionData: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: normalizedTargetId },
        select: { id: true, name: true, role: true, roles: true, active: true },
      }),
    ]);

    if (!task) return { success: false, error: 'Task not found.' };
    if (task.kind !== TaskKind.VA_HOI) {
      return { success: false, error: 'Only JR Processor tasks can be reassigned.' };
    }
    if (task.status === TaskStatus.COMPLETED) {
      return { success: false, error: 'Completed JR tasks cannot be reassigned.' };
    }
    const targetIsJr =
      targetUser?.role === UserRole.PROCESSOR_JR ||
      Boolean(targetUser?.roles?.includes(UserRole.PROCESSOR_JR));
    if (!targetUser || !targetUser.active || !targetIsJr) {
      return { success: false, error: 'Selected user is not an active JR processor.' };
    }
    if (task.assignedUserId === targetUser.id) {
      return { success: true };
    }

    const actorName = session?.user?.name || 'Team Member';
    let updatedSubmissionData = appendLifecycleHistoryEvent(task.submissionData, {
      actorName,
      actorRole: role,
      eventType: 'ASSIGNMENT_CHANGED',
      fromStatus: task.status,
      toStatus: task.status,
      fromWorkflow: task.workflowState,
      toWorkflow: task.workflowState,
      fromAssignedUserId: task.assignedUserId,
      toAssignedUserId: targetUser.id,
      fromAssignedUserName: task.assignedUser?.name || null,
      toAssignedUserName: targetUser.name || null,
      fromAssignedRole: task.assignedRole,
      toAssignedRole: task.assignedRole,
      note: `JR reassigned to ${targetUser.name || 'processor'}.`,
    });
    updatedSubmissionData = appendSubmissionHistoryEntry(
      updatedSubmissionData as Prisma.JsonValue,
      {
      author: actorName,
      role,
      message: `JR task reassigned to ${targetUser.name || 'processor'}.`,
      entryType: 'status',
      }
    );

    await prisma.task.update({
      where: { id: taskId },
      data: {
        assignedUserId: targetUser.id,
        submissionData: updatedSubmissionData as Prisma.InputJsonValue,
      },
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to reassign JR task:', error);
    return { success: false, error: 'Failed to reassign JR task.' };
  }
}

export async function startDisclosureRequest(taskId: string) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canStart =
      isAdmin(role) ||
      role === UserRole.MANAGER ||
      role === UserRole.DISCLOSURE_SPECIALIST;
    if (!canStart) {
      return {
        success: false,
        error: 'Only Disclosure, Manager, or Admin can start this request.',
      };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        title: true,
        status: true,
        workflowState: true,
        assignedRole: true,
        assignedUserId: true,
        assignedUser: { select: { name: true } },
        submissionData: true,
      },
    });

    if (!task) return { success: false, error: 'Task not found.' };
    if (!isDisclosureSubmissionTask(task)) {
      return {
        success: false,
        error: 'Only disclosure submission requests can be started here.',
      };
    }
    if (task.status === TaskStatus.COMPLETED) {
      return { success: false, error: 'This request is already completed.' };
    }
    if (task.workflowState !== TaskWorkflowState.NONE) {
      return {
        success: false,
        error: 'This request has already moved beyond the new-request queue.',
      };
    }
    if (task.assignedUserId && task.assignedUserId !== userId) {
      const starterName = task.assignedUser?.name?.trim() || 'another specialist';
      return {
        success: false,
        error: `This request was already started by ${starterName}.`,
      };
    }

    const actorName = session?.user?.name || 'Team Member';
    const updatedSubmissionData = appendLifecycleHistoryEvent(task.submissionData, {
      actorName,
      actorRole: role,
      eventType: 'STARTED',
      fromStatus: task.status,
      toStatus: TaskStatus.IN_PROGRESS,
      fromWorkflow: task.workflowState,
      toWorkflow: task.workflowState,
      fromAssignedUserId: task.assignedUserId,
      toAssignedUserId: userId,
      fromAssignedUserName: task.assignedUser?.name || null,
      toAssignedUserName: actorName,
      fromAssignedRole: task.assignedRole,
      toAssignedRole: UserRole.DISCLOSURE_SPECIALIST,
      note: 'Disclosure request started.',
    }) as Prisma.JsonObject;

    const updateResult = await prisma.task.updateMany({
      where: {
        id: taskId,
        status: { not: TaskStatus.COMPLETED },
        workflowState: TaskWorkflowState.NONE,
        OR: [{ assignedUserId: null }, { assignedUserId: userId }],
      },
      data: {
        assignedUserId: userId,
        assignedRole: UserRole.DISCLOSURE_SPECIALIST,
        status: TaskStatus.IN_PROGRESS,
        submissionData: updatedSubmissionData,
      },
    });

    if (updateResult.count === 0) {
      const freshTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { assignedUser: { select: { name: true } } },
      });
      const starterName = freshTask?.assignedUser?.name?.trim() || 'another specialist';
      return {
        success: false,
        error: `This request was already started by ${starterName}.`,
      };
    }

    await dispatchTaskWorkflowNotification({
      taskId,
      eventLabel: 'Disclosure Request Started',
      changedBy: session?.user?.name,
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to start disclosure request:', error);
    return { success: false, error: 'Failed to start disclosure request.' };
  } finally {
    recordPerfMetric('action.startDisclosureRequest', Date.now() - perfStartedAt, {
      taskId,
    });
  }
}

export async function startQcRequest(taskId: string) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canStart =
      isAdmin(role) ||
      role === UserRole.MANAGER ||
      role === UserRole.PROCESSOR_JR;
    if (!canStart) {
      return {
        success: false,
        error: 'Only Jr Processors, Manager, or Admin can start this request.',
      };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        kind: true,
        assignedRole: true,
        status: true,
        workflowState: true,
        assignedUserId: true,
        assignedUser: { select: { name: true } },
        submissionData: true,
      },
    });

    if (!task) return { success: false, error: 'Task not found.' };
    if (!isQcStyleSubmissionTask(task)) {
      return {
        success: false,
        error: 'Only Processing submission requests can be started here.',
      };
    }
    if (task.status === TaskStatus.COMPLETED) {
      return { success: false, error: 'This request is already completed.' };
    }
    if (task.workflowState !== TaskWorkflowState.NONE) {
      return {
        success: false,
        error: 'This request has already moved beyond the new-request queue.',
      };
    }
    if (task.assignedUserId && task.assignedUserId !== userId) {
      const starterName = task.assignedUser?.name?.trim() || 'another specialist';
      return {
        success: false,
        error: `This request was already started by ${starterName}.`,
      };
    }

    const actorName = session?.user?.name || 'Unknown';
    let updatedSubmissionData = appendSubmissionHistoryEntry(task.submissionData, {
      author: session?.user?.name || 'Unknown',
      role,
      message: 'Processing request started.',
      entryType: 'status',
    });
    updatedSubmissionData = appendLifecycleHistoryEvent(updatedSubmissionData, {
      actorName,
      actorRole: role,
      eventType: 'STARTED',
      fromStatus: task.status,
      toStatus: TaskStatus.IN_PROGRESS,
      fromWorkflow: task.workflowState,
      toWorkflow: task.workflowState,
      fromAssignedUserId: task.assignedUserId,
      toAssignedUserId: userId,
      fromAssignedUserName: task.assignedUser?.name || null,
      toAssignedUserName: actorName,
      fromAssignedRole: task.assignedRole,
      toAssignedRole: UserRole.PROCESSOR_JR,
      note: 'Processing request started.',
    }) as Prisma.JsonObject;

    const updateResult = await prisma.task.updateMany({
      where: {
        id: taskId,
        status: { not: TaskStatus.COMPLETED },
        workflowState: TaskWorkflowState.NONE,
        OR: [{ assignedUserId: null }, { assignedUserId: userId }],
      },
      data: {
        assignedUserId: userId,
        assignedRole: UserRole.PROCESSOR_JR,
        status: TaskStatus.IN_PROGRESS,
        submissionData: updatedSubmissionData,
      },
    });

    if (updateResult.count === 0) {
      const freshTask = await prisma.task.findUnique({
        where: { id: taskId },
        select: { assignedUser: { select: { name: true } } },
      });
      const starterName = freshTask?.assignedUser?.name?.trim() || 'another specialist';
      return {
        success: false,
        error: `This request was already started by ${starterName}.`,
      };
    }

    await dispatchTaskWorkflowNotification({
      taskId,
      eventLabel: 'Processing Request Started',
      changedBy: session?.user?.name,
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to start processing request:', error);
    return { success: false, error: 'Failed to start processing request.' };
  } finally {
    recordPerfMetric('action.startQcRequest', Date.now() - perfStartedAt, {
      taskId,
    });
  }
}

export async function updateProcessingRoute(
  taskId: string,
  input: {
    processingMethod: string;
    processingAssignmentGroup?: string | null;
  }
) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canUpdate =
      isAdmin(role) || role === UserRole.MANAGER || role === UserRole.PROCESSOR_JR;
    if (!canUpdate) {
      return {
        success: false,
        error: 'Only Jr Processors, Manager, or Admin can change the Processing route.',
      };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        workflowState: true,
        assignedUserId: true,
        assignedRole: true,
        dueDate: true,
        completedAt: true,
        assignedUser: { select: { name: true } },
        submissionData: true,
      },
    });

    if (!task) return { success: false, error: 'Task not found.' };
    if (task.kind !== TaskKind.SUBMIT_PROCESSING) {
      return {
        success: false,
        error: 'Only Submit to Processing requests can have their Processing route changed.',
      };
    }

    const processingMethod = String(input.processingMethod ?? '').trim();
    if (!isProcessingMethod(processingMethod)) {
      return { success: false, error: 'Please select a valid Processing Method.' };
    }

    let processingAssignmentGroup: string | null = null;
    if (processingMethod === PROCESSING_METHOD_IN_HOUSE) {
      const assignmentGroup = String(input.processingAssignmentGroup ?? '').trim();
      if (!isInHouseProcessingAssignmentGroup(assignmentGroup)) {
        return {
          success: false,
          error: 'Please select an in-house Processor for in-house Processing.',
        };
      }
      processingAssignmentGroup = assignmentGroup;
    } else if (processingMethod === PROCESSING_METHOD_THIRD_PARTY) {
      processingAssignmentGroup = PROCESSING_ASSIGNMENT_THIRD_PARTY;
    } else if (processingMethod === PROCESSING_METHOD_SELF_PROCESSED) {
      processingAssignmentGroup = null;
    }

    if (
      processingAssignmentGroup &&
      !isProcessingAssignmentGroup(processingAssignmentGroup)
    ) {
      return { success: false, error: 'Please select a valid Processing route.' };
    }

    const openLoChildCount = await prisma.task.count({
      where: {
        parentTaskId: task.id,
        kind: TaskKind.LO_NEEDS_INFO,
        status: { not: TaskStatus.COMPLETED },
      },
    });
    const hasOpenLoChild = openLoChildCount > 0;
    const isSelfProcessed = processingMethod === PROCESSING_METHOD_SELF_PROCESSED;
    if (hasOpenLoChild && isSelfProcessed) {
      return {
        success: false,
        error:
          'This Processing request is waiting on the Loan Officer. Close or resolve the open LO request before marking it Self Processed.',
      };
    }
    const methodLabel = getProcessingMethodLabel(processingMethod);
    const assignmentLabel = getProcessingAssignmentLabel(processingAssignmentGroup);
    const actorName = session?.user?.name || 'Team Member';
    const routeText = assignmentLabel ? `${methodLabel} - ${assignmentLabel}` : methodLabel;
    const dataObj =
      task.submissionData && typeof task.submissionData === 'object' && !Array.isArray(task.submissionData)
        ? { ...(task.submissionData as Record<string, unknown>) }
        : {};
    dataObj.processingMethod = processingMethod;
    dataObj.processingMethodLabel = methodLabel;
    dataObj.processingAssignmentGroup = processingAssignmentGroup;
    dataObj.processingAssignmentLabel = assignmentLabel;

    let updatedSubmissionData = appendSubmissionHistoryEntry(dataObj as Prisma.JsonObject, {
      author: actorName,
      role,
      message: `Processing route changed to ${routeText}.`,
      entryType: 'status',
    });

    const shouldRequeue =
      !isSelfProcessed &&
      task.workflowState === TaskWorkflowState.NONE &&
      !hasOpenLoChild;
    const nextStatus = isSelfProcessed
      ? TaskStatus.COMPLETED
      : shouldRequeue
      ? TaskStatus.PENDING
      : task.status;
    const nextWorkflowState = isSelfProcessed
      ? TaskWorkflowState.NONE
      : shouldRequeue
      ? TaskWorkflowState.NONE
      : task.workflowState;
    const nextAssignedUserId = shouldRequeue || isSelfProcessed ? null : task.assignedUserId;
    const nextAssignedRole = isSelfProcessed ? null : task.assignedRole || UserRole.PROCESSOR_JR;
    updatedSubmissionData = appendLifecycleHistoryEvent(updatedSubmissionData, {
      actorName,
      actorRole: role,
      eventType: isSelfProcessed ? 'COMPLETED' : 'ASSIGNMENT_CHANGED',
      fromStatus: task.status,
      toStatus: nextStatus,
      fromWorkflow: task.workflowState,
      toWorkflow: nextWorkflowState,
      fromAssignedUserId: task.assignedUserId,
      toAssignedUserId: nextAssignedUserId,
      fromAssignedUserName: task.assignedUser?.name || null,
      toAssignedUserName: shouldRequeue || isSelfProcessed ? null : task.assignedUser?.name || null,
      fromAssignedRole: task.assignedRole,
      toAssignedRole: nextAssignedRole,
      note: `Processing route changed to ${routeText}.`,
    }) as Prisma.JsonObject;

    await prisma.task.update({
      where: { id: task.id },
      data: {
        submissionData: updatedSubmissionData,
        assignedUserId: nextAssignedUserId,
        assignedRole: nextAssignedRole,
        status: nextStatus,
        workflowState: nextWorkflowState,
        completedAt: isSelfProcessed ? new Date() : task.completedAt,
        dueDate: isSelfProcessed
          ? null
          : nextStatus === TaskStatus.COMPLETED
          ? task.dueDate
          : task.dueDate || new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to update processing route:', error);
    return { success: false, error: 'Failed to update Processing route.' };
  } finally {
    recordPerfMetric('action.updateProcessingRoute', Date.now() - perfStartedAt, {
      taskId,
    });
  }
}

export async function requestInfoFromLoanOfficer(taskId: string, input: RequestInfoInput) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canRequest =
      isAdmin(role) ||
      role === UserRole.MANAGER ||
      role === UserRole.DISCLOSURE_SPECIALIST ||
      role === UserRole.PROCESSOR_JR;

    if (!canRequest) {
      return { success: false, error: 'Not authorized.' };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: { loan: { select: { loanOfficerId: true } } },
    });
    if (!task) return { success: false, error: 'Task not found.' };

    const parentAttachments = await prisma.taskAttachment.findMany({
      where: { taskId },
      select: {
        clientDocumentId: true,
        purpose: true,
        storagePath: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        uploadedById: true,
      },
    });

    const isVaLoResponseTask =
      task.kind === TaskKind.VA_APPRAISAL || task.kind === TaskKind.VA_PAYOFF;
    if (!isSubmissionTask(task) && !isVaLoResponseTask) {
      return {
        success: false,
        error:
          'This action is only supported for disclosure/processing submissions and legacy Appraisal Specialist/Payoff tasks.',
      };
    }
    if (!canBypassDeskStartLock(role) && isStartLockedDeskTask(task)) {
      return {
        success: false,
        error: 'Start this task before sending updates back to the Loan Officer.',
      };
    }
    const qcSubmissionTask = isQcStyleSubmissionTask(task);
    const processingSubmissionTask = isProcessingSubmissionTask(task);
    const normalizedReason = input.reason;
    const normalizedMessage = input.message?.trim() || '';
    const parsedQcChecklist = qcSubmissionTask ? parseQcChecklistInput(input.qcChecklist) : null;
    const hasRedXChecklistItems = Boolean(
      parsedQcChecklist?.items.some(
        (item) => item.noteOption === 'MISSING_FROM_FILE' || item.status === 'RED_X'
      )
    );
    const allChecklistItemsGreen = Boolean(
      parsedQcChecklist?.items.length &&
        parsedQcChecklist.items.every((item) =>
          item.noteOption === 'CONFIRMED_IN_FILE' ||
          item.noteOption === 'NOT_NEEDED' ||
          item.noteOption === 'FREE_AND_CLEAR' ||
          item.noteOption === 'PURCHASE_NOT_NEEDED' ||
          item.noteOption === 'NOT_APPLICABLE'
        )
    );
    const effectiveMessage = normalizedMessage;

    if (qcSubmissionTask) {
      const isAllowedQcAction =
        normalizedReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES ||
        normalizedReason === DisclosureDecisionReason.MISSING_ITEMS;
      if (!isAllowedQcAction) {
        return {
          success: false,
          error: 'Processing action must be either Complete Processing or Missing Items.',
        };
      }
      if (!parsedQcChecklist) {
        return {
          success: false,
          error: 'Please complete the Processing checklist before submitting the action.',
        };
      }
      if (
        normalizedReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES &&
        hasRedXChecklistItems
      ) {
        return {
          success: false,
          error: 'Complete Processing is blocked while any checklist item is marked Red X.',
        };
      }
      if (
        normalizedReason === DisclosureDecisionReason.MISSING_ITEMS &&
        allChecklistItemsGreen
      ) {
        return {
          success: false,
          error: 'Missing Items is blocked while all checklist items are green.',
        };
      }
      if (!normalizedMessage) {
        return {
          success: false,
          error: 'Please add general Processing notes before submitting the Processing action.',
        };
      }
    }

    if (isVaLoResponseTask && normalizedReason !== DisclosureDecisionReason.MISSING_ITEMS) {
      return {
        success: false,
        error:
          'Appraisal Specialist and Payoff can only send Missing/Incomplete items back to LO.',
      };
    }

    const requiresProofForRouting =
      !qcSubmissionTask &&
      normalizedReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
    if (requiresProofForRouting) {
      const proofCount = await prisma.taskAttachment.count({
        where: { taskId, purpose: 'PROOF' },
      });
      if (proofCount < 1) {
        return {
          success: false,
          error: 'Upload proof/error attachment before sending this back to LO.',
        };
      }
    }

    const existingOpenLoTask = await prisma.task.findFirst({
      where: {
        parentTaskId: taskId,
        kind: TaskKind.LO_NEEDS_INFO,
        status: { not: TaskStatus.COMPLETED },
      },
      select: { id: true },
    });

    const isQcCompleteAction =
      qcSubmissionTask &&
      normalizedReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;

    const actorName = session?.user?.name || 'Unknown';
    await prisma.$transaction(async (tx) => {
      const noteEntry = effectiveMessage
        ? {
        author: session?.user?.name || 'Unknown',
        role: role,
        message: effectiveMessage,
        date: new Date().toISOString(),
        ...(parsedQcChecklist
          ? {
              entryType: 'qcChecklist',
              checklist: parsedQcChecklist.items,
            }
          : {}),
      }
        : null;

      let updatedSubmissionData = task.submissionData;
      if (noteEntry) {
        const dataObj = (task.submissionData && typeof task.submissionData === 'object')
          ? { ...(task.submissionData as Record<string, unknown>) }
          : {};
        const existingNotes = Array.isArray(dataObj.notesHistory) ? [...dataObj.notesHistory] : [];
        const notes = parsedQcChecklist
          ? existingNotes.filter(
              (entry) =>
                !(
                  entry &&
                  typeof entry === 'object' &&
                  (entry as { entryType?: unknown }).entryType === 'qcChecklist'
                )
            )
          : existingNotes;
        notes.push(noteEntry);
        dataObj.notesHistory = notes;
        updatedSubmissionData = dataObj as Prisma.JsonObject;
      }

      const routedWorkflowState =
        qcSubmissionTask
          ? TaskWorkflowState.WAITING_ON_LO
          : normalizedReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
          ? TaskWorkflowState.WAITING_ON_LO_APPROVAL
          : TaskWorkflowState.WAITING_ON_LO;
      updatedSubmissionData = appendLifecycleHistoryEvent(updatedSubmissionData, {
        actorName,
        actorRole: role,
        eventType: isQcCompleteAction ? 'COMPLETED' : 'ROUTED_TO_LO',
        fromStatus: task.status,
        toStatus: isQcCompleteAction ? TaskStatus.COMPLETED : TaskStatus.BLOCKED,
        fromWorkflow: task.workflowState,
        toWorkflow: isQcCompleteAction ? TaskWorkflowState.NONE : routedWorkflowState,
        fromAssignedUserId: task.assignedUserId,
        toAssignedUserId: task.assignedUserId,
        fromAssignedRole: task.assignedRole,
        toAssignedRole: task.assignedRole,
        note: effectiveMessage || null,
      }) as Prisma.JsonObject;

      if (isQcCompleteAction) {
        await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.COMPLETED,
            disclosureReason: normalizedReason,
            workflowState: TaskWorkflowState.NONE,
            completedAt: new Date(),
            description: effectiveMessage || null,
            loanOfficerApprovedAt: null,
            submissionData: updatedSubmissionData ?? undefined,
          },
        });

        if (existingOpenLoTask) {
          await tx.task.update({
            where: { id: existingOpenLoTask.id },
            data: {
              status: TaskStatus.COMPLETED,
              completedAt: new Date(),
              description: processingSubmissionTask
                ? 'Closed automatically after Processing completion.'
                : 'Closed automatically after QC completion.',
            },
          });
        }
      } else {
        await tx.task.update({
          where: { id: taskId },
          data: {
            status: TaskStatus.BLOCKED,
            disclosureReason: normalizedReason,
            workflowState: routedWorkflowState,
            loanOfficerApprovedAt: null,
            submissionData: updatedSubmissionData ?? undefined,
          },
        });
      }

      if (!isQcCompleteAction) {
        let loChildTaskId: string;
        if (existingOpenLoTask) {
          await tx.task.update({
            where: { id: existingOpenLoTask.id },
            data: {
              title:
                !qcSubmissionTask &&
                normalizedReason ===
                  DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
                  ? 'LO: Approve Initial Disclosures'
                  : 'LO: Needs Info',
              disclosureReason: normalizedReason,
              description: effectiveMessage || null,
              submissionData: updatedSubmissionData ?? undefined,
              status: TaskStatus.PENDING,
              priority: TaskPriority.HIGH,
              assignedUserId: task.loan.loanOfficerId,
              assignedRole: UserRole.LOAN_OFFICER,
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
              completedAt: null,
            },
          });
          loChildTaskId = existingOpenLoTask.id;
        } else {
          const loChildTask = await tx.task.create({
            data: {
              loanId: task.loanId,
              parentTaskId: taskId,
              title:
                !qcSubmissionTask &&
                normalizedReason ===
                  DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
                  ? 'LO: Approve Initial Disclosures'
                  : 'LO: Needs Info',
              kind: TaskKind.LO_NEEDS_INFO,
              disclosureReason: normalizedReason,
              description: effectiveMessage || null,
              submissionData: updatedSubmissionData ?? undefined,
              status: TaskStatus.PENDING,
              priority: TaskPriority.HIGH,
              assignedUserId: task.loan.loanOfficerId,
              assignedRole: UserRole.LOAN_OFFICER,
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
            },
            select: { id: true },
          });
          loChildTaskId = loChildTask.id;
        }

        if (parentAttachments.length > 0 && !existingOpenLoTask) {
          await tx.taskAttachment.createMany({
            data: parentAttachments.map((att) => ({
              taskId: loChildTaskId,
              clientDocumentId: att.clientDocumentId,
              purpose: att.purpose,
              storagePath: att.storagePath,
              filename: att.filename,
              contentType: att.contentType,
              sizeBytes: att.sizeBytes,
              uploadedById: att.uploadedById || userId,
            })),
          });
        }
      }
    });

    if (isQcCompleteAction && task.kind === TaskKind.SUBMIT_QC) {
      const createdVaTasks = await ensureVaTasksForLoanFromQcCompletion(task.loanId, task.id);
      await dispatchVaFanoutNotifications({
        loanId: task.loanId,
        createdTasks: createdVaTasks,
        changedBy: session?.user?.name || null,
      });
    }

    await dispatchTaskWorkflowNotification({
      taskId,
      eventLabel: isQcCompleteAction ? 'Task Completed' : 'Sent to Loan Officer',
      changedBy: session?.user?.name,
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to request info:', error);
    return { success: false, error: 'Failed to request info.' };
  } finally {
    recordPerfMetric('action.requestInfoFromLoanOfficer', Date.now() - perfStartedAt, {
      taskId,
      reason: input.reason,
    });
  }
}

export async function respondToDisclosureRequest(
  taskId: string,
  responseMessage: string
) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        description: true,
        parentTaskId: true,
        assignedRole: true,
        assignedUserId: true,
        disclosureReason: true,
        submissionData: true,
        loan: {
          select: {
            loanOfficerId: true,
            secondaryLoanOfficerId: true,
            visibilitySubmitterUserId: true,
          },
        },
      },
    });

    if (!task) return { success: false, error: 'Task not found.' };
    if (task.kind !== TaskKind.LO_NEEDS_INFO || !task.parentTaskId) {
      const isParentVaOrSubmission =
        task.kind === TaskKind.VA_APPRAISAL ||
        task.kind === TaskKind.VA_PAYOFF ||
        task.kind === TaskKind.SUBMIT_DISCLOSURES ||
        task.kind === TaskKind.SUBMIT_QC ||
        task.kind === TaskKind.SUBMIT_PROCESSING;
      if (isParentVaOrSubmission) {
        const childLoTask = await prisma.task.findFirst({
          where: {
            parentTaskId: taskId,
            kind: TaskKind.LO_NEEDS_INFO,
            status: { not: TaskStatus.COMPLETED },
          },
          select: { id: true },
        });
        if (childLoTask) {
          return respondToDisclosureRequest(childLoTask.id, responseMessage);
        }
      }
      return { success: false, error: 'This task does not support LO responses.' };
    }
    if (task.status === TaskStatus.COMPLETED) {
      return { success: false, error: 'This LO response task is already completed.' };
    }

    const parentTask = await prisma.task.findUnique({
      where: { id: task.parentTaskId },
      select: {
        submissionData: true,
        status: true,
        workflowState: true,
        assignedUserId: true,
        assignedRole: true,
      },
    });
    if (!parentTask) return { success: false, error: 'Parent task not found.' };

    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    const isVisibleLoanOfficerResponder =
      role === UserRole.LOAN_OFFICER && task.loan && canLoanOfficerViewLoan(task.loan, userId);
    const isLoanOfficerAssistantResponder =
      role === UserRole.LOA &&
      (task.assignedRole === UserRole.LOAN_OFFICER ||
        task.assignedRole === UserRole.LOA ||
        task.assignedUserId === userId);
    const canRespond =
      canManageAll ||
      (role === UserRole.LOAN_OFFICER &&
        (task.assignedUserId === userId || isVisibleLoanOfficerResponder)) ||
      isLoanOfficerAssistantResponder;
    if (!canRespond) return { success: false, error: 'Not authorized.' };

    await prisma.$transaction(async (tx) => {
      const stampedResponse = responseMessage.trim()
        ? `${task.description ? `${task.description}\n\n` : ''}LO Response: ${responseMessage.trim()}`
        : task.description;

      const noteEntry = responseMessage.trim() ? {
        author: session?.user?.name || 'Unknown',
        role: role,
        message: responseMessage.trim(),
        date: new Date().toISOString(),
      } : null;

      let updatedSubmissionData = parentTask.submissionData;
      if (noteEntry) {
        const dataObj = (parentTask.submissionData && typeof parentTask.submissionData === 'object')
          ? { ...(parentTask.submissionData as Record<string, unknown>) }
          : {};
        const notes = Array.isArray(dataObj.notesHistory) ? [...dataObj.notesHistory] : [];
        notes.push(noteEntry);
        dataObj.notesHistory = notes;
        updatedSubmissionData = dataObj as Prisma.JsonObject;
      }
      const actorName = session?.user?.name || 'Unknown';
      updatedSubmissionData = appendLifecycleHistoryEvent(updatedSubmissionData, {
        actorName,
        actorRole: role,
        eventType: 'LO_RESPONDED',
        fromStatus: parentTask.status,
        toStatus: TaskStatus.PENDING,
        fromWorkflow: parentTask.workflowState,
        toWorkflow: TaskWorkflowState.READY_TO_COMPLETE,
        fromAssignedUserId: parentTask.assignedUserId,
        toAssignedUserId: parentTask.assignedUserId,
        fromAssignedRole: parentTask.assignedRole,
        toAssignedRole: parentTask.assignedRole,
        note: responseMessage.trim() || null,
      }) as Prisma.JsonObject;

      await tx.task.update({
        where: { id: taskId },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt: new Date(),
          description: stampedResponse || null,
          submissionData: updatedSubmissionData ?? undefined,
        },
      });

      await tx.task.update({
        where: { id: task.parentTaskId! },
        data: {
          status: TaskStatus.PENDING,
          workflowState: TaskWorkflowState.READY_TO_COMPLETE,
          loanOfficerApprovedAt:
            task.disclosureReason ===
            DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
              ? new Date()
              : undefined,
          submissionData: updatedSubmissionData ?? undefined,
        },
      });
    });

    await dispatchTaskWorkflowNotification({
      taskId: task.parentTaskId,
      eventLabel: 'Loan Officer Responded',
      changedBy: session?.user?.name,
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to record LO response:', error);
    return { success: false, error: 'Failed to record LO response.' };
  }
}

export async function reviewInitialDisclosureFigures(input: {
  taskId: string;
  decision: 'APPROVE' | 'REVISION_REQUIRED';
  message?: string;
}) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const task = await prisma.task.findUnique({
      where: { id: input.taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        description: true,
        parentTaskId: true,
        assignedRole: true,
        assignedUserId: true,
        disclosureReason: true,
        submissionData: true,
        loan: {
          select: {
            loanOfficerId: true,
            secondaryLoanOfficerId: true,
            visibilitySubmitterUserId: true,
          },
        },
      },
    });

    if (!task) return { success: false, error: 'Task not found.' };
    if (task.kind !== TaskKind.LO_NEEDS_INFO || !task.parentTaskId) {
      return { success: false, error: 'This task does not support LO review.' };
    }
    if (
      task.disclosureReason !==
      DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
    ) {
      return {
        success: false,
        error:
          'This review action is only available for approval of initial disclosure figures.',
      };
    }
    if (task.status === TaskStatus.COMPLETED) {
      return { success: false, error: 'This review task is already completed.' };
    }

    const parentTask = await prisma.task.findUnique({
      where: { id: task.parentTaskId },
      select: {
        submissionData: true,
        status: true,
        workflowState: true,
        assignedUserId: true,
        assignedRole: true,
      },
    });
    if (!parentTask) return { success: false, error: 'Parent task not found.' };

    const canManageAll = isAdmin(role) || role === UserRole.MANAGER;
    const isVisibleLoanOfficerReviewer =
      role === UserRole.LOAN_OFFICER && task.loan && canLoanOfficerViewLoan(task.loan, userId);
    const isLoanOfficerAssistantReviewer =
      role === UserRole.LOA &&
      (task.assignedRole === UserRole.LOAN_OFFICER ||
        task.assignedRole === UserRole.LOA ||
        task.assignedUserId === userId);
    const canReview =
      canManageAll ||
      (role === UserRole.LOAN_OFFICER &&
        (task.assignedUserId === userId || isVisibleLoanOfficerReviewer)) ||
      isLoanOfficerAssistantReviewer;
    if (!canReview) return { success: false, error: 'Not authorized.' };

    const note = input.message?.trim();

    await prisma.$transaction(async (tx) => {
      const stampedResponse = note
        ? `${task.description ? `${task.description}\n\n` : ''}LO Review: ${note}`
        : task.description;

      const noteEntry = note ? {
        author: session?.user?.name || 'Unknown',
        role: role,
        message: `LO Review (${input.decision}): ${note}`,
        date: new Date().toISOString(),
      } : {
        author: session?.user?.name || 'Unknown',
        role: role,
        message: `LO Review: ${input.decision}`,
        date: new Date().toISOString(),
      };

      let updatedSubmissionData = parentTask.submissionData;
      const dataObj = (parentTask.submissionData && typeof parentTask.submissionData === 'object')
        ? { ...(parentTask.submissionData as Record<string, unknown>) }
        : {};
      const notes = Array.isArray(dataObj.notesHistory) ? [...dataObj.notesHistory] : [];
      notes.push(noteEntry);
      dataObj.notesHistory = notes;
      updatedSubmissionData = dataObj as Prisma.JsonObject;
      const actorName = session?.user?.name || 'Unknown';
      updatedSubmissionData = appendLifecycleHistoryEvent(updatedSubmissionData, {
        actorName,
        actorRole: role,
        eventType: 'LO_REVIEWED',
        fromStatus: parentTask.status,
        toStatus: TaskStatus.PENDING,
        fromWorkflow: parentTask.workflowState,
        toWorkflow: TaskWorkflowState.READY_TO_COMPLETE,
        fromAssignedUserId: parentTask.assignedUserId,
        toAssignedUserId: parentTask.assignedUserId,
        fromAssignedRole: parentTask.assignedRole,
        toAssignedRole: parentTask.assignedRole,
        note:
          note?.trim() ||
          (input.decision === 'APPROVE'
            ? 'Loan Officer approved initial disclosure figures.'
            : 'Loan Officer requested revision.'),
      }) as Prisma.JsonObject;

      await tx.task.update({
        where: { id: input.taskId },
        data: {
          status: TaskStatus.COMPLETED,
          completedAt: new Date(),
          description: stampedResponse || null,
          submissionData: updatedSubmissionData ?? undefined,
        },
      });

      if (input.decision === 'APPROVE') {
        await tx.task.update({
          where: { id: task.parentTaskId! },
          data: {
            status: TaskStatus.PENDING,
            workflowState: TaskWorkflowState.READY_TO_COMPLETE,
            loanOfficerApprovedAt: new Date(),
            submissionData: updatedSubmissionData ?? undefined,
          },
        });
      } else {
        await tx.task.update({
          where: { id: task.parentTaskId! },
          data: {
            status: TaskStatus.PENDING,
            workflowState: TaskWorkflowState.READY_TO_COMPLETE,
            disclosureReason: DisclosureDecisionReason.MISSING_ITEMS,
            loanOfficerApprovedAt: null,
            description: note
              ? `${note}\n\nRevision requested by LO.`
              : 'Revision requested by LO.',
            submissionData: updatedSubmissionData ?? undefined,
          },
        });
      }
    });

    await dispatchTaskWorkflowNotification({
      taskId: task.parentTaskId,
      eventLabel:
        input.decision === 'APPROVE'
          ? 'Loan Officer Approved Figures'
          : 'Loan Officer Requested Revision',
      changedBy: session?.user?.name,
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to review initial disclosure figures:', error);
    return { success: false, error: 'Failed to process LO review.' };
  }
}

export async function deleteTask(taskId: string) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    if (!canDeleteTasks(role)) {
      return { success: false, error: 'Not authorized to delete tasks.' };
    }

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        assignedRole: true,
        title: true,
      },
    });
    if (!existing) {
      return { success: false, error: 'Task not found.' };
    }
    if (!canDeleteTask(role, existing)) {
      return { success: false, error: 'Not authorized to delete this task.' };
    }

    const shouldSendDeleteNotification =
      isDisclosureSubmissionTask(existing) || isQcStyleSubmissionTask(existing);
    if (shouldSendDeleteNotification) {
      await dispatchTaskWorkflowNotification({
        taskId: existing.id,
        eventLabel: 'Request Deleted',
        changedBy: session?.user?.name || null,
      });
    }

    // Admin/Manager hard-delete supports any task state. Also remove direct
    // child handoff tasks so workflow chains don't leave orphaned items.
    await prisma.task.deleteMany({
      where: {
        OR: [{ id: taskId }, { parentTaskId: taskId }],
      },
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    revalidatePath('/team');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete task:', error);
    return { success: false, error: 'Failed to delete task.' };
  } finally {
    recordPerfMetric('action.deleteTask', Date.now() - perfStartedAt, {
      taskId,
    });
  }
}

export async function loadTaskBucketPage(input: {
  bucketId: string;
  sectionId?: string;
  cursor?: TaskBucketCursor;
  search?: string;
  globalSearch?: string;
  bucketSearch?: string;
  sort?: TaskBucketSort;
  pageSize?: number;
}) {
  const session = await getServerSession(authOptions);
  const role = normalizeSessionTaskRole(session?.user?.activeRole || session?.user?.role);
  if (!role || !canUsePagedTaskBuckets(role)) {
    return { success: false, error: 'Not authorized to load this task bucket.' };
  }

  try {
    const page = await queryTaskBucketPage({
      bucketId: input.bucketId,
      sectionId: input.sectionId,
      role,
      userId: session?.user?.id || undefined,
      cursor: input.cursor || null,
      search: input.search,
      globalSearch: input.globalSearch,
      bucketSearch: input.bucketSearch,
      sort: input.sort,
      pageSize: input.pageSize || TASK_BUCKET_PAGE_SIZE,
    });

    return {
      success: true,
      tasks: page.tasks,
      totalCount: page.totalCount,
      nextCursor: page.nextCursor,
      serverSort: page.serverSort,
    };
  } catch (error) {
    console.error('Failed to load task bucket page:', error);
    return { success: false, error: 'Failed to load task bucket.' };
  }
}

export async function loadTaskBucketCount(input: {
  bucketId: string;
  sectionId?: string;
  search?: string;
  globalSearch?: string;
  bucketSearch?: string;
}) {
  const session = await getServerSession(authOptions);
  const role = normalizeSessionTaskRole(session?.user?.activeRole || session?.user?.role);
  if (!role || !canUsePagedTaskBuckets(role)) {
    return { success: false, error: 'Not authorized to load this task bucket.' };
  }

  try {
    const totalCount = await queryTaskBucketCount({
      bucketId: input.bucketId,
      sectionId: input.sectionId,
      role,
      userId: session?.user?.id || undefined,
      search: input.search,
      globalSearch: input.globalSearch,
      bucketSearch: input.bucketSearch,
    });

    return {
      success: true,
      totalCount,
    };
  } catch (error) {
    console.error('Failed to load task bucket count:', error);
    return { success: false, error: 'Failed to load task bucket count.' };
  }
}

