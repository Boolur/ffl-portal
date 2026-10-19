import { prisma } from '@/lib/prisma';
import { receiveShapeWebhook } from '@/lib/shapeWebhook';
import { storeShapeWebhook } from '@/lib/shapeWebhookStore';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return receiveShapeWebhook(request, capture => storeShapeWebhook(prisma, capture));
}
