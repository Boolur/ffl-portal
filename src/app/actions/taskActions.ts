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
import { recordPerfMetric } from '@/lib/perf';
import { appendLifecycleHistoryEvent } from '@/lib/taskLifecycleTimeline';
import { canLoanOfficerViewLoan } from '@/lib/loanOfficerVisibility';

function isSubmissionTask(task: {
  kind: TaskKind | null;
  assignedRole: UserRole | null;
  title: string;
}) {
  return (
    task.kind === TaskKind.SUBMIT_DISCLOSURES ||
    task.kind === TaskKind.SUBMIT_QC ||
    (task.assignedRole === UserRole.DISCLOSURE_SPECIALIST &&
      task.title.toLowerCase().includes('disclosure')) ||
    (task.assignedRole === UserRole.QC && task.title.toLowerCase().includes('qc'))
  );
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

const VA_TASK_BLUEPRINTS: Array<{
  kind: TaskKind;
  assignedRole: UserRole;
  title: string;
}> = [
  { kind: TaskKind.VA_TITLE, assignedRole: UserRole.VA_TITLE, title: 'VA: Title' },
  { kind: TaskKind.VA_HOI, assignedRole: UserRole.PROCESSOR_JR, title: 'HOI: Order Request' },
  { kind: TaskKind.VA_PAYOFF, assignedRole: UserRole.VA_PAYOFF, title: 'VA: Payoff' },
  { kind: TaskKind.VA_APPRAISAL, assignedRole: UserRole.VA_APPRAISAL, title: 'VA: Appraisal' },
];

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
                )}" alt="Federal First Lending" width="180" style="display:block;width:180px;max-width:180px;height:auto;max-height:44px;object-fit:contain;" />
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

type EmailAudience = 'LO' | 'DISCLOSURE' | 'QC' | 'VA';
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

