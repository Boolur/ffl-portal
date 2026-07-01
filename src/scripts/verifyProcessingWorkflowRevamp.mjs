import { PrismaClient, TaskKind, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const retiredRoles = [
  UserRole.QC,
  UserRole.VA,
  UserRole.VA_TITLE,
  UserRole.VA_PAYOFF,
  UserRole.VA_APPRAISAL,
  ...(UserRole.VA_HOI ? [UserRole.VA_HOI] : []),
];

const legacyTaskKinds = [
  TaskKind.SUBMIT_QC,
  TaskKind.VA_TITLE,
  TaskKind.VA_HOI,
  TaskKind.VA_PAYOFF,
  TaskKind.VA_APPRAISAL,
];

async function main() {
  const taskKindRows = await prisma.$queryRaw`
    SELECT enumlabel
    FROM pg_enum
    WHERE enumtypid = '"TaskKind"'::regtype
      AND enumlabel = 'SUBMIT_PROCESSING'
  `;
  if (taskKindRows.length === 0) {
    console.error(
      'Verification blocked: database enum TaskKind is missing SUBMIT_PROCESSING. Apply the new Prisma migration before running this verification.'
    );
    process.exitCode = 1;
    return;
  }

  const [activeRetiredUsers, openLegacyTasks, processingFanoutLoans] = await Promise.all([
    prisma.user.findMany({
      where: {
        active: true,
        OR: [
          { role: { in: retiredRoles } },
          ...retiredRoles.map((role) => ({ roles: { has: role } })),
        ],
      },
      select: { id: true, name: true, email: true, role: true, roles: true },
      orderBy: { name: 'asc' },
    }),
    prisma.task.findMany({
      where: {
        kind: { in: legacyTaskKinds },
        status: { not: 'COMPLETED' },
      },
      select: {
        id: true,
        kind: true,
        status: true,
        assignedRole: true,
        loan: { select: { loanNumber: true, borrowerName: true } },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    }),
    prisma.loan.findMany({
      where: {
        tasks: { some: { kind: TaskKind.SUBMIT_PROCESSING } },
        AND: [
          {
            tasks: {
              some: {
                kind: { in: [TaskKind.VA_TITLE, TaskKind.VA_HOI, TaskKind.VA_PAYOFF, TaskKind.VA_APPRAISAL] },
                createdAt: {
                  gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
                },
              },
            },
          },
        ],
      },
      select: { loanNumber: true, borrowerName: true },
      take: 50,
    }),
  ]);

  console.log('Processing workflow revamp verification');
  console.log(`Active users with retired roles: ${activeRetiredUsers.length}`);
  for (const user of activeRetiredUsers.slice(0, 20)) {
    console.log(`- ${user.name} <${user.email}> | primary=${user.role} | roles=${user.roles.join(',')}`);
  }

  console.log(`Open legacy QC/VA tasks still stored: ${openLegacyTasks.length}${openLegacyTasks.length === 50 ? '+' : ''}`);
  for (const task of openLegacyTasks.slice(0, 20)) {
    console.log(`- ${task.id} | ${task.kind} | ${task.status} | ${task.loan.loanNumber} (${task.loan.borrowerName})`);
  }

  console.log(`Loans with Processing plus recent VA fanout tasks: ${processingFanoutLoans.length}`);
  for (const loan of processingFanoutLoans.slice(0, 20)) {
    console.log(`- ${loan.loanNumber} (${loan.borrowerName})`);
  }

  if (activeRetiredUsers.length > 0) {
    process.exitCode = 1;
    console.error('Verification failed: deactivate or remove retired roles from active users.');
  }
  if (processingFanoutLoans.length > 0) {
    process.exitCode = 1;
    console.error('Verification failed: Processing submissions should not create VA fanout tasks.');
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
