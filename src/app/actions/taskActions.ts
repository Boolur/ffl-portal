'use server';

import { prisma } from '@/lib/prisma';
import {
  DisclosureDecisionReason,
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
  deskTone: 'blue' | 'violet';
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
      : {
          headerGradient: 'linear-gradient(135deg,#eff6ff,#eef2ff)',
          tagBg: '#dbeafe',
          tagText: '#1d4ed8',
          buttonBg: '#1d4ed8',
          buttonBorder: '#1e40af',
          buttonGradient: 'linear-gradient(135deg,#2563eb,#1d4ed8)',
          linkColor: '#2563eb',
        };
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
                <span style="display:inline-block;margin-left:8px;padding:6px 10px;border-radius:999px;background:#e2e8f0;color:#334155;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Task Update</span>
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

type EmailAudience = 'LO' | 'DISCLOSURE' | 'QC';

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
  isQcTask: boolean;
  eventLabel: string;
  borrowerName: string;
  loanNumber: string;
  taskTitle: string;
  status: TaskStatus;
  workflowLabel: string;
  reasonLabel: string | null;
  changedBy?: string | null;
}) {
  const deskLabel = input.isQcTask ? 'QC Desk' : 'Disclosure Desk';
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
      subject: `[FFL Portal] Returned to ${input.isQcTask ? 'QC' : 'Disclosure'}: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'LO Responded - Review Needed',
      intro:
        `Loan Officer response has been received. Review details and complete the next ${input.isQcTask ? 'QC' : 'disclosure'} action.`,
      ctaLabel: 'Review Response in Portal',
      statusLabel: 'REVIEW NEEDED',
      workflowLabel: input.isQcTask ? 'Returned to QC' : 'Returned to Disclosure',
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
      subject: `[FFL Portal] New ${input.isQcTask ? 'QC' : 'Disclosure'} Request: ${input.borrowerName} (${input.loanNumber})`,
      eventLabel: 'New Request Submitted',
      intro:
        `A new ${input.isQcTask ? 'QC' : 'disclosure'} request is in your queue. Review details and take action.`,
      ctaLabel: 'Open New Request',
      statusLabel: 'NEW',
      workflowLabel: input.isQcTask ? 'New QC Request' : 'New Disclosure Request',
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
      },
    });
    if (!task) return;

    const isQcTask = isQcSubmissionTask(task);
    const teamRole = isQcTask ? UserRole.QC : UserRole.DISCLOSURE_SPECIALIST;
    const teamAudience: EmailAudience = isQcTask ? 'QC' : 'DISCLOSURE';

    const [loan, teamUsers, managerUsers] = await Promise.all([
      prisma.loan.findUnique({
        where: { id: task.loanId },
        select: {
          loanNumber: true,
          borrowerName: true,
          loanOfficer: {
            select: { email: true, name: true, active: true },
          },
        },
      }),
      prisma.user.findMany({
        where: {
          active: true,
          OR: [{ role: teamRole }, { roles: { has: teamRole } }],
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

    if (!loan) return;

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
    const shouldSendLoanOfficerAudience =
      Boolean(loanOfficerEmail) && !teamRecipientSet.has(loanOfficerEmail as string);
    if (teamRecipientSet.size === 0 && !shouldSendLoanOfficerAudience) return;

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
        isQcTask,
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
        `Desk: ${isQcTask ? 'QC Desk' : 'Disclosure Desk'}`,
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
        deskLabel: isQcTask ? 'QC Desk' : 'Disclosure Desk',
        deskTone: isQcTask ? 'violet' : 'blue',
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
    if (loanOfficerEmail && shouldSendLoanOfficerAudience) {
      await sendByAudience('LO', [loanOfficerEmail]);
    }
  } catch (error) {
    console.error('Failed to send task workflow notifications:', error);
  }
}

export async function updateTaskStatus(taskId: string, newStatus: TaskStatus) {
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
        kind: true,
        assignedRole: true,
        assignedUserId: true,
        loanId: true,
        parentTaskId: true,
        disclosureReason: true,
        workflowState: true,
        loanOfficerApprovedAt: true,
        loan: { select: { loanOfficerId: true } },
      },
    });

    if (!existing) return { success: false, error: 'Task not found.' };

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const isAssignedToUser = existing.assignedUserId === userId;
    const isAssignedToRole = existing.assignedRole === role;
    const isLoanOwner =
      role === UserRole.LOAN_OFFICER && existing.loan?.loanOfficerId === userId;

    if (!canManageAll && !isAssignedToUser && !isAssignedToRole && !isLoanOwner) {
      return { success: false, error: 'Not authorized to update this task.' };
    }

    const isVaKind =
      existing.kind === TaskKind.VA_TITLE ||
      existing.kind === TaskKind.VA_HOI ||
      existing.kind === TaskKind.VA_PAYOFF ||
      existing.kind === TaskKind.VA_APPRAISAL;

    const isVaRole =
      role === UserRole.VA_TITLE ||
      role === UserRole.VA_HOI ||
      role === UserRole.VA_PAYOFF ||
      role === UserRole.VA_APPRAISAL;

    const isSubmissionWorkflowTask = isSubmissionTask(existing);

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

    await prisma.task.update({
      where: { id: taskId },
      data: {
        status: newStatus,
        workflowState:
          newStatus === TaskStatus.COMPLETED
            ? TaskWorkflowState.NONE
            : existing.workflowState ?? TaskWorkflowState.NONE,
        completedAt: newStatus === 'COMPLETED' ? new Date() : null,
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

      const isQcSubmission =
        existing.kind === TaskKind.SUBMIT_QC ||
        (existing.assignedRole === UserRole.QC &&
          existing.title.toLowerCase().includes('qc'));

      if (isQcSubmission) {
        await prisma.$transaction(async (tx) => {
          const existingKinds = await tx.task.findMany({
            where: { loanId: existing.loanId },
            select: { kind: true, assignedRole: true },
          });

          const has = (kind: TaskKind, role: UserRole) =>
            existingKinds.some(
              (t) => t.kind === kind || t.assignedRole === role
            );

          const toCreate: { kind: TaskKind; assignedRole: UserRole; title: string }[] =
            [];

          if (!has(TaskKind.VA_TITLE, UserRole.VA_TITLE)) {
            toCreate.push({
              kind: TaskKind.VA_TITLE,
              assignedRole: UserRole.VA_TITLE,
              title: 'VA: Title',
            });
          }
          if (!has(TaskKind.VA_HOI, UserRole.VA_HOI)) {
            toCreate.push({
              kind: TaskKind.VA_HOI,
              assignedRole: UserRole.VA_HOI,
              title: 'VA: HOI',
            });
          }
          if (!has(TaskKind.VA_PAYOFF, UserRole.VA_PAYOFF)) {
            toCreate.push({
              kind: TaskKind.VA_PAYOFF,
              assignedRole: UserRole.VA_PAYOFF,
              title: 'VA: Payoff',
            });
          }
          if (!has(TaskKind.VA_APPRAISAL, UserRole.VA_APPRAISAL)) {
            toCreate.push({
              kind: TaskKind.VA_APPRAISAL,
              assignedRole: UserRole.VA_APPRAISAL,
              title: 'VA: Appraisal',
            });
          }

          if (toCreate.length) {
            await tx.task.createMany({
              data: toCreate.map((t) => ({
                loanId: existing.loanId,
                title: t.title,
                kind: t.kind,
                status: TaskStatus.PENDING,
                priority: TaskPriority.NORMAL,
                assignedRole: t.assignedRole,
                dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
              })),
            });
          }

          // Move loan forward to next workflow stage (keeps Leads vs Active clean)
          await tx.loan.update({
            where: { id: existing.loanId },
            data: { stage: 'SUBMIT_TO_UW_PREP' },
          });
        });
      }
    }

    if (
      newStatus === TaskStatus.COMPLETED &&
      existing.kind === TaskKind.LO_NEEDS_INFO &&
      existing.parentTaskId
    ) {
      await sendTaskWorkflowNotificationsByTaskId({
        taskId: existing.parentTaskId,
        eventLabel: 'Task Returned to Disclosure',
        changedBy: session?.user?.name,
      });
    } else if (newStatus === TaskStatus.COMPLETED) {
      await sendTaskWorkflowNotificationsByTaskId({
        taskId,
        eventLabel: 'Task Completed',
        changedBy: session?.user?.name,
      });
    } else {
      await sendTaskWorkflowNotificationsByTaskId({
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
  }
}

type SubmissionType = 'DISCLOSURES' | 'QC';

type SubmissionPayload = {
  submissionType: SubmissionType;
  loanOfficerName?: string;
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

const disclosureCoreReadonlyFields: Array<{
  key:
    | 'yearBuiltProperty'
    | 'originalCost'
    | 'mannerInWhichTitleWillBeHeld';
  label: string;
}> = [
  { key: 'yearBuiltProperty', label: 'Year Built (Property)' },
  { key: 'originalCost', label: 'Original Cost' },
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
  try {
    const {
      submissionType,
      loanOfficerName,
      borrowerFirstName,
      borrowerLastName,
      borrowerPhone,
      borrowerEmail,
      arriveLoanNumber,
      loanAmount,
      notes,
      submissionData,
    } = payload;

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
        ...disclosureCoreReadonlyFields,
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
    const role = session?.user?.role as UserRole | undefined;
    const sessionUserId = session?.user?.id as string | undefined;

    if (submissionType === 'QC') {
      if (!sessionUserId) {
        return { success: false, error: 'Not authenticated.' };
      }
      const pilotRows = await prisma.$queryRaw<Array<{ loQcTwoRowPilot: boolean }>>`
        SELECT "loQcTwoRowPilot"
        FROM "User"
        WHERE id = ${sessionUserId}
        LIMIT 1
      `;
      if (!pilotRows[0]?.loQcTwoRowPilot) {
        return {
          success: false,
          error: 'Submit for QC is not enabled for this user yet.',
        };
      }

      const submissionObject =
        submissionData &&
        typeof submissionData === 'object' &&
        !Array.isArray(submissionData)
          ? (submissionData as Record<string, unknown>)
          : null;

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

    // Prefer the session user as the loan officer when possible.
    // (Keeps pipelines isolated per-LO and avoids name-based lookups.)
    let loanOfficerUser =
      role === UserRole.LOAN_OFFICER && sessionUserId
        ? await prisma.user.findUnique({ where: { id: sessionUserId } })
        : null;

    // Back-compat fallback (older UI sent loanOfficerName)
    if (!loanOfficerUser && loanOfficerName) {
      loanOfficerUser = await prisma.user.findFirst({
        where: { name: loanOfficerName },
      });
    }

    // Last resort fallback
    if (!loanOfficerUser) {
      loanOfficerUser = await prisma.user.findFirst({
        where: { role: UserRole.LOAN_OFFICER },
      });
    }

    if (!loanOfficerUser) {
      return { success: false, error: 'No loan officer user found' };
    }

    // Find or create loan
    let loan = await prisma.loan.findFirst({
      where: { loanNumber: arriveLoanNumber },
    });

    const targetStage =
      submissionType === 'QC' ? 'QC_REVIEW' : 'DISCLOSURES_PENDING';

    if (!loan) {
      loan = await prisma.loan.create({
        data: {
          loanNumber: arriveLoanNumber,
          borrowerName: `${borrowerFirstName} ${borrowerLastName}`.trim(),
          borrowerPhone: borrowerPhone?.trim() || null,
          borrowerEmail: borrowerEmail?.trim() || null,
          amount: Number(loanAmount || 0),
          loanOfficerId: loanOfficerUser.id,
          stage: targetStage,
        },
      });
    } else {
      // Update stage if it's currently INTAKE (Lead)
      if (loan.stage === 'INTAKE') {
        await prisma.loan.update({
          where: { id: loan.id },
          data: {
            stage: targetStage,
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
        role: UserRole.LOAN_OFFICER,
        message: `Initial Submission Notes: ${notes.trim()}`,
        date: new Date().toISOString(),
      };
      
      dataObj.notesHistory = [initialNote];
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

    await sendTaskWorkflowNotificationsByTaskId({
      taskId: createdTask.id,
      eventLabel: 'New Request Submitted',
      changedBy: session?.user?.name || loanOfficerName || null,
    });

    revalidatePath('/');
    return { success: true, taskId: createdTask.id, loanId: loan.id };
  } catch (error) {
    console.error('Failed to create submission task:', error);
    return { success: false, error: 'Failed to submit task' };
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

export async function startDisclosureRequest(taskId: string) {
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

    await prisma.task.update({
      where: { id: taskId },
      data: {
        assignedUserId: userId,
        assignedRole: UserRole.DISCLOSURE_SPECIALIST,
        status: TaskStatus.IN_PROGRESS,
      },
    });

    await sendTaskWorkflowNotificationsByTaskId({
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
  }
}

export async function startQcRequest(taskId: string) {
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

    await prisma.task.update({
      where: { id: taskId },
      data: {
        assignedUserId: userId,
        assignedRole: UserRole.QC,
        status: TaskStatus.IN_PROGRESS,
      },
    });

    await sendTaskWorkflowNotificationsByTaskId({
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
  }
}

export async function requestInfoFromLoanOfficer(taskId: string, input: RequestInfoInput) {
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    const userId = session?.user?.id as string | undefined;
    if (!role || !userId) return { success: false, error: 'Not authenticated.' };

    const canRequest =
      role === UserRole.ADMIN ||
      role === UserRole.MANAGER ||
      role === UserRole.QC ||
      role === UserRole.DISCLOSURE_SPECIALIST;

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

    if (!isSubmissionTask(task)) {
      return {
        success: false,
        error: 'This action is only supported for disclosure/QC submission tasks.',
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
            workflowState:
              qcSubmissionTask
                ? TaskWorkflowState.WAITING_ON_LO
                : normalizedReason ===
                  DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
                ? TaskWorkflowState.WAITING_ON_LO_APPROVAL
                : TaskWorkflowState.WAITING_ON_LO,
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
      await prisma.$transaction(async (tx) => {
        const existingKinds = await tx.task.findMany({
          where: { loanId: task.loanId },
          select: { kind: true, assignedRole: true },
        });

        const has = (kind: TaskKind, assignedRole: UserRole) =>
          existingKinds.some((t) => t.kind === kind || t.assignedRole === assignedRole);

        const toCreate: { kind: TaskKind; assignedRole: UserRole; title: string }[] = [];

        if (!has(TaskKind.VA_TITLE, UserRole.VA_TITLE)) {
          toCreate.push({
            kind: TaskKind.VA_TITLE,
            assignedRole: UserRole.VA_TITLE,
            title: 'VA: Title',
          });
        }
        if (!has(TaskKind.VA_HOI, UserRole.VA_HOI)) {
          toCreate.push({
            kind: TaskKind.VA_HOI,
            assignedRole: UserRole.VA_HOI,
            title: 'VA: HOI',
          });
        }
        if (!has(TaskKind.VA_PAYOFF, UserRole.VA_PAYOFF)) {
          toCreate.push({
            kind: TaskKind.VA_PAYOFF,
            assignedRole: UserRole.VA_PAYOFF,
            title: 'VA: Payoff',
          });
        }
        if (!has(TaskKind.VA_APPRAISAL, UserRole.VA_APPRAISAL)) {
          toCreate.push({
            kind: TaskKind.VA_APPRAISAL,
            assignedRole: UserRole.VA_APPRAISAL,
            title: 'VA: Appraisal',
          });
        }

        if (toCreate.length) {
          await tx.task.createMany({
            data: toCreate.map((t) => ({
              loanId: task.loanId,
              title: t.title,
              kind: t.kind,
              status: TaskStatus.PENDING,
              priority: TaskPriority.NORMAL,
              assignedRole: t.assignedRole,
              dueDate: new Date(Date.now() + 24 * 60 * 60 * 1000),
            })),
          });
        }

        await tx.loan.update({
          where: { id: task.loanId },
          data: { stage: 'SUBMIT_TO_UW_PREP' },
        });
      });
    }

    await sendTaskWorkflowNotificationsByTaskId({
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
      select: { submissionData: true },
    });
    if (!parentTask) return { success: false, error: 'Parent task not found.' };

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const canRespond = canManageAll || (role === UserRole.LOAN_OFFICER && task.assignedUserId === userId);
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

    await sendTaskWorkflowNotificationsByTaskId({
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
      select: { submissionData: true },
    });
    if (!parentTask) return { success: false, error: 'Parent task not found.' };

    const canManageAll = role === UserRole.ADMIN || role === UserRole.MANAGER;
    const canReview =
      canManageAll ||
      (role === UserRole.LOAN_OFFICER && task.assignedUserId === userId);
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

    await sendTaskWorkflowNotificationsByTaskId({
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
  try {
    const session = await getServerSession(authOptions);
    const role = session?.user?.role as UserRole | undefined;
    if (!role || (role !== UserRole.ADMIN && role !== UserRole.MANAGER)) {
      return { success: false, error: 'Not authorized to delete tasks.' };
    }

    const existing = await prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true },
    });
    if (!existing) {
      return { success: false, error: 'Task not found.' };
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
  }
}

