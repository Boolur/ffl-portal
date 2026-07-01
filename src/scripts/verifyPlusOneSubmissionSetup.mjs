import { NotificationOutboxEventType, PrismaClient, TaskKind } from '@prisma/client';

const prisma = new PrismaClient();

async function enumValueExists(typeName, enumLabel) {
  const rows = await prisma.$queryRaw`
    SELECT enumlabel
    FROM pg_enum
    WHERE enumtypid = ${typeName}::regtype
      AND enumlabel = ${enumLabel}
  `;
  return rows.length > 0;
}

async function main() {
  const [hasTaskKind, hasOutboxEventType] = await Promise.all([
    enumValueExists('"TaskKind"', 'SUBMIT_PLUS_ONE'),
    enumValueExists('"NotificationOutboxEventType"', 'PLUS_ONE_SUBMITTED'),
  ]);

  if (!hasTaskKind || !hasOutboxEventType) {
    console.error('Submit +1 verification blocked: apply the Prisma migration first.');
    console.error(`- TaskKind.SUBMIT_PLUS_ONE present: ${hasTaskKind}`);
    console.error(`- NotificationOutboxEventType.PLUS_ONE_SUBMITTED present: ${hasOutboxEventType}`);
    process.exitCode = 1;
    return;
  }

  const [taskCount, missingReportableDataCount, outboxCount, recentTasks] = await Promise.all([
    prisma.task.count({ where: { kind: TaskKind.SUBMIT_PLUS_ONE } }),
    prisma.task.count({
      where: {
        kind: TaskKind.SUBMIT_PLUS_ONE,
        OR: [
          { submissionData: { equals: null } },
          { submissionData: { path: ['workflowVersion'], not: 'plus-one-v1' } },
          { submissionData: { path: ['projectedRevenue'], equals: null } },
          { submissionData: { path: ['leadSource'], equals: null } },
        ],
      },
    }),
    prisma.notificationOutbox.count({
      where: { eventType: NotificationOutboxEventType.PLUS_ONE_SUBMITTED },
    }),
    prisma.task.findMany({
      where: { kind: TaskKind.SUBMIT_PLUS_ONE },
      select: {
        id: true,
        status: true,
        createdAt: true,
        loan: { select: { loanNumber: true, borrowerName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  console.log('Submit +1 verification');
  console.log(`+1 task rows: ${taskCount}`);
  console.log(`+1 rows missing reportable submissionData: ${missingReportableDataCount}`);
  console.log(`+1 outbox events: ${outboxCount}`);
  for (const task of recentTasks) {
    console.log(
      `- ${task.id} | ${task.status} | ${task.loan.loanNumber} (${task.loan.borrowerName}) | ${task.createdAt.toISOString()}`
    );
  }

  if (missingReportableDataCount > 0) {
    process.exitCode = 1;
    console.error('Verification failed: some Submit +1 rows are missing required reporting fields.');
  }
}

main()
  .catch((error) => {
    console.error('Verification failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
