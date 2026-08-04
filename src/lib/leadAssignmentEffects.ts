import 'server-only';

import { IntegrationServiceTrigger } from '@prisma/client';
import { after } from 'next/server';
import { forwardLeadToBonzo } from '@/lib/bonzoForward';
import { sendEmail } from '@/lib/email';
import { isEmailOnlyWebLead } from '@/lib/leadAssignmentPolicy';
import { prisma } from '@/lib/prisma';
import { runServiceTriggers } from '@/lib/services';

function schedule(label: string, fn: () => Promise<void>) {
  after(async () => {
    try {
      await fn();
    } catch (error) {
      console.warn(`[lead-assignment] ${label} failed:`, error);
    }
  });
}

export async function runLeadAssignmentEffects(input: {
  leadId: string;
  userId: string;
  firstName?: string | null;
  lastName?: string | null;
  assignmentLabel: string;
}) {
  const [lead, user] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: input.leadId },
      select: { source: true, firstName: true, lastName: true },
    }),
    prisma.user.findUnique({
      where: { id: input.userId },
      select: { email: true },
    }),
  ]);
  const name =
    [input.firstName ?? lead?.firstName, input.lastName ?? lead?.lastName]
      .filter(Boolean)
      .join(' ')
      .trim() || 'Unknown';
  try {
    await prisma.notification.create({
      data: {
        userId: input.userId,
        eventLabel: 'LEAD_ASSIGNED',
        title: 'New Lead Assigned',
        message: `New lead: ${name} — ${input.assignmentLabel}`,
        href: '/leads',
      },
    });
  } catch (error) {
    console.error('[lead-notification] failed', error);
  }

  if (isEmailOnlyWebLead(lead?.source)) {
    if (user?.email) {
      const portalUrl = (process.env.NEXTAUTH_URL || 'http://localhost:3000').replace(/\/$/, '');
      schedule('WebLead assignment email', async () => {
        await sendEmail({
          to: user.email,
          subject: `[FFL Portal] New Website Lead: ${name}`,
          text: [
            `A new BISU website lead for ${name} has been assigned to you.`,
            '',
            `Open the lead in the FFL Portal: ${portalUrl}/leads`,
          ].join('\n'),
          label: 'weblead-assignment',
        });
      });
    }
    return;
  }

  schedule('Bonzo forward after assignment', () =>
    forwardLeadToBonzo(input.leadId, input.userId),
  );
  schedule('ON_ASSIGN triggers after assignment', () =>
    runServiceTriggers(input.leadId, IntegrationServiceTrigger.ON_ASSIGN),
  );
  schedule('DELAY_AFTER_ASSIGN triggers after assignment', () =>
    runServiceTriggers(input.leadId, IntegrationServiceTrigger.DELAY_AFTER_ASSIGN),
  );
}
