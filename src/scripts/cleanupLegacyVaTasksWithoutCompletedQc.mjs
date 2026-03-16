import { PrismaClient, TaskKind, TaskStatus } from '@prisma/client';

const prisma = new PrismaClient();

const VA_KINDS = [TaskKind.VA_TITLE, TaskKind.VA_HOI, TaskKind.VA_PAYOFF, TaskKind.VA_APPRAISAL];

async function main() {
  const apply = process.argv.includes('--apply');

  const orphanVaTasks = await prisma.task.findMany({
    where: {
      kind: { in: VA_KINDS },
      loan: {
        tasks: {
          none: {
            kind: TaskKind.SUBMIT_QC,
            status: TaskStatus.COMPLETED,
          },
        },
      },
    },
    select: {
      id: true,
      kind: true,
      status: true,
      loanId: true,
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (orphanVaTasks.length === 0) {
    console.log('No misrouted VA tasks found.');
    return;
  }

  const affectedLoanIds = new Set(orphanVaTasks.map((task) => task.loanId));
  console.log(
    `Found ${orphanVaTasks.length} misrouted VA task(s) across ${affectedLoanIds.size} loan(s).`
  );

  for (const task of orphanVaTasks.slice(0, 20)) {
    const loanLabel = `${task.loan.loanNumber} (${task.loan.borrowerName})`;
    console.log(`- ${task.id} | ${task.kind} | ${task.status} | ${loanLabel}`);
  }

  if (orphanVaTasks.length > 20) {
    console.log(`...and ${orphanVaTasks.length - 20} more`);
  }

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to delete these tasks.');
    return;
  }

  const deleted = await prisma.task.deleteMany({
    where: {
      id: { in: orphanVaTasks.map((task) => task.id) },
    },
  });

  console.log(`Deleted ${deleted.count} misrouted VA task(s).`);
}

main()
  .catch((error) => {
    console.error('Cleanup failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
