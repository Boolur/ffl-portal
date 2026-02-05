import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { LoanStage } from '@prisma/client';

type LeadMailboxPayload = {
  lead_id?: string;
  user_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  property_address?: string;
  property_city?: string;
  property_state?: string;
  property_zip?: string;
  loan_program?: string;
  loan_amount?: string | number;
  notes?: string[];
  ssn?: string;
  [key: string]: unknown;
};

const PROVIDER = 'LEAD_MAILBOX';

const scrubPayload = (payload: LeadMailboxPayload) => {
  const { ssn, ...safePayload } = payload;
  return safePayload;
};

const parseAmount = (value?: string | number) => {
  if (value === undefined || value === null) return 0;
  const normalized = String(value).replace(/[^0-9.-]/g, '');
  return Number(normalized) || 0;
};

const buildBorrowerName = (payload: LeadMailboxPayload) => {
  const fullName = `${payload.first_name || ''} ${payload.last_name || ''}`.trim();
  if (fullName.length > 0) return fullName;
  if (payload.email) return payload.email;
  return 'Unknown Borrower';
};

const buildPropertyAddress = (payload: LeadMailboxPayload) => {
  const parts = [
    payload.property_address,
    payload.property_city,
    payload.property_state,
    payload.property_zip,
  ].filter((part) => part && String(part).trim().length > 0);
  return parts.join(', ') || null;
};

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as LeadMailboxPayload;
    const leadId = payload.lead_id?.trim();
    const externalUserId = payload.user_id?.trim();

    if (!leadId || !externalUserId) {
      return NextResponse.json(
        { error: 'lead_id and user_id are required' },
        { status: 400 }
      );
    }

    const existing = await prisma.leadMailboxLead.findUnique({
      where: { leadId },
      select: { id: true, loanId: true },
    });

    if (existing) {
      return NextResponse.json({ status: 'duplicate', loanId: existing.loanId });
    }

    const mapping = await prisma.externalUser.findUnique({
      where: {
        provider_externalId: {
          provider: PROVIDER,
          externalId: externalUserId,
        },
      },
      include: { user: true },
    });

    if (!mapping) {
      return NextResponse.json(
        { error: 'User mapping not found for external user_id' },
        { status: 404 }
      );
    }

    const defaultStage = await prisma.pipelineStage.findFirst({
      where: { userId: mapping.userId },
      orderBy: { order: 'asc' },
    });

    const loan = await prisma.loan.create({
      data: {
        loanNumber: `LM-${leadId}`,
        borrowerName: buildBorrowerName(payload),
        amount: parseAmount(payload.loan_amount),
        program: payload.loan_program || null,
        propertyAddress: buildPropertyAddress(payload),
        stage: LoanStage.INTAKE,
        loanOfficerId: mapping.userId,
        pipelineStageId: defaultStage?.id || null,
      },
    });

    const safePayload = scrubPayload(payload);
    await prisma.leadMailboxLead.create({
      data: {
        leadId,
        userId: mapping.userId,
        loanId: loan.id,
        payload: safePayload,
      },
    });

    if (payload.notes && payload.notes.length > 0) {
      const noteBody = `Lead Mailbox:\n${payload.notes.join('\n')}`;
      await prisma.pipelineNote.create({
        data: {
          loanId: loan.id,
          userId: mapping.userId,
          body: noteBody,
        },
      });
    }

    return NextResponse.json({ status: 'created', loanId: loan.id });
  } catch (error) {
    console.error('Lead Mailbox webhook error', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
