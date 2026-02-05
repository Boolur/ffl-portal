const { PrismaClient, UserRole, LoanStage } = require('@prisma/client');
require('dotenv').config();

const prisma = new PrismaClient();

async function main() {
  // 1. Create Users
  const admin = await prisma.user.upsert({
    where: { email: 'admin@ffl.com' },
    update: {},
    create: {
      email: 'admin@ffl.com',
      name: 'Admin User',
      role: UserRole.ADMIN,
      passwordHash: 'hashed_password_here', // In real app, use bcrypt
    },
  });

  const lo = await prisma.user.upsert({
    where: { email: 'lo@ffl.com' },
    update: {},
    create: {
      email: 'lo@ffl.com',
      name: 'Alex Rivera',
      role: UserRole.LOAN_OFFICER,
      passwordHash: 'hashed_password_here',
    },
  });

  const processor = await prisma.user.upsert({
    where: { email: 'proc@ffl.com' },
    update: {},
    create: {
      email: 'proc@ffl.com',
      name: 'Sarah Processor',
      role: UserRole.PROCESSOR_SR,
      passwordHash: 'hashed_password_here',
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

  // 3. Create a Dummy Loan
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
