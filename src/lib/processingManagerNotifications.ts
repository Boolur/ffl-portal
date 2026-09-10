import { UserRole } from '@prisma/client';
import { prisma } from './prisma';
import { sendEmail } from './email';

export type ProcessingLifecycleEvent =
  | 'SUBMITTED'
  | 'STATUS_CHANGED'
  | 'REASSIGNED'
  | 'RESTRUCTURED'
  | 'ADVERSE_REQUESTED'
  | 'ADVERSED'
  | 'FUNDED'
  | 'RATE_LOCK_REQUESTED'
  | 'RATE_LOCK_UPDATED';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function eventTone(event: ProcessingLifecycleEvent) {
  if (event === 'FUNDED') {
    return { background: '#ecfdf5', border: '#86efac', accent: '#15803d' };
  }
  if (event === 'ADVERSED' || event === 'ADVERSE_REQUESTED') {
    return { background: '#fef2f2', border: '#fca5a5', accent: '#b91c1c' };
  }
  if (event === 'RESTRUCTURED') {
    return { background: '#fff7ed', border: '#fdba74', accent: '#c2410c' };
  }
  return { background: '#eff6ff', border: '#93c5fd', accent: '#1d4ed8' };
}

/**
 * Processing lifecycle emails are deliberately best-effort: a mail-provider
 * outage must never roll back or conceal an audited loan status change.
 */
export async function notifyProcessingManagers(input: {
  processingPipelineLoanId: string;
  event: ProcessingLifecycleEvent;
  eventLabel: string;
  actorName: string;
  summary: string;
}) {
  try {
    const [row, recipients] = await Promise.all([
      prisma.processingPipelineLoan.findUnique({
        where: { id: input.processingPipelineLoanId },
        select: {
          sourceTaskId: true,
          pipelineStatus: true,
          sheet: true,
          loan: {
            select: {
              borrowerName: true,
              loanNumber: true,
              loanOfficer: { select: { name: true } },
              secondaryLoanOfficer: { select: { name: true } },
            },
          },
          juniorProcessor: { select: { name: true } },
          seniorProcessor: { select: { name: true } },
        },
      }),
      prisma.user.findMany({
        where: {
          active: true,
          OR: [
            { role: UserRole.PROCESSING_MANAGER },
            { roles: { has: UserRole.PROCESSING_MANAGER } },
          ],
        },
        select: {
          id: true,
          email: true,
          emailNotificationsEnabled: true,
        },
      }),
    ]);
    if (!row || recipients.length === 0) return true;

    const href = '/pipeline';
    const title = `${input.eventLabel}: ${row.loan.borrowerName}`;
    const message = `${input.summary} Changed by ${input.actorName}.`;
    const existingNotifications =
      input.event === 'SUBMITTED'
        ? await prisma.notification.findMany({
            where: {
              userId: { in: recipients.map((recipient) => recipient.id) },
              taskId: row.sourceTaskId,
              eventLabel: 'PROCESSING_SUBMITTED',
              title,
              message,
            },
            select: { userId: true },
          })
        : [];
    const alreadyNotified = new Set(
      existingNotifications.map((notification) => notification.userId)
    );
    await prisma.notification.createMany({
      data: recipients
        .filter((recipient) => !alreadyNotified.has(recipient.id))
        .map((recipient) => ({
        userId: recipient.id,
        taskId: row.sourceTaskId,
        eventLabel: `PROCESSING_${input.event}`,
        title,
        message,
        href,
      })),
    });

    const emails = recipients
      .filter((recipient) => recipient.emailNotificationsEnabled)
      .map((recipient) => recipient.email.trim())
      .filter(Boolean);
    if (emails.length === 0) return true;

    const tone = eventTone(input.event);
    const baseUrl =
      process.env.NEXTAUTH_URL?.trim().replace(/\/+$/, '') ||
      process.env.APP_URL?.trim().replace(/\/+$/, '') ||
      'http://localhost:3000';
    const effectiveLoanOfficer =
      row.loan.secondaryLoanOfficer?.name || row.loan.loanOfficer.name;
    const html = `
      <div style="margin:0;padding:28px;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
        <table role="presentation" style="width:100%;max-width:680px;margin:0 auto;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #e2e8f0;border-radius:20px;overflow:hidden;">
          <tr>
            <td style="padding:24px 28px;background:${tone.background};border-bottom:1px solid ${tone.border};">
              <div style="font-size:12px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:${tone.accent};">Processing lifecycle update</div>
              <h1 style="margin:8px 0 0;font-size:25px;line-height:1.2;color:#0f172a;">${escapeHtml(input.eventLabel)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:28px;">
              <h2 style="margin:0 0 6px;font-size:21px;">${escapeHtml(row.loan.borrowerName)}</h2>
              <p style="margin:0 0 22px;color:#64748b;">Loan ${escapeHtml(row.loan.loanNumber)}</p>
              <table role="presentation" style="width:100%;border-collapse:collapse;font-size:14px;">
                <tr><td style="padding:8px 0;color:#64748b;">Status</td><td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(row.pipelineStatus.replace(/_/g, ' '))}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b;">Section</td><td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(row.sheet)}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b;">Loan Officer</td><td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(effectiveLoanOfficer)}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b;">Jr Processor</td><td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(row.juniorProcessor?.name || 'Unassigned')}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b;">Sr Processor</td><td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(row.seniorProcessor?.name || 'Unassigned')}</td></tr>
                <tr><td style="padding:8px 0;color:#64748b;">Updated by</td><td style="padding:8px 0;text-align:right;font-weight:700;">${escapeHtml(input.actorName)}</td></tr>
              </table>
              <div style="margin:22px 0;padding:14px 16px;border-left:4px solid ${tone.accent};background:${tone.background};color:#334155;">${escapeHtml(input.summary)}</div>
              <a href="${escapeHtml(`${baseUrl}${href}`)}" style="display:inline-block;padding:11px 18px;border-radius:10px;background:${tone.accent};color:#fff;text-decoration:none;font-weight:800;">Open Processing Pipeline</a>
            </td>
          </tr>
        </table>
      </div>`;
    await sendEmail({
      to: emails,
      subject: `[BISU Processing] ${input.eventLabel}: ${row.loan.borrowerName} (${row.loan.loanNumber})`,
      html,
      text: `${title}\n${message}\nLoan: ${row.loan.loanNumber}\nStatus: ${row.pipelineStatus}\n${baseUrl}${href}`,
      senderCategory: 'processing',
      label: 'processing manager lifecycle update',
    });
    return true;
  } catch (error) {
    console.error('[processing-manager-notifications] Delivery failed:', error);
    return false;
  }
}