async function kickInlineOutboxDrain(source: 'task-workflow' | 'va-fanout') {
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
      ? 'JR Processor'
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
      subject: `[FFL Portal] Returned to ${isQcTask ? 'QC' : isJrTask ? 'JR Processor' : isVaTask ? 'Appraisal VA' : 'Disclosure'}: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'LO Responded - Review Needed',
      intro:
        `Loan Officer response has been received. Review details and complete the next ${isQcTask ? 'QC' : isJrTask ? 'JR Processor' : isVaTask ? 'appraisal VA' : 'disclosure'} action.`,
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
      subject: `[FFL Portal] New ${isQcTask ? 'QC' : isJrTask ? 'JR Processor' : isVaTask ? 'VA' : 'Disclosure'} Request: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'New Request Submitted',
      intro:
        `A new ${isQcTask ? 'QC' : isJrTask ? 'JR Processor' : isVaTask ? 'VA' : 'disclosure'} request is in your queue. Review details and take action.`,
      ctaLabel: 'Open New Request',
      statusLabel: 'NEW',
      workflowLabel: isQcTask
        ? 'New QC Request'
        : isJrTask
        ? 'New JR Processor Request'
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

  if (input.eventLabel === 'QC Request Started') {
    const starterName = input.changedBy?.trim() || 'QC Desk';
    if (input.audience === 'LO') {
      return {
        ...base,
        subject: `[FFL Portal] ${starterName} started your QC request: ${input.borrowerName} (${input.loanNumber})`,
        eventLabel: 'QC Request Started',
        intro: `${starterName} has started your QC request and is actively working this file.`,
        ctaLabel: 'Track QC Request',
        statusLabel: 'IN PROGRESS',
        workflowLabel: 'New QC Request',
      };
    }
    return {
      ...base,
      subject: `[FFL Portal] QC Request Started: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'QC Request Started',
      intro: `${starterName} claimed this QC request and has started working it.`,
      ctaLabel: 'Track Task in Portal',
      statusLabel: 'IN PROGRESS',
      workflowLabel: 'New QC Request',
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
        ? 'JR Processor Queue'
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
          select: { submissionData: true, kind: true },
        })
      : await tx.task.findFirst({
          where: {
            loanId,
            kind: TaskKind.SUBMIT_QC,
          },
          select: {
            submissionData: true,
            kind: true,
          },
          orderBy: {
            updatedAt: 'desc',
          },
        });
    // Safety rail: VA fanout is only allowed from a true QC submission task.
    if (!sourceQcSubmission || sourceQcSubmission.kind !== TaskKind.SUBMIT_QC) {
      return [] as TaskKind[];
    }
    const qcSubmissionData = mergeSubmissionDataWithLoanFallback(
      sourceQcSubmission?.submissionData,
      loanFallbackSubmissionData
    );

    const existingKinds = await tx.task.findMany({
      where: { loanId },
      select: { kind: true, assignedRole: true },
    });

    const has = (kind: TaskKind, assignedRole: UserRole) =>
      existingKinds.some((task) => task.kind === kind || task.assignedRole === assignedRole);

    const toCreate = VA_TASK_BLUEPRINTS.filter(
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

    const vaKinds = new Set(VA_TASK_BLUEPRINTS.map((entry) => entry.kind));
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
    const isJrDeskTask = task.kind === TaskKind.VA_HOI || vaRole === UserRole.PROCESSOR_JR;
    const deskType: DeskType = isVaTaskKind(task.kind)
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
        ? 'JR Processor'
        : deskType === 'VA'
        ? 'VA Desk'
        : 'Disclosure Desk';
    const teamRole =
      deskType === 'QC'
        ? UserRole.QC
        : deskType === 'VA'
        ? vaRole
        : UserRole.DISCLOSURE_SPECIALIST;
    if (deskType === 'VA' && !teamRole) return false;
    const teamAudience: EmailAudience =
      deskType === 'QC' ? 'QC' : deskType === 'VA' ? 'VA' : 'DISCLOSURE';

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
  if (!role || (role !== UserRole.ADMIN && role !== UserRole.MANAGER)) {
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
  options?: { noteMessage?: string }
) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
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

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
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
        (isSubmissionWorkflowTask && !isQcSubmissionTask(existing)))
    ) {
      const proofCount = await prisma.taskAttachment.count({
        where: { taskId, purpose: 'PROOF' },
      });
      if (proofCount < 1) {
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
          item.status === 'COMPLETED' ? Boolean(item.proofAttachmentId) : true
        );
      if (!allCompleted || !allProofAttached) {
        return {
          success: false,
          error:
            'JR Processor task can only be completed when HOI and Submitted to Underwriting are Completed with proof, and VOE is either Completed with proof or marked Not Required.',
        };
      }
    }

    if (newStatus === TaskStatus.COMPLETED && isSubmissionWorkflowTask) {
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

    if (newStatus === TaskStatus.COMPLETED && isDisclosureSubmissionTask(existing)) {
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
    const isQcSubmissionWorkflowTask = isQcSubmissionTask(existing);
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

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: newStatus,
        ...(shouldClaimVaTask ? { assignedUserId: userId } : {}),
        workflowState: nextWorkflowState,
        completedAt: newStatus === 'COMPLETED' ? new Date() : null,
        ...(submissionDataWithTimeline
          ? { submissionData: submissionDataWithTimeline }
          : {}),
      },
    });

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

const disclosureOriginalCostReadonlyField: Array<{
  key: 'originalCost';
  label: string;
}> = [{ key: 'originalCost', label: 'Original Cost' }];

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

      const investor = String(submissionObject.investor ?? '').trim().toUpperCase();
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
      const employmentFieldsRequired = hasAnyIncomeItems ? hasEmploymentIncome : true;
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
        ...(isPurchaseLikeLoan ? [] : disclosureOriginalCostReadonlyField),
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

    if (submissionType === 'QC') {
      if (
        role === UserRole.LOAN_OFFICER &&
        !sessionUser?.loQcSubmissionEnabled
      ) {
        return {
          success: false,
          error: 'Submit for QC is disabled for your user by Admin.',
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
      const qcInvestor = String(submissionObject?.investor ?? '').trim().toUpperCase();
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
            'Cash Back and Projected Revenue are required before submitting QC.',
        };
      }
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
      submissionType === 'QC' ? 'QC_REVIEW' : 'DISCLOSURES_PENDING';

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
        ? 'Submit for QC'
        : 'Submit for Disclosures';

    const assignedRole =
      submissionType === 'QC'
        ? UserRole.QC
        : UserRole.DISCLOSURE_SPECIALIST;

    const kind =
      submissionType === 'QC' ? TaskKind.SUBMIT_QC : TaskKind.SUBMIT_DISCLOSURES;

    let finalSubmissionData = submissionData;
    if (notes?.trim()) {
      const dataObj = (submissionData && typeof submissionData === 'object')
        ? { ...(submissionData as Record<string, unknown>) }
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
        status: TaskStatus.PENDING,
        priority: TaskPriority.NORMAL,
        assignedRole,
        dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    await dispatchTaskWorkflowNotification({
      taskId: createdTask.id,
      eventLabel: 'New Request Submitted',
      changedBy: session?.user?.name || loanOfficerName || null,
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true, taskId: createdTask.id, loanId: loan.id };
  } catch (error) {
    console.error('Failed to create submission task:', error);
    return { success: false, error: 'Failed to submit task' };
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

type JrChecklistStatus = 'ORDERED' | 'MISSING_ITEMS' | 'COMPLETED' | 'NOT_REQUIRED';
type JrChecklistItemInput = {
  id: string;
  label: string;
  status: JrChecklistStatus;
  proofAttachmentId?: string | null;
  proofFilename?: string | null;
  note?: string | null;
  noteUpdatedAt?: string | null;
  noteAuthor?: string | null;
  noteRole?: UserRole | null;
};

type JrProcessorAssignedValue = 'DEVON_CARAG';

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
const JR_PROCESSOR_ASSIGNED_SET = new Set<JrProcessorAssignedValue>(['DEVON_CARAG']);

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
    parsed.push({
      id,
      label,
      status,
      proofAttachmentId: proofAttachmentId || null,
      proofFilename: proofFilename || null,
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
  return role === UserRole.ADMIN || role === UserRole.MANAGER;
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
    task.kind === TaskKind.VA_TITLE ||
    task.kind === TaskKind.VA_PAYOFF ||
    task.kind === TaskKind.VA_APPRAISAL ||
    task.kind === TaskKind.VA_HOI;

  return isDeskKind && task.status === TaskStatus.PENDING && task.workflowState === TaskWorkflowState.NONE;
}

export async function saveJrProcessorChecklist(
  taskId: string,
  items: JrChecklistItemInput[],
  processorAssigned?: string | null,
  processorAssignedNote?: string | null
) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
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
    if (existing.status === TaskStatus.COMPLETED) {
      return {
        success: false,
        error: 'JR checklist is locked after task completion. Ask a manager to reopen the task.',
      };
    }

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const canManageJrTask =
      role === UserRole.PROCESSOR_JR ||
      existing.assignedRole === UserRole.PROCESSOR_JR ||
      existing.assignedUserId === userId;
    if (!canManageAll && !canManageJrTask) {
      return { success: false, error: 'Not authorized to update this checklist.' };
    }
    if (!canBypassDeskStartLock(role) && isStartLockedDeskTask(existing)) {
      return { success: false, error: 'Start this task before editing the JR checklist.' };
    }

    const proofAttachmentIds = parsedItems
      .map((item) => item.proofAttachmentId || null)
      .filter((id): id is string => Boolean(id));
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
    const existingProofAttachmentIdByRowId = new Map<string, string | null>();
    if (Array.isArray(existingItemsRaw)) {
      for (const item of existingItemsRaw) {
        if (!item || typeof item !== 'object') continue;
        const id = String((item as { id?: unknown }).id ?? '').trim();
        const note = String((item as { note?: unknown }).note ?? '').trim();
        if (!id) continue;
        existingNotesByRowId.set(id, note);
        const proofAttachmentId = String(
          (item as { proofAttachmentId?: unknown }).proofAttachmentId ?? ''
        ).trim();
        existingProofAttachmentIdByRowId.set(id, proofAttachmentId || null);
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
        const previousAttachmentId = existingProofAttachmentIdByRowId.get(item.id) || null;
        const nextAttachmentId = item.proofAttachmentId || null;
        if (previousAttachmentId === nextAttachmentId) return null;
        if (nextAttachmentId && !previousAttachmentId) return `${item.label} (uploaded)`;
        if (!nextAttachmentId && previousAttachmentId) return `${item.label} (removed)`;
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
      item.status === 'COMPLETED' ? Boolean(item.proofAttachmentId) : true
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

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const canManageJrTask =
      role === UserRole.PROCESSOR_JR ||
      existing.assignedRole === UserRole.PROCESSOR_JR ||
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

export async function startDisclosureRequest(taskId: string) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canStart =
      role === UserRole.ADMIN ||
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

    await prisma.task.update({
      where: { id: taskId },
      data: {
        assignedUserId: userId,
        assignedRole: UserRole.DISCLOSURE_SPECIALIST,
        status: TaskStatus.IN_PROGRESS,
        submissionData: updatedSubmissionData,
      },
    });

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
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canStart =
      role === UserRole.ADMIN ||
      role === UserRole.MANAGER ||
      role === UserRole.QC;
    if (!canStart) {
      return {
        success: false,
        error: 'Only QC, Manager, or Admin can start this request.',
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
    if (!isQcSubmissionTask(task)) {
      return {
        success: false,
        error: 'Only QC submission requests can be started here.',
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
      message: 'QC request started.',
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
      toAssignedRole: UserRole.QC,
      note: 'QC request started.',
    }) as Prisma.JsonObject;

    await prisma.task.update({
      where: { id: taskId },
      data: {
        assignedUserId: userId,
        assignedRole: UserRole.QC,
        status: TaskStatus.IN_PROGRESS,
        submissionData: updatedSubmissionData,
      },
    });

    await dispatchTaskWorkflowNotification({
      taskId,
      eventLabel: 'QC Request Started',
      changedBy: session?.user?.name,
    });

    revalidatePath('/tasks');
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    console.error('Failed to start QC request:', error);
    return { success: false, error: 'Failed to start QC request.' };
  } finally {
    recordPerfMetric('action.startQcRequest', Date.now() - perfStartedAt, {
      taskId,
    });
  }
}

export async function requestInfoFromLoanOfficer(taskId: string, input: RequestInfoInput) {
  const perfStartedAt = Date.now();
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canRequest =
      role === UserRole.ADMIN ||
      role === UserRole.MANAGER ||
      role === UserRole.QC ||
      role === UserRole.DISCLOSURE_SPECIALIST ||
      role === UserRole.VA ||
      role === UserRole.VA_TITLE ||
      role === UserRole.VA_PAYOFF ||
      role === UserRole.VA_APPRAISAL ||
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
          'This action is only supported for disclosure/QC submissions and VA Appraisal/Payoff tasks.',
      };
    }
    if (!canBypassDeskStartLock(role) && isStartLockedDeskTask(task)) {
      return {
        success: false,
        error: 'Start this task before sending updates back to the Loan Officer.',
      };
    }
    const qcSubmissionTask = isQcSubmissionTask(task);
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
          error: 'QC action must be either Complete QC or Missing Items.',
        };
      }
      if (!parsedQcChecklist) {
        return {
          success: false,
          error: 'Please complete the QC checklist before submitting the action.',
        };
      }
      if (
        normalizedReason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES &&
        hasRedXChecklistItems
      ) {
        return {
          success: false,
          error: 'Complete QC is blocked while any checklist item is marked Red X.',
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
          error: 'Please add general QC notes before submitting the QC action.',
        };
      }
    }

    if (isVaLoResponseTask && normalizedReason !== DisclosureDecisionReason.MISSING_ITEMS) {
      return {
        success: false,
        error:
          'VA Appraisal and Payoff can only send Missing/Incomplete items back to LO.',
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
              description: 'Closed automatically after QC completion.',
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

    if (isQcCompleteAction) {
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

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const isVisibleLoanOfficerResponder =
      role === UserRole.LOAN_OFFICER &&
      task.loan &&
      canLoanOfficerViewLoan(task.loan, userId);
    const canRespond =
      canManageAll ||
      (role === UserRole.LOAN_OFFICER &&
        (task.assignedUserId === userId || isVisibleLoanOfficerResponder));
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

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const isVisibleLoanOfficerReviewer =
      role === UserRole.LOAN_OFFICER &&
      task.loan &&
      canLoanOfficerViewLoan(task.loan, userId);
    const canReview =
      canManageAll ||
      (role === UserRole.LOAN_OFFICER &&
        (task.assignedUserId === userId || isVisibleLoanOfficerReviewer));
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
    const role = session?.user?.role as UserRole | undefined;
    if (!role || (role !== UserRole.ADMIN && role !== UserRole.MANAGER)) {
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

    const shouldSendDeleteNotification =
      isDisclosureSubmissionTask(existing) || isQcSubmissionTask(existing);
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

