'use server';

import { randomBytes, randomUUID } from 'crypto';
import { revalidatePath } from 'next/cache';
import { getServerSession } from 'next-auth';
import {
  NotificationOutboxEventType,
  NotificationOutboxStatus,
  OnboardingDocumentStatus,
  OnboardingDocumentVisibility,
  OnboardingItemOwner,
  OnboardingItemStatus,
  OnboardingStatus,
  Prisma,
  UserRole,
} from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  assignableRolesFor,
  canAssignRole,
  hasAnyAdminRole,
  isAdmin as isAdminRole,
} from '@/lib/adminTiers';
import {
  canCandidateEdit,
  canCandidateEditItem,
  canEditOnboardingItem,
  canManageOnboardingCase,
  canTransitionOnboardingStatus,
  canViewOnboardingCase,
  OnboardingActor,
} from '@/lib/onboardingAccess';
import { ensureOnboardingTemplate } from '@/lib/onboardingTemplate';
import {
  getOnboardingDocumentsBucket,
  getSignedUrlExpirySeconds,
  getSupabaseAdmin,
} from '@/lib/supabaseAdmin';
import { ensureWebsiteLoanOfficerProfileDraft } from '@/lib/websiteLoanOfficerProfiles';
import { isOnboardingEnabled } from '@/lib/onboardingFeature';
import { getESignAdapter } from '@/lib/esign';
import { replayUnmatchedOnboardingESignEvents } from '@/lib/onboardingEsignProcessor';
import { isCompleteOnboardingAddress } from '@/lib/onboardingAddress';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_DOCUMENT_BYTES = 15 * 1024 * 1024;
const ALLOWED_DOCUMENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

const normalizeEmail = (value: string) => value.trim().toLowerCase();
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const cleanText = (value: unknown, max = 500) =>
  typeof value === 'string' ? value.trim().slice(0, max) : '';
const toDate = (value: unknown) => {
  const text = cleanText(value, 30);
  if (!text) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};
const dateInput = (value: Date | null | undefined) =>
  value ? value.toISOString().slice(0, 10) : '';
const sanitizeFilename = (filename: string) =>
  cleanText(filename, 180).replace(/[^\w.\-()+\s]/g, '_').replace(/\s+/g, ' ') || 'file';
const matchesFileSignature = (bytes: Uint8Array, mimeType: string) => {
  const startsWith = (...signature: number[]) =>
    signature.every((value, index) => bytes[index] === value);
  if (mimeType === 'application/pdf') return startsWith(0x25, 0x50, 0x44, 0x46);
  if (mimeType === 'image/jpeg') return startsWith(0xff, 0xd8, 0xff);
  if (mimeType === 'image/png') return startsWith(0x89, 0x50, 0x4e, 0x47);
  if (mimeType === 'application/msword') return startsWith(0xd0, 0xcf, 0x11, 0xe0);
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return startsWith(0x50, 0x4b, 0x03, 0x04);
  }
  return false;
};

async function getActor(): Promise<OnboardingActor | null> {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, role: true, roles: true },
  });
  if (!user?.active) return null;
  return {
    userId,
    roles: user.roles.length ? user.roles : [user.role],
  };
}

async function isEligibleOnboardingOwner(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { active: true, role: true, roles: true },
  });
  if (!user?.active) return false;
  const roles = user.roles.length ? user.roles : [user.role];
  return roles.includes(UserRole.MANAGER) || hasAnyAdminRole(roles);
}

async function loadAccessCase(caseId: string) {
  return prisma.onboardingCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      userId: true,
      inviteId: true,
      ownerId: true,
      status: true,
      items: { select: { assignedUserId: true } },
    },
  });
}

async function recordEvent(
  tx: Prisma.TransactionClient,
  input: {
    caseId: string;
    actorId?: string | null;
    action: string;
    details?: Prisma.InputJsonValue;
    email?: { to: string; subject: string; text: string; href?: string };
  },
) {
  const event = await tx.onboardingEvent.create({
    data: {
      caseId: input.caseId,
      actorId: input.actorId ?? null,
      action: input.action,
      details: input.details,
    },
  });
  if (input.email) {
    await tx.notificationOutbox.create({
      data: {
        eventType: NotificationOutboxEventType.ONBOARDING,
        idempotencyKey: `onboarding:${event.id}`,
        payload: { ...input.email, caseId: input.caseId },
      },
    });
    const target = await tx.onboardingCase.findUnique({
      where: { id: input.caseId },
      select: { userId: true },
    });
    if (target?.userId && target.userId !== input.actorId) {
      await tx.notification.create({
        data: {
          userId: target.userId,
          eventLabel: 'ONBOARDING',
          title: input.email.subject,
          message: input.email.text.slice(0, 500),
          href: '/onboarding',
        },
      });
    }
  }
  return event;
}

async function processOnboardingFileDeletionJob(jobId: string) {
  const job = await prisma.onboardingFileDeletionJob.findUnique({ where: { id: jobId } });
  if (!job) return true;
  try {
    const bucket = getSupabaseAdmin().storage.from(getOnboardingDocumentsBucket());
    const caseFolder = `onboarding/${job.caseId}`;
    const listFolder = async (folder: string) => {
      const paths: string[] = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await bucket.list(folder, { limit: 1000, offset });
        if (error) throw error;
        const objects = data || [];
        paths.push(
          ...objects
            .filter((object) => Boolean(object.id))
            .map((object) => `${folder}/${object.name}`),
        );
        if (objects.length < 1000) break;
      }
      return paths;
    };
    const [rootPaths, signedPaths] = await Promise.all([
      listFolder(caseFolder),
      listFolder(`${caseFolder}/signed`),
    ]);
    const discoveredPaths = [...rootPaths, ...signedPaths];
    const paths = Array.from(new Set([...job.storagePaths, ...discoveredPaths]));
    if (paths.length > 0) {
      const { error } = await bucket.remove(paths);
      if (error) throw error;
    }
    const gracePeriodElapsed = Date.now() - job.createdAt.getTime() >= 24 * 60 * 60 * 1000;
    if (gracePeriodElapsed) {
      const [remainingRoot, remainingSigned] = await Promise.all([
        listFolder(caseFolder),
        listFolder(`${caseFolder}/signed`),
      ]);
      if (remainingRoot.length === 0 && remainingSigned.length === 0) {
        await prisma.onboardingFileDeletionJob.deleteMany({ where: { id: job.id } });
      }
    } else {
      await prisma.onboardingFileDeletionJob.updateMany({
        where: { id: job.id },
        data: { lastError: null },
      });
    }
    return true;
  } catch (error) {
    await prisma.onboardingFileDeletionJob.updateMany({
      where: { id: job.id },
      data: {
        attempts: { increment: 1 },
        lastError: error instanceof Error ? error.message.slice(0, 1000) : 'Storage cleanup failed.',
      },
    });
    return false;
  }
}

async function drainOnboardingFileDeletionJobs(limit = 20) {
  const jobs = await prisma.onboardingFileDeletionJob.findMany({
    orderBy: { updatedAt: 'asc' },
    take: Math.max(1, Math.min(100, limit)),
    select: { id: true },
  });
  let cleaned = 0;
  for (const job of jobs) {
    if (await processOnboardingFileDeletionJob(job.id)) cleaned += 1;
  }
  return { inspected: jobs.length, cleaned };
}

export async function getOnboardingManagementContext() {
  if (!isOnboardingEnabled()) return { authorized: false, assignableRoles: [], managers: [] };
  const actor = await getActor();
  if (!actor) return { authorized: false, assignableRoles: [], managers: [] };
  const canAccess = hasAnyAdminRole(actor.roles) || actor.roles.includes(UserRole.MANAGER);
  if (!canAccess) return { authorized: false, assignableRoles: [], managers: [] };
  const managers = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { role: UserRole.MANAGER },
        { roles: { has: UserRole.MANAGER } },
        { role: { in: [UserRole.ADMIN_I, UserRole.ADMIN_II, UserRole.ADMIN_III] } },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });
  return {
    authorized: true,
    assignableRoles: hasAnyAdminRole(actor.roles)
      ? assignableRolesFor(actor.roles).filter(
          (role) => role !== UserRole.ONBOARDING && !isAdminRole(role),
        )
      : [],
    managers,
  };
}

