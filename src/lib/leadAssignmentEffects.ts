import 'server-only';

import { IntegrationServiceTrigger } from '@prisma/client';
import { after } from 'next/server';
import { forwardLeadToBonzo } from '@/lib/bonzoForward';
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
  const name =
    [input.firstName, input.lastName].filter(Boolean).join(' ').trim() || 'Unknown';
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
