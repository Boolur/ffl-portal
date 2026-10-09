import 'server-only';

import { readFile } from 'fs/promises';
import { ANY_ADMIN_ROLES } from '@/lib/adminTiers';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';

type WebsiteLeadAudience = 'assigned-lo' | 'admin';

type WebsiteLeadForEmail = NonNullable<
  Awaited<ReturnType<typeof loadWebsiteLeadForEmail>>
>;

type WebsiteLeadBrandLogo = {
  logoUrl: string;
  inlineAttachments?: Array<{
    name: string;
    contentType: string;
    contentBytes: string;
    contentId: string;
  }>;
};

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

async function getInlineWebsiteLeadLogoAttachment(): Promise<WebsiteLeadBrandLogo> {
  try {
    const content = await readFile(`${process.cwd()}/public/logo.png`);
    return {
      logoUrl: 'cid:bisu-website-lead-logo',
      inlineAttachments: [
        {
          name: 'bisu-home-loans-logo.png',
          contentType: 'image/png',
          contentBytes: content.toString('base64'),
          contentId: 'bisu-website-lead-logo',
        },
      ],
    };
  } catch {
    return { logoUrl: `${portalBaseUrl()}/logo.png` };
  }
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
      <td style="padding:9px 0;color:#64748b;font-size:13px;font-weight:700;width:150px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:9px 0;color:#0f172a;font-size:14px;font-weight:800;text-align:right;vertical-align:top;">${escapeHtml(text)}</td>
    </tr>
  `;
}

function buildWebsiteLeadEmail(input: {
  lead: WebsiteLeadForEmail;
  audience: WebsiteLeadAudience;
  logoUrl: string;
}) {
  const { lead, audience, logoUrl } = input;
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
  const urgencyLabel = lead.assignedUser
    ? 'Direct LO Webform'
    : 'Unassigned - Action Needed';
  const leadTypeLabel = details.formSource
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
  const programLabel = details.programName ?? details.goal ?? 'Website Inquiry';
  const assignmentCardLabel = lead.assignedUser?.name ?? 'Admin Review';
  const metricCards = [
    { label: 'Lead Type', value: leadTypeLabel },
    { label: 'Program', value: programLabel },
    { label: lead.assignedUser ? 'Assigned LO' : 'Routing', value: assignmentCardLabel },
  ];
  const metricHtml = metricCards
    .map(
      (card) => `
        <td width="33.333%" align="center" valign="middle" style="width:33.333%;padding:0 8px 12px;text-align:center;vertical-align:middle;">
          <table role="presentation" width="100%" height="132" align="center" style="width:100%;height:132px;border-collapse:separate;border-spacing:0;border:1px solid #f59e0b;background:#fff7ed;border-radius:18px;">
            <tr>
              <td height="132" align="center" valign="middle" style="height:132px;padding:0 14px;text-align:center;vertical-align:middle;">
                <center>
                  <div style="width:100%;margin:0 auto;text-align:center;color:#b45309;font-size:12px;line-height:1.25;font-weight:900;letter-spacing:.08em;text-transform:uppercase;">${escapeHtml(card.label)}</div>
                  <div style="width:100%;margin:10px auto 0;text-align:center;color:#7c2d12;font-size:22px;line-height:1.1;font-weight:950;">${escapeHtml(card.value)}</div>
                </center>
              </td>
            </tr>
          </table>
        </td>
      `
    )
    .join('');

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
      <div style="margin-top:18px;padding:16px;border-radius:18px;background:#f8fafc;border:1px solid #cbd5e1;">
        <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#334155;">Recommendation Signals</div>
        <ul style="margin:10px 0 0;padding-left:18px;color:#334155;font-size:14px;line-height:1.65;">
          ${details.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join('')}
        </ul>
      </div>
    `
    : '';

  const messageHtml = details.message
    ? `
      <div style="margin-top:18px;padding:16px;border-radius:18px;background:#fff7ed;border:1px solid #fdba74;">
        <div style="font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.1em;color:#9a3412;">Borrower Message</div>
        <p style="margin:8px 0 0;color:#7c2d12;font-size:14px;line-height:1.65;">${escapeHtml(details.message)}</p>
      </div>
    `
    : '';

  const html = `
    <div style="margin:0;padding:0;background:#fff7ed;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#fff7ed;padding:28px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;background:#ffffff;border-radius:26px;overflow:hidden;border:1px solid #fed7aa;box-shadow:0 22px 60px rgba(194,65,12,.18);">
              <tr>
                <td style="padding:24px 28px;background:linear-gradient(135deg,#fff7ed,#ffedd5 48%,#dbeafe);border-bottom:1px solid #fed7aa;">
                  <table role="presentation" style="width:100%;">
                    <tr>
                      <td style="vertical-align:middle;">
                        <img src="${escapeHtml(logoUrl)}" alt="BISU Home Loans" width="210" style="display:block;width:210px;max-width:210px;height:auto;max-height:56px;border:0;outline:none;text-decoration:none;object-fit:contain;" />
                      </td>
                      <td style="vertical-align:middle;text-align:right;">
                        <span style="display:inline-block;padding:8px 12px;border-radius:999px;background:#ea580c;color:#ffffff;font-size:12px;font-weight:950;letter-spacing:.1em;text-transform:uppercase;">Web Lead</span>
                        <span style="display:inline-block;margin-left:8px;padding:8px 12px;border-radius:999px;background:#0f4c81;color:#ffffff;font-size:12px;font-weight:950;letter-spacing:.1em;text-transform:uppercase;">${escapeHtml(urgencyLabel)}</span>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:34px 28px 12px;text-align:center;">
                  <p style="margin:0 0 10px;color:#ea580c;font-size:13px;font-weight:950;letter-spacing:.14em;text-transform:uppercase;">BISU Website Lead</p>
                  <h1 style="margin:0 auto 10px;max-width:640px;color:#9a3412;font-size:34px;line-height:1.12;font-weight:950;">${escapeHtml(name)} submitted a website form</h1>
                  <p style="margin:0 auto;max-width:590px;color:#475569;font-size:15px;line-height:1.7;">
                    ${escapeHtml(lead.assignedUser ? 'This lead came through a loan officer webform and needs fast follow-up.' : 'This generic website inquiry is unassigned and needs leadership review now.')}
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding:18px 18px 18px;">
                  <table role="presentation" align="center" style="width:100%;max-width:710px;margin:0 auto;border-collapse:separate;border-spacing:0;">
                    <tr>${metricHtml}</tr>
                  </table>
                </td>
              </tr>
              <tr>
                <td style="padding:0 28px 30px;">
                  <div style="border-radius:20px;border:1px solid #e2e8f0;background:#ffffff;padding:18px 20px;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
                      ${rows}
                    </table>
                  </div>
                  ${reasonHtml}
                  ${messageHtml}
                  <div style="margin-top:24px;text-align:center;">
                    <a href="${escapeHtml(href)}" style="display:inline-block;border-radius:14px;background:linear-gradient(135deg,#ea580c,#c2410c);color:#ffffff;text-decoration:none;font-weight:900;padding:15px 24px;border:1px solid #9a3412;letter-spacing:.01em;">Open Website Lead Now</a>
                    <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.5;">
                      This is not a Broker Launch notification. It came directly from bisuhomeloans.com.
                    </p>
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
  const brandLogo = await getInlineWebsiteLeadLogoAttachment();
  const email = buildWebsiteLeadEmail({
    lead,
    audience: 'assigned-lo',
    logoUrl: brandLogo.logoUrl,
  });
  await sendEmail({
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
    inlineAttachments: brandLogo.inlineAttachments,
    senderCategory: 'leads',
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

  const brandLogo = await getInlineWebsiteLeadLogoAttachment();
  const email = buildWebsiteLeadEmail({
    lead,
    audience: 'admin',
    logoUrl: brandLogo.logoUrl,
  });
  const results = await Promise.allSettled(
    admins.map((admin) =>
      sendEmail({
        to: admin.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
        inlineAttachments: brandLogo.inlineAttachments,
        senderCategory: 'leads',
        label: 'bisu-website-lead-admin',
      })
    )
  );

  const failures = results.filter((result) => result.status === 'rejected');
  if (failures.length > 0) {
    console.warn(
      `[bisu-website-leads] ${failures.length} of ${admins.length} admin email deliveries failed for lead ${leadId}:`,
      failures.map((result) =>
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      )
    );
  }

  const sent = results.length - failures.length;
  if (sent === 0) {
    throw new Error(
      `BISU Website admin email failed for all ${admins.length} admin recipient(s).`
    );
  }

  return { sent, failed: failures.length };
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