export async function listOnboardingCases() {
  const actor = await getActor();
  if (!actor) return [];
  const admin = hasAnyAdminRole(actor.roles);
  const manager = actor.roles.includes(UserRole.MANAGER);
  if (!admin && !manager) return [];
  return prisma.onboardingCase.findMany({
    where: admin
      ? undefined
      : {
          OR: [
            { ownerId: actor.userId },
            { items: { some: { assignedUserId: actor.userId } } },
          ],
        },
    select: {
      id: true,
      candidateName: true,
      personalEmail: true,
      status: true,
      targetRoles: true,
      ownerId: true,
      createdAt: true,
      updatedAt: true,
      profile: {
        select: {
          startDate: true,
          jobTitle: true,
          department: true,
        },
      },
      items: { select: { status: true, required: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });
}

export async function createOnboardingCase(input: {
  candidateName: string;
  personalEmail: string;
  targetRoles: UserRole[];
  ownerId?: string;
  startDate?: string;
  jobTitle?: string;
  department?: string;
}) {
  if (!isOnboardingEnabled()) return { success: false, error: 'Employee onboarding is not enabled.' };
  const actor = await getActor();
  if (!actor || !hasAnyAdminRole(actor.roles)) {
    return { success: false, error: 'Not authorized.' };
  }
  const candidateName = cleanText(input.candidateName, 160);
  const personalEmail = normalizeEmail(input.personalEmail);
  const targetRoles = Array.from(new Set(input.targetRoles));
  if (!candidateName || !validEmail(personalEmail)) {
    return { success: false, error: 'A valid name and personal email are required.' };
  }
  if (targetRoles.some(isAdminRole)) {
    return { success: false, error: 'Administrative roles cannot be assigned through onboarding.' };
  }
  if (
    !targetRoles.length ||
    targetRoles.includes(UserRole.ONBOARDING) ||
    targetRoles.some((role) => !canAssignRole(actor.roles, role))
  ) {
    return { success: false, error: 'Select at least one role you are allowed to assign.' };
  }
  if (input.ownerId && !(await isEligibleOnboardingOwner(input.ownerId))) {
    return { success: false, error: 'Select an active manager or administrator as owner.' };
  }
  const existing = await prisma.user.findUnique({
    where: { email: personalEmail },
    select: { active: true },
  });
  if (existing?.active) return { success: false, error: 'An active user already uses this email.' };

  const duplicate = await prisma.onboardingCase.findFirst({
    where: {
      personalEmail,
      status: { notIn: [OnboardingStatus.COMPLETED, OnboardingStatus.CANCELLED] },
    },
    select: { id: true },
  });
  if (duplicate) return { success: false, error: 'This person already has an open onboarding case.' };

  const token = randomBytes(32).toString('hex');
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  const result = await prisma.$transaction(async (tx) => {
    const template = await ensureOnboardingTemplate(tx);
    const invite = await tx.inviteToken.create({
      data: {
        token,
        email: personalEmail,
        name: candidateName,
        role: UserRole.ONBOARDING,
        createdById: actor.userId,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    const onboardingCase = await tx.onboardingCase.create({
      data: {
        candidateName,
        personalEmail,
        targetRoles,
        ownerId: input.ownerId || null,
        createdById: actor.userId,
        templateId: template.id,
        inviteId: invite.id,
        profile: {
          create: {
            startDate: toDate(input.startDate),
            jobTitle: cleanText(input.jobTitle, 160) || null,
            department: cleanText(input.department, 160) || null,
          },
        },
        items: {
          create: template.items.map((item) => ({
            templateItemId: item.id,
            category: item.category,
            label: item.label,
            description: item.description,
            owner: item.owner,
            required: item.required,
            sortOrder: item.sortOrder,
            status:
              item.fieldKey === 'personalEmail'
                ? OnboardingItemStatus.COMPLETED
                : OnboardingItemStatus.NOT_STARTED,
            completedAt: item.fieldKey === 'personalEmail' ? new Date() : null,
          })),
        },
      },
    });
    await recordEvent(tx, {
      caseId: onboardingCase.id,
      actorId: actor.userId,
      action: 'ONBOARDING_INVITED',
      details: { targetRoles },
      email: {
        to: personalEmail,
        subject: 'Welcome to BISU - begin your onboarding',
        text: `Hi ${candidateName},\n\nWelcome to BISU. Create your secure account and begin onboarding:\n${baseUrl}/auth/invite/${token}\n\nThis link expires in 7 days.`,
        href: `${baseUrl}/auth/invite/${token}`,
      },
    });
    return onboardingCase;
  }).catch((error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return null;
    }
    throw error;
  });
  if (!result) {
    return { success: false, error: 'This person already has an onboarding case or invitation.' };
  }
  revalidatePath('/admin/users');
  revalidatePath('/admin/users/onboarding');
  return { success: true, caseId: result.id };
}

export async function resendOnboardingInvite(caseId: string) {
  const actor = await getActor();
  const onboardingCase = actor
    ? await prisma.onboardingCase.findUnique({
        where: { id: caseId },
        include: {
          items: { select: { assignedUserId: true } },
          invite: { select: { id: true } },
        },
      })
    : null;
  if (
    !actor ||
    !onboardingCase ||
    onboardingCase.status !== OnboardingStatus.INVITED ||
    !onboardingCase.invite ||
    !canManageOnboardingCase(actor, onboardingCase) ||
    (!hasAnyAdminRole(actor.roles) && onboardingCase.ownerId !== actor.userId)
  ) {
    return { success: false, error: 'This onboarding invitation cannot be resent.' };
  }
  const token = randomBytes(32).toString('hex');
  const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
  await prisma.$transaction(async (tx) => {
    await tx.inviteToken.update({
      where: { id: onboardingCase.invite!.id },
      data: {
        token,
        acceptedAt: null,
        expiresAt: new Date(Date.now() + INVITE_TTL_MS),
      },
    });
    await recordEvent(tx, {
      caseId,
      actorId: actor.userId,
      action: 'ONBOARDING_INVITE_RESENT',
      email: {
        to: onboardingCase.personalEmail,
        subject: 'Your BISU onboarding invitation',
        text: `Hi ${onboardingCase.candidateName},\n\nUse this refreshed secure link to begin onboarding:\n${baseUrl}/auth/invite/${token}\n\nThis link expires in 7 days.`,
        href: `${baseUrl}/auth/invite/${token}`,
      },
    });
  });
  revalidatePath(`/admin/users/onboarding/${caseId}`);
  return { success: true };
}

export async function deleteOnboardingCase(caseId: string) {
  if (!isOnboardingEnabled()) {
    return { success: false, error: 'Employee onboarding is not enabled.' };
  }
  const actor = await getActor();
  if (!actor || !hasAnyAdminRole(actor.roles)) {
    return { success: false, error: 'Only an administrator can delete onboarding records.' };
  }

  let cleanupJobId: string | null = null;
  try {
    cleanupJobId = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "OnboardingCase" WHERE "id" = ${caseId} FOR UPDATE`;
      const current = await tx.onboardingCase.findUnique({
        where: { id: caseId },
        select: {
          id: true,
          inviteId: true,
          status: true,
          createdAt: true,
          user: { select: { id: true, role: true, roles: true, createdAt: true } },
          documents: {
            select: {
              storagePath: true,
              signedStoragePath: true,
              status: true,
              externalEnvelopeId: true,
              signatureProvider: true,
            },
          },
          events: { select: { id: true } },
          items: { select: { id: true } },
        },
      });
      if (!current) throw new Error('Onboarding record not found.');
      if (current.status === OnboardingStatus.COMPLETED) {
        throw new Error('Completed employee accounts cannot be deleted from onboarding.');
      }
      if (
        current.user &&
        (current.user.role !== UserRole.ONBOARDING ||
          current.user.roles.some((role) => role !== UserRole.ONBOARDING))
      ) {
        throw new Error('This account has active portal roles and cannot be deleted from onboarding.');
      }
      if (current.user && current.user.createdAt < current.createdAt) {
        throw new Error(
          'This onboarding reused a pre-existing account. Remove the onboarding record through an administrator-assisted cleanup instead.',
        );
      }
      if (
        current.documents.some(
          (document) =>
            document.status === OnboardingDocumentStatus.PENDING_SIGNATURE &&
            (Boolean(document.externalEnvelopeId) ||
              document.signatureProvider === 'creating' ||
              (Boolean(document.signatureProvider) && document.signatureProvider !== 'manual')),
        )
      ) {
        throw new Error(
          'Void active external signature requests before deleting this onboarding.',
        );
      }
      const storagePaths = Array.from(
        new Set(
          current.documents.flatMap((document) =>
            [document.storagePath, document.signedStoragePath].filter(
              (path): path is string => Boolean(path),
            ),
          ),
        ),
      );

      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: 'ONBOARDING_CASE_DELETED',
          details: JSON.stringify({
            caseId: current.id,
            temporaryAccountDeleted: Boolean(current.user),
            documentCount: current.documents.length,
          }),
        },
      });
      const outboxPrefixes = [
        ...current.events.map((event) => `onboarding:${event.id}`),
        ...current.items.map((item) => `onboarding-reminder:${item.id}:`),
      ];
      if (outboxPrefixes.length > 0) {
        const outboxWhere = {
          OR: outboxPrefixes.map((prefix) => ({
            idempotencyKey: { startsWith: prefix },
          })),
        };
        await tx.notificationOutbox.updateMany({
          where: {
            ...outboxWhere,
            status: {
              in: [NotificationOutboxStatus.PENDING, NotificationOutboxStatus.RETRY],
            },
          },
          data: {
            status: NotificationOutboxStatus.FAILED,
            processingStartedAt: null,
            lastError: 'Cancelled because the onboarding case was deleted.',
          },
        });
        const delivering = await tx.notificationOutbox.count({
          where: { ...outboxWhere, status: NotificationOutboxStatus.PROCESSING },
        });
        if (delivering > 0) {
          throw new Error('An onboarding email is currently being delivered. Try deleting again shortly.');
        }
        await tx.notificationOutbox.deleteMany({
          where: outboxWhere,
        });
      }
      const cleanupJob = await tx.onboardingFileDeletionJob.create({
        data: { caseId: current.id, storagePaths },
        select: { id: true },
      });
      await tx.onboardingCase.delete({ where: { id: current.id } });
      if (current.inviteId) {
        await tx.inviteToken.deleteMany({ where: { id: current.inviteId } });
      }
      if (current.user) {
        await tx.passwordResetToken.deleteMany({ where: { userId: current.user.id } });
        await tx.externalUser.deleteMany({ where: { userId: current.user.id } });
        await tx.auditLog.deleteMany({ where: { userId: current.user.id } });
        await tx.user.delete({ where: { id: current.user.id } });
      }
      return cleanupJob.id;
    });
  } catch (error) {
    console.error('[onboarding] Failed to delete onboarding case', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to delete onboarding.',
    };
  }

  if (cleanupJobId) {
    const cleaned = await processOnboardingFileDeletionJob(cleanupJobId);
    if (!cleaned) {
      console.error('[onboarding] Deleted case but storage cleanup failed', { caseId });
      await prisma.auditLog
        .create({
          data: {
            userId: actor.userId,
            action: 'ONBOARDING_FILE_CLEANUP_FAILED',
            details: JSON.stringify({ caseId, cleanupJobId }),
          },
        })
        .catch((error) => {
          console.error('[onboarding] Failed to record storage cleanup failure', error);
        });
    }
  }

  revalidatePath('/admin/users');
  revalidatePath('/admin/users/onboarding');
  return { success: true };
}

export async function getMyOnboardingCase() {
  const actor = await getActor();
  if (!actor || !actor.roles.includes(UserRole.ONBOARDING)) return null;
  const onboardingCase = await prisma.onboardingCase.findUnique({
    where: { userId: actor.userId },
    include: {
      profile: true,
      items: {
        where: { owner: OnboardingItemOwner.NEW_HIRE },
        orderBy: { sortOrder: 'asc' },
      },
      documents: {
        where: {
          visibility: {
            in: [OnboardingDocumentVisibility.NEW_HIRE, OnboardingDocumentVisibility.BOTH],
          },
          status: { not: OnboardingDocumentStatus.REQUESTED },
        },
        orderBy: { createdAt: 'desc' },
      },
      events: {
        where: {
          action: {
            in: [
              'INVITE_ACCEPTED',
              'CANDIDATE_SUBMITTED',
              'CHANGES_REQUESTED',
              'ONBOARDING_APPROVED',
              'ONBOARDING_COMPLETED',
            ],
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
    },
  });
  if (!onboardingCase) return null;
  return {
    ...onboardingCase,
    profile: onboardingCase.profile
      ? {
          firstName: onboardingCase.profile.firstName,
          lastName: onboardingCase.profile.lastName,
          preferredFirstName: onboardingCase.profile.preferredFirstName,
          dateOfBirth: dateInput(onboardingCase.profile.dateOfBirth),
          mobilePhone: onboardingCase.profile.mobilePhone,
          addressLine1: onboardingCase.profile.addressLine1,
          addressLine2: onboardingCase.profile.addressLine2,
          city: onboardingCase.profile.city,
          state: onboardingCase.profile.state,
          postalCode: onboardingCase.profile.postalCode,
        }
      : null,
  };
}

export async function getOnboardingCaseForManagement(caseId: string) {
  const actor = await getActor();
  if (!actor) return null;
  const onboardingCase = await prisma.onboardingCase.findUnique({
    where: { id: caseId },
    include: {
      profile: true,
      items: { orderBy: { sortOrder: 'asc' } },
      documents: {
        where: { status: { not: OnboardingDocumentStatus.REQUESTED } },
        orderBy: { createdAt: 'desc' },
      },
      events: { orderBy: { createdAt: 'desc' }, take: 100 },
    },
  });
  if (!onboardingCase || !canViewOnboardingCase(actor, onboardingCase)) return null;
  const isAdmin = hasAnyAdminRole(actor.roles);
  const canSeeFullCase = isAdmin || onboardingCase.ownerId === actor.userId;
  return {
    ...onboardingCase,
    permissions: {
      canEditDetails: canSeeFullCase,
      canManageDocuments: canSeeFullCase,
      canApprove: isAdmin,
    },
    items: canSeeFullCase
      ? onboardingCase.items
      : onboardingCase.items.filter((item) => item.assignedUserId === actor.userId),
    documents: canSeeFullCase ? onboardingCase.documents : [],
    events: canSeeFullCase
      ? onboardingCase.events
      : onboardingCase.events.filter((event) =>
          ['CANDIDATE_SUBMITTED', 'ONBOARDING_UNDER_REVIEW', 'ONBOARDING_APPROVED'].includes(
            event.action,
          ),
        ),
    profile: onboardingCase.profile
      ? {
          ...onboardingCase.profile,
          firstName: canSeeFullCase ? onboardingCase.profile.firstName : null,
          lastName: canSeeFullCase ? onboardingCase.profile.lastName : null,
          preferredFirstName: canSeeFullCase ? onboardingCase.profile.preferredFirstName : null,
          dateOfBirth: canSeeFullCase ? dateInput(onboardingCase.profile.dateOfBirth) : '',
          mobilePhone: canSeeFullCase ? onboardingCase.profile.mobilePhone : null,
          homeAddress: canSeeFullCase ? onboardingCase.profile.homeAddress : null,
          addressLine1: canSeeFullCase ? onboardingCase.profile.addressLine1 : null,
          addressLine2: canSeeFullCase ? onboardingCase.profile.addressLine2 : null,
          city: canSeeFullCase ? onboardingCase.profile.city : null,
          state: canSeeFullCase ? onboardingCase.profile.state : null,
          postalCode: canSeeFullCase ? onboardingCase.profile.postalCode : null,
          basePay: isAdmin ? onboardingCase.profile.basePay : null,
          compensationPlan: isAdmin ? onboardingCase.profile.compensationPlan : null,
        }
      : null,
  };
}

export async function updateOnboardingCaseDetails(input: {
  caseId: string;
  ownerId?: string | null;
  targetRoles?: UserRole[];
  offerDate?: string;
  startDate?: string;
  jobTitle?: string;
  managerName?: string;
  basePay?: string;
  compensationPlan?: string;
  location?: string;
  department?: string;
}) {
  const actor = await getActor();
  const onboardingCase = actor ? await loadAccessCase(input.caseId) : null;
  if (!actor || !onboardingCase || !canManageOnboardingCase(actor, onboardingCase)) {
    return { success: false, error: 'Not authorized.' };
  }
  const isAdmin = hasAnyAdminRole(actor.roles);
  if (!isAdmin && onboardingCase.ownerId !== actor.userId) {
    return { success: false, error: 'Only the onboarding owner can edit case details.' };
  }
  const targetRoles = input.targetRoles
    ? Array.from(new Set(input.targetRoles))
    : undefined;
  const roleLockedStatuses = new Set<OnboardingStatus>([
    OnboardingStatus.APPROVED,
    OnboardingStatus.COMPLETED,
    OnboardingStatus.CANCELLED,
  ]);
  if (targetRoles && roleLockedStatuses.has(onboardingCase.status)) {
    return { success: false, error: 'Destination roles are locked after final approval.' };
  }
  if (targetRoles?.some(isAdminRole)) {
    return { success: false, error: 'Administrative roles cannot be assigned through onboarding.' };
  }
  if (
    targetRoles &&
    (!isAdmin ||
      !targetRoles.length ||
      targetRoles.includes(UserRole.ONBOARDING) ||
      targetRoles.some((role) => !canAssignRole(actor.roles, role)))
  ) {
    return { success: false, error: 'The destination roles are invalid.' };
  }
  if (input.ownerId && !(await isEligibleOnboardingOwner(input.ownerId))) {
    return { success: false, error: 'Select an active manager or administrator as owner.' };
  }
  const profileData = {
    offerDate: toDate(input.offerDate),
    startDate: toDate(input.startDate),
    jobTitle: cleanText(input.jobTitle, 160) || null,
    managerName: cleanText(input.managerName, 160) || null,
    basePay: isAdmin ? cleanText(input.basePay, 120) || null : undefined,
    compensationPlan: isAdmin ? cleanText(input.compensationPlan, 300) || null : undefined,
    location: cleanText(input.location, 80) || null,
    department: cleanText(input.department, 160) || null,
  };
  await prisma.$transaction(async (tx) => {
    await tx.onboardingProfile.upsert({
      where: { caseId: input.caseId },
      update: profileData,
      create: { caseId: input.caseId, ...profileData },
    });
    if (isAdmin && (input.ownerId !== undefined || targetRoles)) {
      if (targetRoles) {
        const update = await tx.onboardingCase.updateMany({
          where: {
            id: input.caseId,
            status: {
              notIn: [
                OnboardingStatus.APPROVED,
                OnboardingStatus.COMPLETED,
                OnboardingStatus.CANCELLED,
              ],
            },
          },
          data: {
            ownerId: input.ownerId === undefined ? undefined : input.ownerId || null,
            targetRoles,
          },
        });
        if (update.count !== 1) {
          throw new Error('Destination roles are locked after final approval.');
        }
      } else {
        await tx.onboardingCase.update({
          where: { id: input.caseId },
          data: { ownerId: input.ownerId === undefined ? undefined : input.ownerId || null },
        });
      }
    }
    const completedKeys = Object.entries(profileData)
      .filter(([, value]) => value !== null && value !== undefined && value !== '')
      .map(([key]) => key);
    const profileItems = await tx.onboardingItem.findMany({
      where: {
        caseId: input.caseId,
        templateItem: { fieldKey: { in: completedKeys } },
      },
      select: { id: true },
    });
    await Promise.all(
      profileItems.map((item) =>
        tx.onboardingItem.update({
          where: { id: item.id },
          data: { status: OnboardingItemStatus.COMPLETED, completedAt: new Date() },
        }),
      ),
    );
    await recordEvent(tx, {
      caseId: input.caseId,
      actorId: actor.userId,
      action: 'MANAGEMENT_DETAILS_UPDATED',
      details: { fields: completedKeys, ownerUpdated: input.ownerId !== undefined, rolesUpdated: Boolean(targetRoles) },
    });
  });
  revalidatePath('/admin/users/onboarding');
  revalidatePath(`/admin/users/onboarding/${input.caseId}`);
  return { success: true };
}

export async function updateCandidateProfile(input: {
  firstName: string;
  lastName: string;
  preferredFirstName?: string;
  dateOfBirth: string;
  mobilePhone: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  postalCode: string;
}) {
  const actor = await getActor();
  if (!actor || !actor.roles.includes(UserRole.ONBOARDING)) {
    return { success: false, error: 'Not authorized.' };
  }
  const onboardingCase = await loadAccessCase(
    (await prisma.onboardingCase.findUnique({ where: { userId: actor.userId }, select: { id: true } }))?.id || '',
  );
  if (!onboardingCase || onboardingCase.userId !== actor.userId || !canCandidateEdit(onboardingCase.status)) {
    return { success: false, error: 'This onboarding profile is not editable.' };
  }
  const values = {
    firstName: cleanText(input.firstName, 100),
    lastName: cleanText(input.lastName, 100),
    preferredFirstName: cleanText(input.preferredFirstName, 100) || null,
    dateOfBirth: toDate(input.dateOfBirth),
    mobilePhone: cleanText(input.mobilePhone, 40),
    addressLine1: cleanText(input.addressLine1, 200),
    addressLine2: cleanText(input.addressLine2, 200) || null,
    city: cleanText(input.city, 100),
    state: cleanText(input.state, 20).toUpperCase(),
    postalCode: cleanText(input.postalCode, 20),
  };
  if (!values.firstName || !values.lastName || !values.dateOfBirth || !values.mobilePhone) {
    return { success: false, error: 'Complete all required fields.' };
  }
  if (!isCompleteOnboardingAddress(values)) {
    return {
      success: false,
      error: 'Enter address line 1, city, a valid U.S. state, and a valid ZIP or ZIP+4.',
    };
  }
  const persistedValues = {
    ...values,
    // Keep the retired field synchronized until a later contract migration
    // removes it after all rolling-deploy instances use structured addresses.
    homeAddress: [
      values.addressLine1,
      values.addressLine2,
      `${values.city}, ${values.state} ${values.postalCode}`,
    ].filter(Boolean).join('\n'),
  };
  await prisma.$transaction(async (tx) => {
    await tx.onboardingProfile.upsert({
      where: { caseId: onboardingCase.id },
      update: persistedValues,
      create: { caseId: onboardingCase.id, ...persistedValues },
    });
    const fieldKeys = Object.entries(persistedValues)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => key);
    fieldKeys.push('personalEmail');
    const profileItems = await tx.onboardingItem.findMany({
      where: {
        caseId: onboardingCase.id,
        templateItem: { fieldKey: { in: fieldKeys } },
      },
      select: { id: true },
    });
    await Promise.all(
      profileItems.map((item) =>
        tx.onboardingItem.update({
          where: { id: item.id },
          data: { status: OnboardingItemStatus.COMPLETED, completedAt: new Date() },
        }),
      ),
    );
    const caseUpdate = await tx.onboardingCase.updateMany({
      where: {
        id: onboardingCase.id,
        status: {
          in: [
            OnboardingStatus.INVITED,
            OnboardingStatus.IN_PROGRESS,
            OnboardingStatus.CHANGES_REQUESTED,
          ],
        },
      },
      data: { status: OnboardingStatus.IN_PROGRESS },
    });
    if (caseUpdate.count !== 1) {
      throw new Error('This onboarding profile is no longer editable.');
    }
    await recordEvent(tx, {
      caseId: onboardingCase.id,
      actorId: actor.userId,
      action: 'CANDIDATE_PROFILE_UPDATED',
      details: {
        fields: Object.keys(values),
        addressComplete: true,
        sensitiveValuesRedacted: true,
      },
    });
  });
  revalidatePath('/onboarding');
  return { success: true };
}

export async function updateOnboardingItem(input: {
  itemId: string;
  status: OnboardingItemStatus;
  response?: string;
  note?: string;
  assignedUserId?: string | null;
  dueAt?: string | null;
}) {
  const actor = await getActor();
  if (!actor) return { success: false, error: 'Not authenticated.' };
  const item = await prisma.onboardingItem.findUnique({
    where: { id: input.itemId },
    include: {
      templateItem: { select: { fieldKey: true } },
      case: {
        include: {
          items: { select: { assignedUserId: true } },
          profile: {
            select: {
              addressLine1: true,
              city: true,
              state: true,
              postalCode: true,
            },
          },
        },
      },
    },
  });
  if (!item) return { success: false, error: 'Checklist item not found.' };
  const candidate = item.case.userId === actor.userId && actor.roles.includes(UserRole.ONBOARDING);
  const manager = canManageOnboardingCase(actor, item.case);
  const canEditInternalItem = canEditOnboardingItem(actor, item.case, item.assignedUserId);
  if (candidate && (!canCandidateEdit(item.case.status) || !canCandidateEditItem(item.owner))) {
    return { success: false, error: 'This item is not editable.' };
  }
  if (!candidate && (!manager || !canEditInternalItem)) {
    return { success: false, error: 'Not authorized.' };
  }
  if (
    !candidate &&
    input.assignedUserId &&
    !(await isEligibleOnboardingOwner(input.assignedUserId))
  ) {
    return { success: false, error: 'Select an active manager or administrator as assignee.' };
  }
  const candidateStatuses = new Set<OnboardingItemStatus>([
    OnboardingItemStatus.IN_PROGRESS,
    OnboardingItemStatus.SUBMITTED,
  ]);
  const status = candidate
    ? candidateStatuses.has(input.status)
      ? input.status
      : OnboardingItemStatus.SUBMITTED
    : input.status;
  if (
    item.templateItem?.fieldKey === 'homeAddress' &&
    status === OnboardingItemStatus.COMPLETED &&
    (!item.case.profile || !isCompleteOnboardingAddress(item.case.profile))
  ) {
    return {
      success: false,
      error: 'Home Address is complete only after a valid structured address is saved.',
    };
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "OnboardingCase" WHERE "id" = ${item.caseId} FOR UPDATE`;
    const currentCase = await tx.onboardingCase.findUnique({
      where: { id: item.caseId },
      select: { status: true },
    });
    if (
      !currentCase ||
      (candidate && !canCandidateEdit(currentCase.status)) ||
      currentCase.status === OnboardingStatus.COMPLETED ||
      currentCase.status === OnboardingStatus.CANCELLED
    ) {
      throw new Error('This checklist item is no longer editable.');
    }
    await tx.onboardingItem.update({
      where: { id: item.id },
      data: {
        status,
        response: input.response ? { value: cleanText(input.response, 2000) } : undefined,
        candidateNote: candidate ? cleanText(input.note, 2000) || null : undefined,
        internalNote: !candidate ? cleanText(input.note, 2000) || null : undefined,
        assignedUserId: !candidate ? input.assignedUserId : undefined,
        dueAt: !candidate ? toDate(input.dueAt) : undefined,
        submittedAt: status === OnboardingItemStatus.SUBMITTED ? new Date() : undefined,
        completedAt: status === OnboardingItemStatus.COMPLETED ? new Date() : null,
      },
    });
    await recordEvent(tx, {
      caseId: item.caseId,
      actorId: actor.userId,
      action: candidate ? 'CANDIDATE_ITEM_UPDATED' : 'CHECKLIST_ITEM_UPDATED',
      details: { itemId: item.id, status, assignedUserId: candidate ? undefined : input.assignedUserId },
    });
  });
  revalidatePath('/onboarding');
  revalidatePath(`/admin/users/onboarding/${item.caseId}`);
  return { success: true };
}

export async function submitOnboardingCase() {
  const actor = await getActor();
  if (!actor || !actor.roles.includes(UserRole.ONBOARDING)) {
    return { success: false, error: 'Not authorized.' };
  }
  const onboardingCase = await prisma.onboardingCase.findUnique({
    where: { userId: actor.userId },
    include: {
      profile: true,
      items: { where: { owner: OnboardingItemOwner.NEW_HIRE, required: true } },
    },
  });
  if (!onboardingCase || !canCandidateEdit(onboardingCase.status)) {
    return { success: false, error: 'This onboarding case cannot be submitted.' };
  }
  const profile = onboardingCase.profile;
  if (
    !profile?.firstName ||
    !profile.lastName ||
    !profile.dateOfBirth ||
    !profile.mobilePhone ||
    !isCompleteOnboardingAddress(profile)
  ) {
    return { success: false, error: 'Complete your required personal information first.' };
  }
  const submittedStatuses = new Set<OnboardingItemStatus>([
    OnboardingItemStatus.COMPLETED,
    OnboardingItemStatus.SUBMITTED,
  ]);
  const incomplete = onboardingCase.items.some((item) => !submittedStatuses.has(item.status));
  if (incomplete) return { success: false, error: 'Complete all required onboarding items first.' };
  await prisma.$transaction(async (tx) => {
    const caseUpdate = await tx.onboardingCase.updateMany({
      where: {
        id: onboardingCase.id,
        status: {
          in: [
            OnboardingStatus.INVITED,
            OnboardingStatus.IN_PROGRESS,
            OnboardingStatus.CHANGES_REQUESTED,
          ],
        },
      },
      data: { status: OnboardingStatus.SUBMITTED, submittedAt: new Date() },
    });
    if (caseUpdate.count !== 1) {
      throw new Error('This onboarding case can no longer be submitted.');
    }
    const submissionEvent = await recordEvent(tx, {
      caseId: onboardingCase.id,
      actorId: actor.userId,
      action: 'CANDIDATE_SUBMITTED',
      email: {
        to: onboardingCase.personalEmail,
        subject: 'BISU onboarding submitted',
        text: 'Your onboarding information was submitted successfully. We will notify you when review is complete or if changes are needed.',
      },
    });
    const reviewerId = onboardingCase.ownerId || onboardingCase.createdById;
    if (reviewerId) {
      const owner = await tx.user.findUnique({
        where: { id: reviewerId },
        select: { email: true },
      });
      if (owner) {
        const href = `/admin/users/onboarding/${onboardingCase.id}`;
        await tx.notification.create({
          data: {
            userId: reviewerId,
            eventLabel: 'ONBOARDING',
            title: 'Onboarding ready for review',
            message: `${onboardingCase.candidateName} submitted onboarding information.`,
            href,
          },
        });
        await tx.notificationOutbox.create({
          data: {
            eventType: NotificationOutboxEventType.ONBOARDING,
            idempotencyKey: `onboarding:${submissionEvent.id}:owner`,
            payload: {
              caseId: onboardingCase.id,
              to: owner.email,
              subject: `${onboardingCase.candidateName} is ready for onboarding review`,
              text: 'The new hire submitted their onboarding information. Open BISU Portal to begin review.',
              href: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}${href}`,
            },
          },
        });
      }
    }
  });
  revalidatePath('/onboarding');
  revalidatePath('/admin/users/onboarding');
  return { success: true };
}

export async function transitionOnboardingCase(input: {
  caseId: string;
  status: OnboardingStatus;
  note?: string;
}) {
  const actor = await getActor();
  const onboardingCase = actor ? await loadAccessCase(input.caseId) : null;
  if (!actor || !onboardingCase || !canManageOnboardingCase(actor, onboardingCase)) {
    return { success: false, error: 'Not authorized.' };
  }
  if (!hasAnyAdminRole(actor.roles) && onboardingCase.ownerId !== actor.userId) {
    return { success: false, error: 'Only the onboarding owner can change case status.' };
  }
  if (input.status === OnboardingStatus.COMPLETED) {
    return completeOnboardingCase(input.caseId);
  }
  if (!canTransitionOnboardingStatus(onboardingCase.status, input.status)) {
    return { success: false, error: 'That status transition is not allowed.' };
  }
  const adminOnlyStatuses = new Set<OnboardingStatus>([
    OnboardingStatus.APPROVED,
    OnboardingStatus.CANCELLED,
  ]);
  if (adminOnlyStatuses.has(input.status) && !hasAnyAdminRole(actor.roles)) {
    return { success: false, error: 'An administrator must perform this action.' };
  }
  const caseEmail = await prisma.onboardingCase.findUnique({
    where: { id: input.caseId },
    select: { personalEmail: true },
  });
  const action =
    input.status === OnboardingStatus.CHANGES_REQUESTED
      ? 'CHANGES_REQUESTED'
      : input.status === OnboardingStatus.APPROVED
        ? 'ONBOARDING_APPROVED'
        : `ONBOARDING_${input.status}`;
  await prisma.$transaction(async (tx) => {
    const caseUpdate = await tx.onboardingCase.updateMany({
      where: { id: input.caseId, status: onboardingCase.status },
      data: {
        status: input.status,
        approvedAt: input.status === OnboardingStatus.APPROVED ? new Date() : undefined,
        cancelledAt: input.status === OnboardingStatus.CANCELLED ? new Date() : undefined,
      },
    });
    if (caseUpdate.count !== 1) {
      throw new Error('The onboarding status changed. Refresh and try again.');
    }
    if (input.status === OnboardingStatus.CANCELLED && onboardingCase.inviteId) {
      await tx.inviteToken.update({
        where: { id: onboardingCase.inviteId },
        data: { expiresAt: new Date(0) },
      });
    }
    await recordEvent(tx, {
      caseId: input.caseId,
      actorId: actor.userId,
      action,
      details: { note: cleanText(input.note, 2000) || undefined },
      email: caseEmail
        ? {
            to: caseEmail.personalEmail,
            subject:
              input.status === OnboardingStatus.CHANGES_REQUESTED
                ? 'Changes requested for your BISU onboarding'
                : `BISU onboarding: ${input.status.toLowerCase().replace(/_/g, ' ')}`,
            text:
              cleanText(input.note, 2000) ||
              `Your onboarding status is now ${input.status.toLowerCase().replace(/_/g, ' ')}.`,
          }
        : undefined,
    });
  });
  revalidatePath('/onboarding');
  revalidatePath('/admin/users/onboarding');
  revalidatePath(`/admin/users/onboarding/${input.caseId}`);
  return { success: true };
}

export async function completeOnboardingCase(caseId: string) {
  const actor = await getActor();
  if (!actor || !hasAnyAdminRole(actor.roles)) {
    return { success: false, error: 'An administrator must complete onboarding.' };
  }
  let completion: {
    targetRoles: UserRole[];
    user: { id: string; name: string };
  };
  try {
    completion = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "OnboardingCase" WHERE "id" = ${caseId} FOR UPDATE`;
      const current = await tx.onboardingCase.findUnique({
        where: { id: caseId },
        include: { user: { select: { id: true, name: true } }, items: true },
      });
      if (
        !current ||
        current.status !== OnboardingStatus.APPROVED ||
        !current.user
      ) {
        throw new Error('An approved, accepted case is required.');
      }
      const targetRoles = current.targetRoles;
      if (
        !targetRoles.length ||
        targetRoles.includes(UserRole.ONBOARDING) ||
        targetRoles.some(isAdminRole) ||
        targetRoles.some((role) => !canAssignRole(actor.roles, role))
      ) {
        throw new Error('The destination roles are invalid.');
      }
      const completedStatuses = new Set<OnboardingItemStatus>([
        OnboardingItemStatus.COMPLETED,
        OnboardingItemStatus.NOT_APPLICABLE,
      ]);
      if (
        current.items.some(
          (item) => item.required && !completedStatuses.has(item.status),
        )
      ) {
        throw new Error('Complete all required checklist items first.');
      }
      await tx.user.update({
        where: { id: current.user.id },
        data: { role: targetRoles[0], roles: targetRoles },
      });
      await tx.onboardingCase.update({
        where: { id: caseId },
        data: { status: OnboardingStatus.COMPLETED, completedAt: new Date() },
      });
      await recordEvent(tx, {
        caseId,
        actorId: actor.userId,
        action: 'ONBOARDING_COMPLETED',
        details: { fromRoles: [UserRole.ONBOARDING], toRoles: targetRoles },
        email: {
          to: current.personalEmail,
          subject: 'Your BISU onboarding is complete',
          text: 'Your onboarding is complete. Sign out and sign back in to access your assigned BISU Portal workspace.',
        },
      });
      return { targetRoles, user: current.user };
    });
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to complete onboarding.',
    };
  }
  if (completion.targetRoles.includes(UserRole.LOAN_OFFICER)) {
    await ensureWebsiteLoanOfficerProfileDraft(completion.user.id, completion.user.name);
  } else {
    await prisma.websiteLoanOfficerProfile.updateMany({
      where: { userId: completion.user.id },
      data: { publishedAt: null },
    });
  }
  revalidatePath('/admin/users');
  revalidatePath('/admin/users/onboarding');
  revalidatePath(`/admin/users/onboarding/${caseId}`);
  return { success: true };
}

export async function createOnboardingDocumentUploadUrl(input: {
  caseId: string;
  itemId?: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  visibility?: OnboardingDocumentVisibility;
  documentType?: string;
}) {
  const actor = await getActor();
  const onboardingCase = actor ? await loadAccessCase(input.caseId) : null;
  if (!actor || !onboardingCase || !canViewOnboardingCase(actor, onboardingCase)) {
    return { success: false, error: 'Not authorized.' };
  }
  const candidate = onboardingCase.userId === actor.userId;
  if (candidate && !canCandidateEdit(onboardingCase.status)) {
    return { success: false, error: 'Documents are locked while onboarding is under review.' };
  }
  if (!candidate && !hasAnyAdminRole(actor.roles) && onboardingCase.ownerId !== actor.userId) {
    return { success: false, error: 'Only the onboarding owner can add documents.' };
  }
  if (!ALLOWED_DOCUMENT_TYPES.has(input.mimeType) || input.sizeBytes <= 0 || input.sizeBytes > MAX_DOCUMENT_BYTES) {
    return { success: false, error: 'Upload a PDF, Word document, JPG, or PNG up to 15 MB.' };
  }
  if (input.itemId) {
    const item = await prisma.onboardingItem.findUnique({
      where: { id: input.itemId },
      select: { caseId: true },
    });
    if (!item || item.caseId !== input.caseId) {
      return { success: false, error: 'The selected checklist item is invalid.' };
    }
  }
  const safeName = sanitizeFilename(input.filename);
  const storagePath = `onboarding/${input.caseId}/${randomUUID()}-${safeName}`;
  const pendingDocument = await prisma.onboardingDocument.create({
    data: {
      caseId: input.caseId,
      itemId: input.itemId || null,
      uploadedById: actor.userId,
      name: safeName,
      mimeType: input.mimeType,
      sizeBytes: Math.floor(input.sizeBytes),
      storagePath,
      visibility: candidate
        ? OnboardingDocumentVisibility.BOTH
        : input.visibility ?? OnboardingDocumentVisibility.BOTH,
      status: OnboardingDocumentStatus.REQUESTED,
      documentType: cleanText(input.documentType, 100) || null,
    },
  });
  const { data, error } = await getSupabaseAdmin()
    .storage.from(getOnboardingDocumentsBucket())
    .createSignedUploadUrl(storagePath);
  if (error || !data) {
    await prisma.onboardingDocument.delete({ where: { id: pendingDocument.id } });
    return { success: false, error: 'Failed to create upload URL.' };
  }
  return {
    success: true,
    documentId: pendingDocument.id,
    signedUrl: data.signedUrl,
    path: data.path,
    token: data.token,
  };
}

export async function finalizeOnboardingDocument(input: {
  documentId: string;
  caseId: string;
  storagePath: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}) {
  const actor = await getActor();
  const onboardingCase = actor ? await loadAccessCase(input.caseId) : null;
  if (!actor || !onboardingCase || !canViewOnboardingCase(actor, onboardingCase)) {
    return { success: false, error: 'Not authorized.' };
  }
  const candidate = onboardingCase.userId === actor.userId;
  if (candidate && !canCandidateEdit(onboardingCase.status)) {
    return { success: false, error: 'Documents are locked while onboarding is under review.' };
  }
  if (!candidate && !hasAnyAdminRole(actor.roles) && onboardingCase.ownerId !== actor.userId) {
    return { success: false, error: 'Only the onboarding owner can add documents.' };
  }
  if (
    !ALLOWED_DOCUMENT_TYPES.has(input.mimeType) ||
    input.sizeBytes <= 0 ||
    input.sizeBytes > MAX_DOCUMENT_BYTES ||
    !input.storagePath.startsWith(`onboarding/${input.caseId}/`)
  ) {
    return { success: false, error: 'Invalid document upload.' };
  }
  const pendingDocument = await prisma.onboardingDocument.findUnique({
    where: { id: input.documentId },
  });
  if (
    !pendingDocument ||
    pendingDocument.caseId !== input.caseId ||
    pendingDocument.uploadedById !== actor.userId ||
    pendingDocument.storagePath !== input.storagePath ||
    pendingDocument.name !== sanitizeFilename(input.filename) ||
    pendingDocument.mimeType !== input.mimeType ||
    pendingDocument.sizeBytes !== Math.floor(input.sizeBytes) ||
    pendingDocument.status !== OnboardingDocumentStatus.REQUESTED
  ) {
    return { success: false, error: 'Upload request does not match the pending document.' };
  }
  const pathParts = input.storagePath.split('/');
  const objectName = pathParts.pop() || '';
  const folder = pathParts.join('/');
  const bucket = getSupabaseAdmin().storage.from(getOnboardingDocumentsBucket());
  const { data: objects, error: listError } = await bucket.list(folder, {
    search: objectName,
    limit: 10,
  });
  const storedObject = objects?.find((object) => object.name === objectName);
  const storedSize = Number(storedObject?.metadata?.size ?? storedObject?.metadata?.contentLength);
  const storedMime = String(storedObject?.metadata?.mimetype || '').toLowerCase();
  if (
    listError ||
    !storedObject ||
    !Number.isFinite(storedSize) ||
    storedSize !== pendingDocument.sizeBytes ||
    (storedMime && storedMime !== pendingDocument.mimeType.toLowerCase())
  ) {
    return { success: false, error: 'Uploaded file could not be verified.' };
  }
  const { data: storedFile, error: downloadError } = await bucket.download(input.storagePath);
  if (
    downloadError ||
    !storedFile ||
    storedFile.size !== pendingDocument.sizeBytes ||
    storedFile.size > MAX_DOCUMENT_BYTES
  ) {
    await bucket.remove([input.storagePath]);
    await prisma.onboardingDocument.delete({ where: { id: pendingDocument.id } });
    return { success: false, error: 'The uploaded file size could not be verified.' };
  }
  const storedBytes = new Uint8Array(await storedFile.arrayBuffer());
  if (!matchesFileSignature(storedBytes, pendingDocument.mimeType)) {
    await bucket.remove([input.storagePath]);
    await prisma.onboardingDocument.delete({ where: { id: pendingDocument.id } });
    return { success: false, error: 'The uploaded file content does not match its file type.' };
  }
  const document = await prisma.$transaction(async (tx) => {
    const created = await tx.onboardingDocument.update({
      where: { id: pendingDocument.id },
      data: { status: OnboardingDocumentStatus.UPLOADED },
    });
    await recordEvent(tx, {
      caseId: input.caseId,
      actorId: actor.userId,
      action: 'DOCUMENT_UPLOADED',
      details: { documentId: created.id, itemId: created.itemId },
    });
    return created;
  });
  revalidatePath('/onboarding');
  revalidatePath(`/admin/users/onboarding/${input.caseId}`);
  return { success: true, documentId: document.id };
}

export async function getOnboardingDocumentDownloadUrl(documentId: string) {
  const actor = await getActor();
  if (!actor) return { success: false, error: 'Not authenticated.' };
  const document = await prisma.onboardingDocument.findUnique({
    where: { id: documentId },
    include: { case: { include: { items: { select: { assignedUserId: true } } } } },
  });
  const downloadPath = document?.signedStoragePath || document?.storagePath;
  if (!document || !downloadPath || !canViewOnboardingCase(actor, document.case)) {
    return { success: false, error: 'Document not found.' };
  }
  const candidate = document.case.userId === actor.userId;
  if (candidate && document.visibility === OnboardingDocumentVisibility.INTERNAL) {
    return { success: false, error: 'Not authorized.' };
  }
  if (!candidate && !hasAnyAdminRole(actor.roles) && document.case.ownerId !== actor.userId) {
    return { success: false, error: 'Not authorized.' };
  }
  const { data, error } = await getSupabaseAdmin()
    .storage.from(getOnboardingDocumentsBucket())
    .createSignedUrl(downloadPath, getSignedUrlExpirySeconds());
  if (error || !data?.signedUrl) return { success: false, error: 'Failed to create download URL.' };
  return { success: true, signedUrl: data.signedUrl };
}

export async function requestOnboardingSignature(documentId: string) {
  const actor = await getActor();
  const document = await prisma.onboardingDocument.findUnique({
    where: { id: documentId },
    include: {
      case: {
        include: {
          items: { select: { assignedUserId: true } },
        },
      },
    },
  });
  if (
    !actor ||
    !document ||
    !document.storagePath ||
    !canManageOnboardingCase(actor, document.case) ||
    (!hasAnyAdminRole(actor.roles) && document.case.ownerId !== actor.userId)
  ) {
    return { success: false, error: 'Not authorized.' };
  }
  const eligibleStatuses = new Set<OnboardingDocumentStatus>([
    OnboardingDocumentStatus.UPLOADED,
    OnboardingDocumentStatus.REJECTED,
  ]);
  const existingRequestId =
    document.signerStatus &&
    typeof document.signerStatus === 'object' &&
    !Array.isArray(document.signerStatus) &&
    typeof (document.signerStatus as Record<string, unknown>).requestId === 'string'
      ? String((document.signerStatus as Record<string, unknown>).requestId)
      : '';
  const resuming =
    document.status === OnboardingDocumentStatus.PENDING_SIGNATURE &&
    document.signatureProvider === 'creating' &&
    Boolean(existingRequestId);
  if (!resuming && !eligibleStatuses.has(document.status)) {
    return { success: false, error: 'This document already has an active signature request.' };
  }
  const requestId = existingRequestId || randomUUID();
  if (!resuming) {
    const claim = await prisma.onboardingDocument.updateMany({
      where: {
        id: document.id,
        status: {
          in: [OnboardingDocumentStatus.UPLOADED, OnboardingDocumentStatus.REJECTED],
        },
      },
      data: {
        status: OnboardingDocumentStatus.PENDING_SIGNATURE,
        signatureProvider: 'creating',
        signerStatus: { status: 'creating', requestId },
      },
    });
    if (claim.count === 0) {
      return { success: false, error: 'This document already has an active signature request.' };
    }
  }
  let envelopeId: string | null = null;
  let provider = 'manual';
  try {
    const adapter = getESignAdapter();
    if (adapter) {
      const { data, error } = await getSupabaseAdmin()
        .storage.from(getOnboardingDocumentsBucket())
        .createSignedUrl(document.storagePath, 60 * 60);
      if (error || !data?.signedUrl) {
        throw new Error('Unable to prepare the document for signature.');
      }
      const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000';
      const envelope = await adapter.createEnvelope({
        idempotencyKey: requestId,
        documentId: document.id,
        documentName: document.name,
        documentDownloadUrl: data.signedUrl,
        recipientName: document.case.candidateName,
        recipientEmail: document.case.personalEmail,
        callbackUrl: `${baseUrl}/api/webhooks/esign`,
      });
      envelopeId = envelope.envelopeId;
      provider = adapter.provider;
    }
  } catch (error) {
    await prisma.onboardingDocument.update({
      where: { id: document.id },
      data: {
        status: OnboardingDocumentStatus.PENDING_SIGNATURE,
        signatureProvider: 'creating',
        signerStatus: {
          status: 'retry',
          requestId,
          error: error instanceof Error ? error.message.slice(0, 500) : 'Unknown error',
        },
      },
    });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unable to create signature request.',
    };
  }
  await prisma.$transaction(async (tx) => {
    await tx.onboardingDocument.update({
      where: { id: document.id },
      data: {
        status: OnboardingDocumentStatus.PENDING_SIGNATURE,
        signatureProvider: provider,
        externalEnvelopeId: envelopeId,
        signerStatus: { status: envelopeId ? 'sent' : 'manual', requestId },
      },
    });
    await recordEvent(tx, {
      caseId: document.caseId,
      actorId: actor.userId,
      action: 'SIGNATURE_REQUESTED',
      details: { documentId: document.id, provider, envelopeId },
      email: {
        to: document.case.personalEmail,
        subject: `Signature requested: ${document.name}`,
        text: envelopeId
          ? 'A document has been sent to your email for electronic signature.'
          : 'A document is ready for signature. Please follow the instructions from your onboarding contact.',
        href: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}/onboarding`,
      },
    });
  });
  if (envelopeId) {
    try {
      await replayUnmatchedOnboardingESignEvents(envelopeId);
    } catch (error) {
      console.error('[onboarding.esign] Failed to replay early webhook event', {
        documentId: document.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
  revalidatePath(`/admin/users/onboarding/${document.caseId}`);
  return { success: true, mode: envelopeId ? 'provider' : 'manual', envelopeId };
}

export async function updateDocumentSignatureState(input: {
  documentId: string;
  status: OnboardingDocumentStatus;
  provider?: string;
  externalEnvelopeId?: string;
  signerStatus?: Prisma.InputJsonValue;
}) {
  const actor = await getActor();
  const document = await prisma.onboardingDocument.findUnique({
    where: { id: input.documentId },
    include: { case: { include: { items: { select: { assignedUserId: true } } } } },
  });
  if (
    !actor ||
    !document ||
    !canManageOnboardingCase(actor, document.case) ||
    (!hasAnyAdminRole(actor.roles) && document.case.ownerId !== actor.userId)
  ) {
    return { success: false, error: 'Not authorized.' };
  }
  await prisma.$transaction(async (tx) => {
    await tx.onboardingDocument.update({
      where: { id: input.documentId },
      data: {
        status: input.status,
        signatureProvider: cleanText(input.provider, 80) || undefined,
        externalEnvelopeId: cleanText(input.externalEnvelopeId, 200) || undefined,
        signerStatus: input.signerStatus,
        webhookUpdatedAt: new Date(),
      },
    });
    await recordEvent(tx, {
      caseId: document.caseId,
      actorId: actor.userId,
      action: 'DOCUMENT_SIGNATURE_STATUS_UPDATED',
      details: { documentId: document.id, status: input.status },
    });
  });
  revalidatePath(`/admin/users/onboarding/${document.caseId}`);
  return { success: true };
}

export async function enqueueOverdueOnboardingReminders(workerSecret?: string) {
  const expectedSecret = process.env.CRON_SECRET?.trim();
  if (!expectedSecret || workerSecret !== expectedSecret) {
    return { queued: 0, inspected: 0, unauthorized: true };
  }
  await drainOnboardingFileDeletionJobs();
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const items = await prisma.onboardingItem.findMany({
    where: {
      dueAt: { lt: now },
      status: {
        notIn: [OnboardingItemStatus.COMPLETED, OnboardingItemStatus.NOT_APPLICABLE],
      },
      case: {
        status: {
          notIn: [OnboardingStatus.COMPLETED, OnboardingStatus.CANCELLED],
        },
      },
    },
    include: {
      case: { select: { id: true, candidateName: true, personalEmail: true, userId: true } },
    },
  });
  const assignedIds = Array.from(
    new Set(items.map((item) => item.assignedUserId).filter((id): id is string => Boolean(id))),
  );
  const assignedUsers = assignedIds.length
    ? await prisma.user.findMany({
        where: { id: { in: assignedIds }, active: true },
        select: { id: true, email: true },
      })
    : [];
  const emails = new Map(assignedUsers.map((user) => [user.id, user.email]));
  let queued = 0;
  for (const item of items) {
    const to =
      (item.assignedUserId && emails.get(item.assignedUserId)) ||
      (item.owner === OnboardingItemOwner.NEW_HIRE ? item.case.personalEmail : null);
    if (!to) continue;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.notificationOutbox.create({
          data: {
            eventType: NotificationOutboxEventType.ONBOARDING,
            idempotencyKey: `onboarding-reminder:${item.id}:${dayKey}`,
            payload: {
              caseId: item.case.id,
              to,
              subject: `Overdue onboarding item: ${item.label}`,
              text: `${item.label} for ${item.case.candidateName} is overdue. Open BISU Portal to review the next step.`,
              href: `${process.env.NEXTAUTH_URL || 'http://localhost:3000'}${
                item.owner === OnboardingItemOwner.NEW_HIRE
                  ? '/onboarding'
                  : `/admin/users/onboarding/${item.case.id}`
              }`,
            },
          },
        });
        await tx.onboardingEvent.create({
          data: {
            caseId: item.case.id,
            action: 'OVERDUE_REMINDER_QUEUED',
            details: { itemId: item.id, recipientType: item.assignedUserId ? 'ASSIGNEE' : 'NEW_HIRE' },
          },
        });
        if (item.assignedUserId) {
          await tx.notification.create({
            data: {
              userId: item.assignedUserId,
              eventLabel: 'ONBOARDING',
              title: `Overdue: ${item.label}`,
              message: `${item.case.candidateName}'s onboarding item needs attention.`,
              href: `/admin/users/onboarding/${item.case.id}`,
            },
          });
        }
      });
      queued += 1;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
    }
  }
  return { queued, inspected: items.length };
}
