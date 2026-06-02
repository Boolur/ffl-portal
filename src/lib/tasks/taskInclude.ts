import { Prisma } from '@prisma/client';

export const taskListInclude = {
  loan: {
    select: {
      loanNumber: true,
      borrowerName: true,
      stage: true,
      loanOfficer: {
        select: {
          name: true,
        },
      },
      secondaryLoanOfficer: {
        select: {
          name: true,
        },
      },
    },
  },
  attachments: {
    select: {
      id: true,
      filename: true,
      purpose: true,
      createdAt: true,
      uploadedBy: {
        select: {
          name: true,
          role: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' as const },
  },
  assignedUser: {
    select: {
      id: true,
      name: true,
      role: true,
    },
  },
  parentTask: {
    select: {
      kind: true,
      assignedRole: true,
      title: true,
      submissionData: true,
    },
  },
} satisfies Prisma.TaskInclude;

export type RawTaskWithIncludes = Prisma.TaskGetPayload<{
  include: typeof taskListInclude;
}>;
