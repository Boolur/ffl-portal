import 'server-only';

import { ANY_ADMIN_ROLES } from '@/lib/adminTiers';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

type WebsiteLeadAudience = 'assigned-lo' | 'admin';

type WebsiteLeadForEmail = NonNullable<
  Awaited<ReturnType<typeof loadWebsiteLeadForEmail>>
>;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function portalBaseUrl() {
  return (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
}

function leadName(lead: Pick<WebsiteLeadForEmail, 'firstName' | 'lastName'>) {
  return [lead.firstName, lead.lastName].filter(Boolean).join(' ').trim() || 'Unknown Lead';
}

function formatDate(value: Date) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'America/Los_Angeles',
  }).format(value);
}

function customRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function loadWebsiteLeadForEmail(leadId: string) {
  return prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      source: true,
      loanPurpose: true,
      loanAmount: true,
      propertyState: true,
      receivedAt: true,
      customData: true,
      assignedUser: { select: { name: true, email: true } },
      notes: {
        orderBy: { createdAt: 'asc' },
        take: 3,
        select: { content: true },
      },
    },
  });
}

function websiteLeadDetails(lead: WebsiteLeadForEmail) {
  const custom = customRecord(lead.customData);
  const answers = customRecord(custom.answers);
  const program = customRecord(custom.program);
  const reasons = Array.isArray(custom.recommendationReasons)
    ? custom.recommendationReasons.map((reason) => String(reason)).filter(Boolean)
    : [];

  return {
    formSource: stringValue(custom.formSource) ?? 'Website form',
    programName: stringValue(program.name) ?? stringValue(program.slug),
    state:
      stringValue(answers.state) ??
      stringValue(lead.propertyState) ??
      stringValue(custom.state),
    goal:
      stringValue(answers.goal) ??
      stringValue(lead.loanPurpose) ??
      stringValue(program.category),
    credit: stringValue(answers.credit),
    military: stringValue(answers.military),
    capturedAt: stringValue(custom.capturedAt),
    officerSlug: stringValue(custom.officerSlug),
    reasons,
    message: lead.notes[0]?.content?.trim() || null,
  };
}

function detailRow(label: string, value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return `
    <tr>
      <td style="padding:7px 0;color:#64748b;font-size:13px;">${escapeHtml(label)}</td>
      <td style="padding:7px 0;color:#0f172a;font-size:13px;font-weight:700;text-align:right;">${escapeHtml(text)}</td>
    </tr>
  `;
}

