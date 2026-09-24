import 'server-only';

import { IntegrationServiceTrigger } from '@prisma/client';
import { after } from 'next/server';
import { forwardLeadToBonzo } from '@/lib/bonzoForward';
import { isEmailOnlyWebLead } from '@/lib/leadAssignmentPolicy';
import { prisma } from '@/lib/prisma';
import { runServiceTriggers } from '@/lib/services';
import {
  notifyAdminsOfWebsiteLead,
  sendAssignedWebsiteLeadEmail,
} from '@/lib/websiteLeadNotifications';

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
  const lead = await prisma.lead.findUnique({
    where: { id: input.leadId },
    select: { source: true, firstName: true, lastName: true },
  });
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
    schedule('BISU Website assigned LO email', () =>
      sendAssignedWebsiteLeadEmail(input.leadId),
    );
    schedule('BISU Website admin email', () =>
      notifyAdminsOfWebsiteLead(input.leadId),
    );
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
