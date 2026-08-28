import 'server-only';

import { OnboardingDocumentStatus, Prisma } from '@prisma/client';
import { prisma } from './prisma';
import { getESignAdapter } from './esign';
import {
  getOnboardingDocumentsBucket,
  getSupabaseAdmin,
} from './supabaseAdmin';

function toDocumentStatus(value: string) {
  const normalized = value.trim().toLowerCase();
  if (['completed', 'signed'].includes(normalized)) return OnboardingDocumentStatus.SIGNED;
  if (['declined', 'rejected'].includes(normalized)) return OnboardingDocumentStatus.REJECTED;
  if (['voided', 'cancelled'].includes(normalized)) return OnboardingDocumentStatus.VOIDED;
  if (['created', 'sent', 'delivered', 'pending'].includes(normalized)) {
    return OnboardingDocumentStatus.PENDING_SIGNATURE;
  }
  return null;
}

export async function processOnboardingESignEvent(input: {
  providerEventId: string;
  envelopeId: string;
  eventType: string;
  payload: Record<string, unknown>;
}) {
  const status = toDocumentStatus(String(input.payload.status || input.eventType));
  if (!status) return { success: false as const, error: 'Unsupported event status' };

  const document = await prisma.onboardingDocument.findUnique({
    where: { externalEnvelopeId: input.envelopeId },
    select: { id: true, caseId: true, status: true },
  });
  const existing = await prisma.onboardingESignEvent.findUnique({
    where: { providerEventId: input.providerEventId },
  });

  if (!document) {
    if (!existing) {
      await prisma.onboardingESignEvent.create({
        data: {
          providerEventId: input.providerEventId,
          envelopeId: input.envelopeId,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonObject,
        },
      });
    }
    return { success: true as const, unmatched: true as const };
  }

  if (existing?.documentId) {
    return { success: true as const, duplicate: true as const };
  }
  if (existing) {
    const claim = await prisma.onboardingESignEvent.updateMany({
      where: { id: existing.id, documentId: null },
      data: { documentId: document.id },
    });
    if (claim.count !== 1) return { success: true as const, duplicate: true as const };
  } else {
    try {
      await prisma.onboardingESignEvent.create({
        data: {
          providerEventId: input.providerEventId,
          documentId: document.id,
          envelopeId: input.envelopeId,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonObject,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return { success: true as const, duplicate: true as const };
      }
      throw error;
    }
  }

  try {
    let signedStoragePath: string | undefined;
    if (status === OnboardingDocumentStatus.SIGNED) {
      const adapter = getESignAdapter();
      if (!adapter) throw new Error('E-sign provider is not configured');
      const signed = await adapter.downloadSignedDocument(input.envelopeId);
      signedStoragePath = `onboarding/${document.caseId}/signed/${document.id}-signed.pdf`;
      const { error } = await getSupabaseAdmin()
        .storage.from(getOnboardingDocumentsBucket())
        .upload(signedStoragePath, Buffer.from(signed.bytes), {
          contentType: signed.contentType,
          upsert: true,
        });
      if (error) throw error;
    }

    const allowedCurrentStatuses =
      status === OnboardingDocumentStatus.PENDING_SIGNATURE
        ? [OnboardingDocumentStatus.PENDING_SIGNATURE]
        : status === OnboardingDocumentStatus.SIGNED
          ? [OnboardingDocumentStatus.PENDING_SIGNATURE, OnboardingDocumentStatus.SIGNED]
          : status === OnboardingDocumentStatus.REJECTED
            ? [OnboardingDocumentStatus.PENDING_SIGNATURE]
            : [
                OnboardingDocumentStatus.PENDING_SIGNATURE,
                OnboardingDocumentStatus.REJECTED,
                OnboardingDocumentStatus.SIGNED,
              ];
    await prisma.$transaction(async (tx) => {
      const update = await tx.onboardingDocument.updateMany({
        where: { id: document.id, status: { in: allowedCurrentStatuses } },
        data: {
          status,
          signerStatus: input.payload as Prisma.InputJsonObject,
          signedStoragePath,
          webhookUpdatedAt: new Date(),
        },
      });
      await tx.onboardingEvent.create({
        data: {
          caseId: document.caseId,
          action: update.count === 1 ? 'ESIGN_WEBHOOK_PROCESSED' : 'ESIGN_WEBHOOK_IGNORED',
          details: {
            documentId: document.id,
            providerEventId: input.providerEventId,
            eventType: input.eventType,
            status,
          },
        },
      });
    });
    return { success: true as const };
  } catch (error) {
    await prisma.onboardingESignEvent.updateMany({
      where: { providerEventId: input.providerEventId },
      data: { documentId: null },
    });
    throw error;
  }
}

export async function replayUnmatchedOnboardingESignEvents(envelopeId: string) {
  const events = await prisma.onboardingESignEvent.findMany({
    where: { envelopeId, documentId: null },
    orderBy: { processedAt: 'asc' },
  });
  for (const event of events) {
    const payload =
      event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
        ? (event.payload as Record<string, unknown>)
        : {};
    await processOnboardingESignEvent({
      providerEventId: event.providerEventId,
      envelopeId,
      eventType: event.eventType,
      payload,
    });
  }
  return events.length;
}
