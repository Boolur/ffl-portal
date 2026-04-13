import { PrismaClient, TaskKind } from '@prisma/client';

const prisma = new PrismaClient();
const TARGET_TITLE = 'Appraisal Specialist';

async function main() {
  const apply = process.argv.includes('--apply');

  const tasksToRename = await prisma.task.findMany({
    where: {
      kind: TaskKind.VA_APPRAISAL,
      title: { not: TARGET_TITLE },
    },
    select: {
      id: true,
      title: true,
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (tasksToRename.length === 0) {
    console.log('No appraisal task titles need backfill.');
    return;
  }

  console.log(`Found ${tasksToRename.length} appraisal task(s) to rename.`);
  for (const task of tasksToRename.slice(0, 20)) {
    const loanLabel = `${task.loan.loanNumber} (${task.loan.borrowerName})`;
    console.log(`- ${task.id} | "${task.title}" -> "${TARGET_TITLE}" | ${loanLabel}`);
  }
  if (tasksToRename.length > 20) {
    console.log(`...and ${tasksToRename.length - 20} more`);
  }

  if (!apply) {
    console.log('Dry run only. Re-run with --apply to update titles.');
    return;
  }

  const updateResult = await prisma.task.updateMany({
    where: {
      id: { in: tasksToRename.map((task) => task.id) },
    },
    data: { title: TARGET_TITLE },
  });

  console.log(`Updated ${updateResult.count} appraisal task title(s) to "${TARGET_TITLE}".`);
}

main()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
