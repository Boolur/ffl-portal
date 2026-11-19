import type { Prisma } from '@prisma/client';

// This projection is the durable identity fingerprint used in saved diagnostic
// runs. Keep its shape stable so older private results can be revalidated.
export const diagnosticSourceSelect = {
  id: true,
  loanId: true,
  sheet: true,
  archivedAt: true,
  version: true,
  loan: {
    select: {
      id: true,
      loanNumber: true,
      borrowerName: true,
      borrowerFirstName: true,
      borrowerLastName: true,
      updatedAt: true,
      loanOfficer: { select: { email: true, name: true } },
      secondaryLoanOfficer: { select: { email: true } },
    },
  },
  ariveSync: { select: { ariveGuid: true, verifiedOriginatorEmail: true } },
} satisfies Prisma.ProcessingPipelineLoanSelect;
export type DiagnosticSource = Prisma.ProcessingPipelineLoanGetPayload<{ select: typeof diagnosticSourceSelect }>;