function buildWebsiteLeadEmail(input: {
  lead: WebsiteLeadForEmail;
  audience: WebsiteLeadAudience;
}) {
  const { lead, audience } = input;
  const name = leadName(lead);
  const details = websiteLeadDetails(lead);
  const baseUrl = portalBaseUrl();
  const href = audience === 'admin' ? `${baseUrl}/admin/leads` : `${baseUrl}/leads`;
  const assignedLabel = lead.assignedUser?.name
    ? `${lead.assignedUser.name}${lead.assignedUser.email ? ` <${lead.assignedUser.email}>` : ''}`
    : 'Unassigned - needs leadership review';
  const subject =
    audience === 'admin'
      ? `[BISU Website Lead] ${lead.assignedUser ? 'Assigned' : 'Unassigned'}: ${name}`
      : `[BISU Website Lead] New webform lead: ${name}`;

  const rows = [
    detailRow('Name', name),
    detailRow('Email', lead.email),
    detailRow('Phone', lead.phone),
    detailRow('Assigned To', assignedLabel),
    detailRow('Form Source', details.formSource),
    detailRow('Program', details.programName),
    detailRow('Goal', details.goal),
    detailRow('State', details.state),
    detailRow('Credit', details.credit),
    detailRow('Military', details.military),
    detailRow('Received', formatDate(lead.receivedAt)),
  ].join('');

  const reasonHtml = details.reasons.length
    ? `
      <div style="margin-top:18px;padding:14px;border-radius:16px;background:#f8fafc;border:1px solid #e2e8f0;">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#475569;">Recommendation Signals</div>
        <ul style="margin:10px 0 0;padding-left:18px;color:#334155;font-size:14px;line-height:1.6;">
          ${details.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const messageHtml = details.message
    ? `
      <div style="margin-top:18px;padding:14px;border-radius:16px;background:#fff7ed;border:1px solid #fed7aa;">
        <div style="font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#9a3412;">Borrower Message</div>
        <p style="margin:8px 0 0;color:#7c2d12;font-size:14px;line-height:1.6;">${escapeHtml(details.message)}</p>
      </div>
    `
    : '';

  const html = `
    <div style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:24px;overflow:hidden;border:1px solid #dbeafe;box-shadow:0 18px 45px rgba(15,23,42,.12);">
              <tr>
                <td style="padding:0;background:linear-gradient(135deg,#0f4c81,#2563eb 58%,#f59e0b);">
                  <div style="padding:24px 26px;color:white;">
                    <div style="display:inline-block;padding:7px 11px;border-radius:999px;background:rgba(255,255,255,.18);font-size:11px;font-weight:900;letter-spacing:.14em;text-transform:uppercase;">BISU Website Lead</div>
                    <h1 style="margin:14px 0 6px;font-size:28px;line-height:1.15;color:white;">${escapeHtml(name)}</h1>
                    <p style="margin:0;color:#dbeafe;font-size:15px;">${escapeHtml(lead.assignedUser ? 'Direct LO webform submission' : 'Generic website form - unassigned')}</p>
                  </div>
                </td>
              </tr>
              <tr>
                <td style="padding:24px 26px 28px;">
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                    ${rows}
                  </table>
                  ${reasonHtml}
                  ${messageHtml}
                  <div style="margin-top:24px;">
                    <a href="${escapeHtml(href)}" style="display:inline-block;border-radius:14px;background:#0f4c81;color:#ffffff;text-decoration:none;font-weight:800;padding:13px 18px;">Open Lead in Portal</a>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </div>
  `;

  const text = [
    'BISU Website Lead',
    '',
    `Name: ${name}`,
    `Email: ${lead.email ?? ''}`,
    `Phone: ${lead.phone ?? ''}`,
    `Assigned To: ${assignedLabel}`,
    `Form Source: ${details.formSource}`,
    `Program: ${details.programName ?? ''}`,
    `Goal: ${details.goal ?? ''}`,
    `State: ${details.state ?? ''}`,
    `Received: ${formatDate(lead.receivedAt)}`,
    details.message ? `Message: ${details.message}` : '',
    '',
    `Open in portal: ${href}`,
  ]
    .filter((line) => line !== '')
    .join('\n');

  return { subject, html, text };
}

export async function getWebsiteLeadAdminRecipients() {
  return prisma.user.findMany({
    where: {
      active: true,
      email: { not: '' },
      OR: [
        { role: { in: ANY_ADMIN_ROLES } },
        { roles: { hasSome: ANY_ADMIN_ROLES } },
      ],
    },
    select: { id: true, email: true },
  });
}

export async function sendAssignedWebsiteLeadEmail(leadId: string) {
  const lead = await loadWebsiteLeadForEmail(leadId);
  const to = lead?.assignedUser?.email?.trim();
  if (!lead || !to) return { sent: 0 };
  const email = buildWebsiteLeadEmail({ lead, audience: 'assigned-lo' });
  await sendEmail({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    senderCategory: 'noreply',
    label: 'bisu-website-lead-lo',
  });
  return { sent: 1 };
}

export async function notifyAdminsOfWebsiteLead(leadId: string) {
  const [lead, admins] = await Promise.all([
    loadWebsiteLeadForEmail(leadId),
    getWebsiteLeadAdminRecipients(),
  ]);
  if (!lead || admins.length === 0) return { sent: 0 };

  await prisma.notification.createMany({
    data: admins.map((admin) => ({
      userId: admin.id,
      eventLabel: 'BISU_WEBSITE_LEAD',
      title: lead.assignedUser ? 'BISU Website Lead Assigned' : 'Unassigned BISU Website Lead',
      message: lead.assignedUser
        ? `${leadName(lead)} submitted a BISU website form assigned to ${lead.assignedUser.name ?? 'an LO'}.`
        : `${leadName(lead)} submitted a BISU website form and needs assignment.`,
      href: '/admin/leads',
    })),
  });

  const email = buildWebsiteLeadEmail({ lead, audience: 'admin' });
  const results = await Promise.allSettled(
    admins.map((admin) =>
      sendEmail({
        to: admin.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        senderCategory: 'noreply',
        label: 'bisu-website-lead-admin',
      })
    )
  );

  return {
    sent: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  };
}

export async function sendHistoricalWebsiteLeadNotifications(input: {
  since: Date;
  limit?: number;
}) {
  const rows = await prisma.lead.findMany({
    where: {
      receivedAt: { gte: input.since },
      OR: [{ source: 'WebLead' }, { vendor: { slug: 'bisu-website' } }],
    },
    select: { id: true, assignedUserId: true },
    orderBy: { receivedAt: 'asc' },
    take: input.limit,
  });

  let adminEmails = 0;
  let loEmails = 0;
  for (const row of rows) {
    const adminResult = await notifyAdminsOfWebsiteLead(row.id);
    adminEmails += adminResult.sent;
    if (row.assignedUserId) {
      const loResult = await sendAssignedWebsiteLeadEmail(row.id);
      loEmails += loResult.sent;
    }
  }

  return { leads: rows.length, adminEmails, loEmails };
}
