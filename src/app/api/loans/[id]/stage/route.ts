import { NextResponse } from 'next/server';
import { changeLoanStage } from '@/lib/workflow';
import { LoanStage } from '@prisma/client';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await request.json();
  const { stage, userId } = body;
  
  try {
    const loan = await changeLoanStage(id, stage as LoanStage, userId);
    return NextResponse.json(loan);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Failed to update stage' }, { status: 500 });
  }
}
