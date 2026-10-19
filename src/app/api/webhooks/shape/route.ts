import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { receiveShapeWebhook } from '@/lib/shapeWebhook';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  return receiveShapeWebhook(request, async ({ body, headers }) => {
    const event = await prisma.webhookInboxEvent.create({
      data: {
        source: 'shape',
        vendorSlug: null,
        method: 'POST',
        headers,
        body: body as Prisma.InputJsonValue,
        status: 'PENDING',
        errorMessage: 'Captured; awaiting Shape field mapping. No downstream actions performed.',
      },
      select: { id: true },
    });
    return event.id;
  });
}
