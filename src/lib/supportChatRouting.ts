import { prisma } from '@/lib/prisma';
import { ANY_ADMIN_ROLES } from '@/lib/adminTiers';
import { SupportDesk, UserRole } from '@prisma/client';

export const SUPPORT_DESK_LABELS: Record<SupportDesk, string> = {
  [SupportDesk.SCENARIO]: 'Scenario Desk',
  [SupportDesk.PRICING]: 'Pricing Desk',
  [SupportDesk.HELP]: 'Help Desk',
};

export type SupportRoutingContext = {
  lender?: string | null;
  loanType?: string | null;
  propertyState?: string | null;
};

function normalize(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function filterMatches(filters: string[], value?: string | null) {
  if (filters.length === 0) return true;
  const normalizedValue = normalize(value);
  if (!normalizedValue) return false;
  return filters.some((filter) => normalize(filter) === normalizedValue);
}

function specificity(filters: string[], value?: string | null) {
  if (filters.length === 0) return 0;
  return filterMatches(filters, value) ? 1 : -100;
}

export async function resolveSupportDeskRouting(
  desk: SupportDesk,
  context: SupportRoutingContext = {}
) {
  const assignments = await prisma.supportDeskAssignment.findMany({
    where: {
      desk,
      active: true,
      user: { active: true },
    },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          roles: true,
        },
      },
    },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  const matchedAssignments = assignments
    .map((assignment) => {
      const lenderScore = specificity(assignment.lenders, context.lender);
      const loanTypeScore = specificity(assignment.loanTypes, context.loanType);
      const stateScore = specificity(assignment.states, context.propertyState);
      const score = lenderScore + loanTypeScore + stateScore;
      return { assignment, score };
    })
    .filter(({ score }) => score >= 0)
    .sort((a, b) => b.score - a.score || a.assignment.sortOrder - b.assignment.sortOrder);

  const matchedUsers = matchedAssignments.map(({ assignment }) => assignment.user);
  if (matchedUsers.length > 0) {
    return {
      assignedUserId: matchedUsers[0].id,
      recipientUsers: matchedUsers,
      usedFallback: false,
    };
  }

  const fallbackUsers = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: { in: [...ANY_ADMIN_ROLES, UserRole.MANAGER] } },
        { roles: { hasSome: [...ANY_ADMIN_ROLES, UserRole.MANAGER] } },
      ],
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      roles: true,
    },
    orderBy: { name: 'asc' },
  });

  return {
    assignedUserId: fallbackUsers[0]?.id ?? null,
    recipientUsers: fallbackUsers,
    usedFallback: true,
  };
}
