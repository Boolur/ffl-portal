const { PrismaClient, UserRole, LoanStage } = require('@prisma/client');
const { hash } = require('bcryptjs');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  // 1. Create Users
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@ffl.com';
  const adminName = process.env.ADMIN_NAME || 'Admin User';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
  const defaultUserPassword = process.env.DEFAULT_USER_PASSWORD || adminPassword;

  const adminPasswordHash = await hash(adminPassword, 10);
  const defaultUserPasswordHash = await hash(defaultUserPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      name: adminName,
      passwordHash: adminPasswordHash,
      active: true,
    },
    create: {
      email: adminEmail,
      name: adminName,
      role: UserRole.ADMIN,
      passwordHash: adminPasswordHash,
    },
  });

  const lo = await prisma.user.upsert({
    where: { email: 'lo@ffl.com' },
    update: {
      passwordHash: defaultUserPasswordHash,
      active: true,
    },
    create: {
      email: 'lo@ffl.com',
      name: 'Alex Rivera',
      role: UserRole.LOAN_OFFICER,
      passwordHash: defaultUserPasswordHash,
    },
  });

  const processor = await prisma.user.upsert({
    where: { email: 'proc@ffl.com' },
    update: {
      passwordHash: defaultUserPasswordHash,
      active: true,
    },
    create: {
      email: 'proc@ffl.com',
      name: 'Sarah Processor',
      role: UserRole.PROCESSOR_SR,
      passwordHash: defaultUserPasswordHash,
    },
  });

  await prisma.externalUser.upsert({
    where: {
      provider_externalId: {
        provider: 'LEAD_MAILBOX',
        externalId: 'user_002_demo',
      },
    },
    update: {
      userId: lo.id,
    },
    create: {
      provider: 'LEAD_MAILBOX',
      externalId: 'user_002_demo',
      userId: lo.id,
    },
  });

  // 2. Create Task Templates (Example for Disclosures)
  await prisma.taskTemplate.createMany({
    data: [
      {
        stage: LoanStage.DISCLOSURES_PENDING,
        title: 'Prepare Initial Disclosures',
        description: 'Generate LE and initial packet in Encompass/Arrive',
        assignedRole: UserRole.DISCLOSURE_SPECIALIST,
        dueOffsetDays: 1,
      },
      {
        stage: LoanStage.DISCLOSURES_PENDING,
        title: 'Send Disclosures to Borrower',
        description: 'Email via E-Sign platform',
        assignedRole: UserRole.DISCLOSURE_SPECIALIST,
        dueOffsetDays: 1,
      },
      {
        stage: LoanStage.SUBMIT_TO_UW_PREP,
        title: 'Order Appraisal',
        description: 'Order through AMC',
        assignedRole: UserRole.VA,
        dueOffsetDays: 2,
      },
      {
        stage: LoanStage.SUBMIT_TO_UW_PREP,
        title: 'Order Title Work',
        description: 'Contact title company',
        assignedRole: UserRole.VA,
        dueOffsetDays: 2,
      },
    ],
    skipDuplicates: true, 
  });

  // 3. Create default pipeline stages for LO
  const existingStages = await prisma.pipelineStage.count({
    where: { userId: lo.id },
  });

  if (existingStages === 0) {
    await prisma.pipelineStage.createMany({
      data: [
        { userId: lo.id, name: 'New Lead', order: 0, color: '#60A5FA', isDefault: true },
        { userId: lo.id, name: 'Contacted', order: 1, color: '#34D399', isDefault: true },
        { userId: lo.id, name: 'Processing', order: 2, color: '#FBBF24', isDefault: true },
        { userId: lo.id, name: 'Conditional Approval', order: 3, color: '#F97316', isDefault: true },
        { userId: lo.id, name: 'Approved', order: 4, color: '#22C55E', isDefault: true },
        { userId: lo.id, name: 'Funded', order: 5, color: '#0EA5E9', isDefault: true },
        { userId: lo.id, name: 'Closed / Lost', order: 6, color: '#94A3B8', isDefault: true },
      ],
    });
  }

  const defaultStage = await prisma.pipelineStage.findFirst({
    where: { userId: lo.id },
    orderBy: { order: 'asc' },
  });

  // 4. Create a Dummy Loan
  const loan = await prisma.loan.upsert({
    where: { loanNumber: 'LN-2024-001' },
    update: {},
    create: {
      loanNumber: 'LN-2024-001',
      borrowerName: 'John Smith',
      amount: 450000.00,
      program: 'Conv 30yr',
      propertyAddress: '123 Main St, Austin, TX',
      stage: LoanStage.INTAKE,
      pipelineStageId: defaultStage?.id,
      loanOfficerId: lo.id,
    },
  });

  console.log({ admin, lo, processor, loan });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
