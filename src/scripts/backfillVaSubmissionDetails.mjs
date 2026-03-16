import { PrismaClient, TaskKind, TaskStatus } from '@prisma/client';

const prisma = new PrismaClient();

const VA_KINDS = [TaskKind.VA_TITLE, TaskKind.VA_HOI, TaskKind.VA_PAYOFF, TaskKind.VA_APPRAISAL];

function asSubmissionObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value };
  }
  return {};
}

function hasRenderableSubmissionFields(data) {
  return Object.entries(data).some(([key, value]) => {
    if (key === 'notesHistory') return false;
    return (
      value !== null &&
      (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')
    );
  });
}

function buildLoanSubmissionFallback(loan) {
  const borrowerName = (loan.borrowerName || '').trim();
  const [firstName, ...lastNameParts] = borrowerName.split(/\s+/).filter(Boolean);
  const lastName = lastNameParts.join(' ');
  return {
    arriveLoanNumber: loan.loanNumber,
    borrowerFirstName: firstName || borrowerName || 'Unknown',
    borrowerLastName: lastName || '',
    borrowerPhone: loan.borrowerPhone || '',
    borrowerEmail: loan.borrowerEmail || '',
    loanAmount: loan.amount?.toString?.() ?? '',
    ...(loan.propertyAddress ? { subjectPropertyAddress: loan.propertyAddress } : {}),
  };
}

function mergeSubmissionDataWithLoanFallback(source, fallback) {
  const sourceObject = asSubmissionObject(source);
  const merged = { ...fallback, ...sourceObject };
  if (!hasRenderableSubmissionFields(merged)) {
    return fallback;
  }
  return merged;
}

async function main() {
  const vaTasks = await prisma.task.findMany({
    where: { kind: { in: VA_KINDS } },
    select: {
      id: true,
      loanId: true,
      kind: true,
      submissionData: true,
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
          borrowerPhone: true,
          borrowerEmail: true,
          amount: true,
          propertyAddress: true,
          tasks: {
            where: {
              kind: TaskKind.SUBMIT_QC,
              status: TaskStatus.COMPLETED,
            },
            select: {
              id: true,
              submissionData: true,
              updatedAt: true,
            },
            orderBy: {
              updatedAt: 'desc',
            },
            take: 1,
          },
        },
      },
    },
  });

  let updated = 0;

  for (const task of vaTasks) {
    const current = asSubmissionObject(task.submissionData);
    if (hasRenderableSubmissionFields(current)) continue;

    const fallback = buildLoanSubmissionFallback(task.loan);
    const qcSource = task.loan.tasks[0]?.submissionData ?? null;
    const merged = mergeSubmissionDataWithLoanFallback(qcSource, fallback);

    await prisma.task.update({
      where: { id: task.id },
      data: {
        submissionData: merged,
      },
    });
    updated += 1;
  }

  console.log(`Backfill complete. Updated ${updated} VA task(s).`);
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
