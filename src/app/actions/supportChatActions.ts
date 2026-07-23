'use server';

import { prisma } from '@/lib/prisma';
import { authOptions } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import {
  getSignedUrlExpirySeconds,
  getSupabaseAdmin,
  getSupportAttachmentsBucket,
} from '@/lib/supabaseAdmin';
import {
  ANY_ADMIN_ROLES,
  canAccessUserManagement,
  canManageUser,
  isAdmin,
} from '@/lib/adminTiers';
import {
  SUPPORT_DESK_LABELS,
  resolveSupportDeskRouting,
} from '@/lib/supportChatRouting';
import { canUseSupportChatPilot } from '@/lib/supportChatPilot';
import {
  SupportConversationStatus,
  SupportDesk,
  SupportAttachmentPurpose,
  UserRole,
} from '@prisma/client';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';

const MAX_MESSAGE_LENGTH = 4000;
const MAX_SUBJECT_LENGTH = 140;
const DEFAULT_LIST_LIMIT = 30;

const SUPPORT_STATUS_LABELS: Record<SupportConversationStatus, string> = {
  [SupportConversationStatus.OPEN]: 'Open',
  [SupportConversationStatus.WAITING_ON_STAFF]: 'Waiting on Staff',
  [SupportConversationStatus.WAITING_ON_REQUESTER]: 'Waiting on Requester',
  [SupportConversationStatus.RESOLVED]: 'Resolved',
  [SupportConversationStatus.ARCHIVED]: 'Archived',
};

export type SupportDeskAssignmentInput = {
  desk: SupportDesk;
  active: boolean;
  lenders: string[];
  loanTypes: string[];
  states: string[];
};

type SessionActor = {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  activeRole: UserRole;
  roles: UserRole[];
};

function uniqueStrings(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

function trimText(value: unknown, maxLength: number) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim();
  const replaced = trimmed.replace(/[^\w.\-()+\s]/g, '_').replace(/\s+/g, ' ');
  return replaced.length ? replaced : 'file';
}

function getPortalBaseUrl() {
  return process.env.NEXTAUTH_URL || 'http://localhost:3000';
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function getActor(): Promise<SessionActor | null> {
  const session = await getServerSession(authOptions);
  const sessionUser = session?.user;
  const userId = sessionUser?.id as string | undefined;
  const role = sessionUser?.role as UserRole | undefined;
  const activeRole = (sessionUser?.activeRole || role) as UserRole | undefined;
  const sessionRoles = sessionUser?.roles as UserRole[] | undefined;
  const roles = sessionRoles && sessionRoles.length > 0 ? sessionRoles : role ? [role] : [];
  if (!userId || !role || !activeRole || roles.length === 0) return null;
  return {
    userId,
    name: sessionUser?.name || 'Portal User',
    email: sessionUser?.email || '',
    role,
    activeRole,
    roles,
  };
}

function isElevatedSupportRole(actor: SessionActor) {
  return isAdmin(actor.activeRole) || actor.activeRole === UserRole.MANAGER || actor.roles.some((role) => isAdmin(role) || role === UserRole.MANAGER);
}

async function loadTargetUserRoles(userId: string) {
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, roles: true },
  });
  if (!target) return null;
  return Array.from(new Set([target.role, ...(target.roles ?? [])]));
}

async function getDeskAssignmentsForUser(userId: string) {
  return prisma.supportDeskAssignment.findMany({
    where: { userId, active: true },
    select: { desk: true },
  });
}

async function canAccessSupportConversation(actor: SessionActor, conversationId: string) {
  const conversation = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    select: {
      id: true,
      desk: true,
      requesterId: true,
      assignedUserId: true,
    },
  });
  if (!conversation) return { allowed: false as const, conversation: null };
  if (conversation.requesterId === actor.userId) {
    return { allowed: true as const, conversation };
  }
  if (conversation.assignedUserId === actor.userId || isElevatedSupportRole(actor)) {
    return { allowed: true as const, conversation };
  }
  const assignment = await prisma.supportDeskAssignment.findFirst({
    where: {
      userId: actor.userId,
      desk: conversation.desk,
      active: true,
      user: { active: true },
    },
    select: { id: true },
  });
  return { allowed: Boolean(assignment), conversation };
}

function buildSupportEmail(input: {
  title: string;
  intro: string;
  desk: SupportDesk;
  subject: string;
  message: string;
  ctaLabel: string;
  url: string;
}) {
  const deskLabel = SUPPORT_DESK_LABELS[input.desk];
  const html = `
  <div style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" style="max-width:680px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#eff6ff,#eef2ff);">
          <p style="margin:0;font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#1d4ed8;">${escapeHtml(deskLabel)}</p>
          <h1 style="margin:6px 0 0;font-size:22px;line-height:1.25;color:#0f172a;">${escapeHtml(input.title)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:24px;">
          <p style="margin:0 0 14px;color:#475569;font-size:15px;line-height:1.6;">${escapeHtml(input.intro)}</p>
          <table role="presentation" style="width:100%;border-collapse:collapse;margin:14px 0;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
            <tr>
              <td style="padding:10px 12px;background:#f8fafc;color:#64748b;font-size:12px;font-weight:700;width:110px;">Subject</td>
              <td style="padding:10px 12px;color:#0f172a;font-size:13px;font-weight:700;">${escapeHtml(input.subject)}</td>
            </tr>
            <tr>
              <td style="padding:10px 12px;background:#f8fafc;color:#64748b;font-size:12px;font-weight:700;vertical-align:top;">Message</td>
              <td style="padding:10px 12px;color:#0f172a;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(input.message)}</td>
            </tr>
          </table>
          <p style="margin:18px 0 0;">
            <a href="${escapeHtml(input.url)}" style="display:inline-block;padding:12px 18px;border-radius:12px;background:#2563eb;color:#fff;text-decoration:none;font-weight:800;">${escapeHtml(input.ctaLabel)}</a>
          </p>
        </td>
      </tr>
    </table>
  </div>`;
  const text = [
    input.title,
    '',
    `Desk: ${deskLabel}`,
    `Subject: ${input.subject}`,
    '',
    input.message,
    '',
    `${input.ctaLabel}: ${input.url}`,
  ].join('\n');
  return { html, text };
}

async function createNotifications(input: {
  userIds: string[];
  eventLabel: string;
  title: string;
  message: string;
  href: string;
}) {
  const userIds = Array.from(new Set(input.userIds.filter(Boolean)));
  if (userIds.length === 0) return;
  await prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      eventLabel: input.eventLabel,
      title: input.title,
      message: input.message,
      href: input.href,
    })),
  });
}

async function sendSupportEmails(input: {
  to: string[];
  title: string;
  intro: string;
  desk: SupportDesk;
  subject: string;
  message: string;
  ctaLabel: string;
  url: string;
}) {
  const recipients = Array.from(new Set(input.to.map((email) => email.trim()).filter(Boolean)));
  if (recipients.length === 0) return;
  const email = buildSupportEmail(input);
  await Promise.allSettled(
    recipients.map((to) =>
      sendEmail({
        to,
        subject: `[FFL Portal] ${input.title}`,
        html: email.html,
        text: email.text,
        label: 'support-chat',
      })
    )
  );
}

function serializeConversation(conversation: {
  id: string;
  desk: SupportDesk;
  status: SupportConversationStatus;
  subject: string;
  requesterId: string;
  assignedUserId: string | null;
  lender: string | null;
  loanType: string | null;
  propertyState: string | null;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt: Date;
  resolvedAt: Date | null;
  requester?: { id: string; name: string; email: string } | null;
  assignedUser?: { id: string; name: string; email: string } | null;
  messages?: Array<{
    id: string;
    authorId: string;
    body: string;
    staffOnly: boolean;
    createdAt: Date;
    author: { id: string; name: string; email: string; role: UserRole };
  }>;
  attachments?: Array<{
    id: string;
    purpose: SupportAttachmentPurpose;
    filename: string;
    contentType: string;
    sizeBytes: number;
    createdAt: Date;
    uploadedBy: { id: string; name: string; email: string };
  }>;
}, unreadCount = 0) {
  return {
    ...conversation,
    deskLabel: SUPPORT_DESK_LABELS[conversation.desk],
    statusLabel: SUPPORT_STATUS_LABELS[conversation.status],
    createdAt: conversation.createdAt.toISOString(),
    updatedAt: conversation.updatedAt.toISOString(),
    lastMessageAt: conversation.lastMessageAt.toISOString(),
    resolvedAt: conversation.resolvedAt?.toISOString() ?? null,
    unreadCount,
    messages: conversation.messages?.map((message) => ({
      ...message,
      createdAt: message.createdAt.toISOString(),
    })) ?? [],
    attachments: conversation.attachments?.map((attachment) => ({
      ...attachment,
      createdAt: attachment.createdAt.toISOString(),
    })) ?? [],
  };
}

async function countUnread(conversationId: string, userId: string) {
  const readState = await prisma.supportConversationReadState.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { lastReadAt: true },
  });
  return prisma.supportMessage.count({
    where: {
      conversationId,
      authorId: { not: userId },
      ...(readState ? { createdAt: { gt: readState.lastReadAt } } : {}),
    },
  });
}

export async function getSupportChatBootstrap() {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };

  const [conversations, loans] = await Promise.all([
    prisma.supportConversation.findMany({
      where: { requesterId: actor.userId, status: { not: SupportConversationStatus.ARCHIVED } },
      include: {
        assignedUser: { select: { id: true, name: true, email: true } },
        requester: { select: { id: true, name: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { author: { select: { id: true, name: true, email: true, role: true } } },
        },
        attachments: {
          orderBy: { createdAt: 'asc' },
          include: { uploadedBy: { select: { id: true, name: true, email: true } } },
        },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: DEFAULT_LIST_LIMIT,
    }),
    prisma.loan.findMany({
      where: {
        OR: [
          { loanOfficerId: actor.userId },
          { secondaryLoanOfficerId: actor.userId },
          { visibilitySubmitterUserId: actor.userId },
        ],
      },
      select: {
        id: true,
        loanNumber: true,
        borrowerName: true,
        program: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
  ]);

  const unreadCounts = await Promise.all(
    conversations.map((conversation) => countUnread(conversation.id, actor.userId))
  );

  return {
    success: true as const,
    conversations: conversations.map((conversation, index) =>
      serializeConversation(conversation, unreadCounts[index])
    ),
    loans,
  };
}

export async function getMySupportConversations() {
  const result = await getSupportChatBootstrap();
  if (!result.success) return result;
  return { success: true as const, conversations: result.conversations };
}

export async function createSupportConversation(input: {
  desk: SupportDesk;
  subject: string;
  body: string;
  loanId?: string | null;
  lender?: string | null;
  loanType?: string | null;
  propertyState?: string | null;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  if (!canUseSupportChatPilot(actor)) {
    return { success: false as const, error: 'Support chat is currently limited to the pilot group.' };
  }

  const subject = trimText(input.subject, MAX_SUBJECT_LENGTH);
  const body = trimText(input.body, MAX_MESSAGE_LENGTH);
  if (!subject || !body) {
    return { success: false as const, error: 'Subject and message are required.' };
  }
  if (!Object.values(SupportDesk).includes(input.desk)) {
    return { success: false as const, error: 'Select a valid desk.' };
  }

  let loanId: string | null = null;
  if (input.loanId) {
    const loan = await prisma.loan.findFirst({
      where: {
        id: input.loanId,
        OR: [
          { loanOfficerId: actor.userId },
          { secondaryLoanOfficerId: actor.userId },
          { visibilitySubmitterUserId: actor.userId },
        ],
      },
      select: { id: true },
    });
    loanId = loan?.id ?? null;
  }

  const routing = await resolveSupportDeskRouting(input.desk, {
    lender: input.lender,
    loanType: input.loanType,
    propertyState: input.propertyState,
  });

  const now = new Date();
  const conversation = await prisma.supportConversation.create({
    data: {
      desk: input.desk,
      status: SupportConversationStatus.WAITING_ON_STAFF,
      subject,
      requesterId: actor.userId,
      assignedUserId: routing.assignedUserId,
      loanId,
      lender: trimText(input.lender, 80) || null,
      loanType: trimText(input.loanType, 80) || null,
      propertyState: trimText(input.propertyState, 40) || null,
      lastMessageAt: now,
      messages: {
        create: {
          authorId: actor.userId,
          body,
        },
      },
      readStates: {
        create: {
          userId: actor.userId,
          lastReadAt: now,
        },
      },
    },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: {
        include: { author: { select: { id: true, name: true, email: true, role: true } } },
        orderBy: { createdAt: 'asc' },
      },
      attachments: {
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  const staffHref = `/admin/support?conversationId=${encodeURIComponent(conversation.id)}`;
  const staffUsers = routing.recipientUsers.filter((user) => user.id !== actor.userId);
  await createNotifications({
    userIds: staffUsers.map((user) => user.id),
    eventLabel: 'Support Chat',
    title: `New ${SUPPORT_DESK_LABELS[input.desk]} request`,
    message: `${actor.name}: ${subject}`,
    href: staffHref,
  });
  await sendSupportEmails({
    to: staffUsers.map((user) => user.email),
    title: `New ${SUPPORT_DESK_LABELS[input.desk]} request`,
    intro: `${actor.name} opened a new support chat.`,
    desk: input.desk,
    subject,
    message: body,
    ctaLabel: 'Open Support Request',
    url: `${getPortalBaseUrl()}${staffHref}`,
  });

  revalidatePath('/');
  revalidatePath('/admin/support');
  return {
    success: true as const,
    conversation: serializeConversation(conversation),
  };
}

export async function getSupportConversation(conversationId: string) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = await canAccessSupportConversation(actor, conversationId);
  if (!access.allowed) return { success: false as const, error: 'Not authorized.' };

  const conversation = await prisma.supportConversation.findUnique({
    where: { id: conversationId },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, email: true, role: true } } },
      },
      attachments: {
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  if (!conversation) return { success: false as const, error: 'Conversation not found.' };
  await markSupportConversationRead(conversationId);
  return {
    success: true as const,
    conversation: serializeConversation(conversation, 0),
  };
}

export async function sendSupportMessage(input: {
  conversationId: string;
  body: string;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const body = trimText(input.body, MAX_MESSAGE_LENGTH);
  if (!body) return { success: false as const, error: 'Message is required.' };
  const access = await canAccessSupportConversation(actor, input.conversationId);
  if (!access.allowed || !access.conversation) {
    return { success: false as const, error: 'Not authorized.' };
  }

  const isRequester = access.conversation.requesterId === actor.userId;
  const nextStatus = isRequester
    ? SupportConversationStatus.WAITING_ON_STAFF
    : SupportConversationStatus.WAITING_ON_REQUESTER;
  const now = new Date();

  const conversation = await prisma.supportConversation.update({
    where: { id: input.conversationId },
    data: {
      status: nextStatus,
      resolvedAt: null,
      lastMessageAt: now,
      messages: {
        create: {
          authorId: actor.userId,
          body,
        },
      },
      readStates: {
        upsert: {
          where: {
            conversationId_userId: {
              conversationId: input.conversationId,
              userId: actor.userId,
            },
          },
          create: {
            userId: actor.userId,
            lastReadAt: now,
          },
          update: {
            lastReadAt: now,
          },
        },
      },
    },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, email: true, role: true } } },
      },
      attachments: {
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  const recipientUsers = isRequester
    ? [
        ...(conversation.assignedUser ? [conversation.assignedUser] : []),
        ...(await resolveSupportDeskRouting(conversation.desk, {
          lender: conversation.lender,
          loanType: conversation.loanType,
          propertyState: conversation.propertyState,
        })).recipientUsers,
      ]
    : [conversation.requester];
  const uniqueRecipientUsers = Array.from(
    new Map(recipientUsers.filter((user) => user.id !== actor.userId).map((user) => [user.id, user])).values()
  );
  const href = isRequester
    ? `/admin/support?conversationId=${encodeURIComponent(conversation.id)}`
    : `/?supportConversationId=${encodeURIComponent(conversation.id)}`;

  await createNotifications({
    userIds: uniqueRecipientUsers.map((user) => user.id),
    eventLabel: 'Support Chat Reply',
    title: `New reply: ${conversation.subject}`,
    message: `${actor.name}: ${body.slice(0, 180)}`,
    href,
  });
  await sendSupportEmails({
    to: uniqueRecipientUsers.map((user) => user.email),
    title: `New reply: ${conversation.subject}`,
    intro: `${actor.name} replied to a support chat.`,
    desk: conversation.desk,
    subject: conversation.subject,
    message: body,
    ctaLabel: 'Open Support Chat',
    url: `${getPortalBaseUrl()}${href}`,
  });

  revalidatePath('/');
  revalidatePath('/admin/support');
  return { success: true as const, conversation: serializeConversation(conversation, 0) };
}

export async function markSupportConversationRead(conversationId: string) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = await canAccessSupportConversation(actor, conversationId);
  if (!access.allowed) return { success: false as const, error: 'Not authorized.' };

  await prisma.supportConversationReadState.upsert({
    where: { conversationId_userId: { conversationId, userId: actor.userId } },
    create: { conversationId, userId: actor.userId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  return { success: true as const };
}

export async function getSupportInbox(input?: {
  desk?: SupportDesk | 'ALL';
  status?: SupportConversationStatus | 'ALL';
  assignedToMe?: boolean;
  search?: string;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const assignments = await getDeskAssignmentsForUser(actor.userId);
  const assignedDesks = assignments.map((assignment) => assignment.desk);
  const elevated = isElevatedSupportRole(actor);
  if (!elevated && assignedDesks.length === 0) {
    return { success: false as const, error: 'Not authorized.' };
  }

  const desk = input?.desk && input.desk !== 'ALL' ? input.desk : undefined;
  const status = input?.status && input.status !== 'ALL' ? input.status : undefined;
  const search = trimText(input?.search, 120);
  const conversations = await prisma.supportConversation.findMany({
    where: {
      ...(desk ? { desk } : {}),
      ...(status ? { status } : { status: { not: SupportConversationStatus.ARCHIVED } }),
      ...(input?.assignedToMe ? { assignedUserId: actor.userId } : {}),
      ...(!elevated ? { OR: [{ assignedUserId: actor.userId }, { desk: { in: assignedDesks } }] } : {}),
      ...(search
        ? {
            OR: [
              { subject: { contains: search, mode: 'insensitive' } },
              { lender: { contains: search, mode: 'insensitive' } },
              { loanType: { contains: search, mode: 'insensitive' } },
              { requester: { name: { contains: search, mode: 'insensitive' } } },
              { requester: { email: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: { author: { select: { id: true, name: true, email: true, role: true } } },
      },
      attachments: {
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { id: true, name: true, email: true } } },
      },
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
  });
  const unreadCounts = await Promise.all(
    conversations.map((conversation) => countUnread(conversation.id, actor.userId))
  );
  const staffUsers = await prisma.user.findMany({
    where: {
      active: true,
      OR: [
        { supportDeskAssignments: { some: { active: true } } },
        { role: { in: [...ANY_ADMIN_ROLES, UserRole.MANAGER] } },
        { roles: { hasSome: [...ANY_ADMIN_ROLES, UserRole.MANAGER] } },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });

  return {
    success: true as const,
    conversations: conversations.map((conversation, index) =>
      serializeConversation(conversation, unreadCounts[index])
    ),
    staffUsers,
    assignedDesks,
  };
}

export async function assignSupportConversation(input: {
  conversationId: string;
  assignedUserId: string | null;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = await canAccessSupportConversation(actor, input.conversationId);
  if (!access.allowed) return { success: false as const, error: 'Not authorized.' };

  const assignedUser = input.assignedUserId
    ? await prisma.user.findFirst({
        where: { id: input.assignedUserId, active: true },
        select: { id: true, email: true, name: true },
      })
    : null;
  if (input.assignedUserId && !assignedUser) {
    return { success: false as const, error: 'Assigned user not found.' };
  }

  const conversation = await prisma.supportConversation.update({
    where: { id: input.conversationId },
    data: { assignedUserId: assignedUser?.id ?? null },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, email: true, role: true } } },
      },
      attachments: {
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { id: true, name: true, email: true } } },
      },
    },
  });

  if (assignedUser && assignedUser.id !== actor.userId) {
    const href = `/admin/support?conversationId=${encodeURIComponent(conversation.id)}`;
    await createNotifications({
      userIds: [assignedUser.id],
      eventLabel: 'Support Chat Assigned',
      title: `Assigned: ${conversation.subject}`,
      message: `${actor.name} assigned you a ${SUPPORT_DESK_LABELS[conversation.desk]} request.`,
      href,
    });
    await sendSupportEmails({
      to: [assignedUser.email],
      title: `Assigned: ${conversation.subject}`,
      intro: `${actor.name} assigned you a support chat.`,
      desk: conversation.desk,
      subject: conversation.subject,
      message: conversation.messages.at(-1)?.body ?? conversation.subject,
      ctaLabel: 'Open Support Request',
      url: `${getPortalBaseUrl()}${href}`,
    });
  }

  revalidatePath('/admin/support');
  return { success: true as const, conversation: serializeConversation(conversation) };
}

export async function updateSupportConversationStatus(input: {
  conversationId: string;
  status: SupportConversationStatus;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = await canAccessSupportConversation(actor, input.conversationId);
  if (!access.allowed) return { success: false as const, error: 'Not authorized.' };
  if (!Object.values(SupportConversationStatus).includes(input.status)) {
    return { success: false as const, error: 'Select a valid status.' };
  }
  const conversation = await prisma.supportConversation.update({
    where: { id: input.conversationId },
    data: {
      status: input.status,
      resolvedAt: input.status === SupportConversationStatus.RESOLVED ? new Date() : null,
    },
    include: {
      requester: { select: { id: true, name: true, email: true } },
      assignedUser: { select: { id: true, name: true, email: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, name: true, email: true, role: true } } },
      },
      attachments: {
        orderBy: { createdAt: 'asc' },
        include: { uploadedBy: { select: { id: true, name: true, email: true } } },
      },
    },
  });
  revalidatePath('/');
  revalidatePath('/admin/support');
  return { success: true as const, conversation: serializeConversation(conversation) };
}

export async function createSupportAttachmentUploadUrl(input: {
  conversationId: string;
  filename: string;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = await canAccessSupportConversation(actor, input.conversationId);
  if (!access.allowed) return { success: false as const, error: 'Not authorized.' };

  const safeName = sanitizeFilename(input.filename);
  const storagePath = `support/${input.conversationId}/${randomUUID()}-${safeName}`;
  const supabase = getSupabaseAdmin();
  const bucket = getSupportAttachmentsBucket();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);

  if (error || !data) {
    console.error('[support-chat] createSignedUploadUrl failed', error);
    return { success: false as const, error: 'Failed to create upload URL.' };
  }

  return {
    success: true as const,
    signedUrl: data.signedUrl,
    path: data.path,
    token: data.token,
  };
}

export async function finalizeSupportAttachment(input: {
  conversationId: string;
  storagePath: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  purpose?: SupportAttachmentPurpose;
}) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const access = await canAccessSupportConversation(actor, input.conversationId);
  if (!access.allowed) return { success: false as const, error: 'Not authorized.' };

  const attachment = await prisma.supportAttachment.create({
    data: {
      conversationId: input.conversationId,
      uploadedById: actor.userId,
      purpose: input.purpose ?? SupportAttachmentPurpose.OTHER,
      storagePath: input.storagePath,
      filename: sanitizeFilename(input.filename),
      contentType: input.contentType || 'application/octet-stream',
      sizeBytes: Math.max(0, Math.floor(input.sizeBytes)),
    },
  });

  revalidatePath('/');
  revalidatePath('/admin/support');
  return { success: true as const, attachmentId: attachment.id };
}

export async function getSupportAttachmentDownloadUrl(attachmentId: string) {
  const actor = await getActor();
  if (!actor) return { success: false as const, error: 'Not authenticated.' };
  const attachment = await prisma.supportAttachment.findUnique({
    where: { id: attachmentId },
    select: {
      id: true,
      storagePath: true,
      conversationId: true,
    },
  });
  if (!attachment) return { success: false as const, error: 'Attachment not found.' };

  const access = await canAccessSupportConversation(actor, attachment.conversationId);
  if (!access.allowed) return { success: false as const, error: 'Not authorized.' };

  const supabase = getSupabaseAdmin();
  const bucket = getSupportAttachmentsBucket();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(attachment.storagePath, getSignedUrlExpirySeconds());
  if (error || !data?.signedUrl) {
    console.error('[support-chat] createSignedUrl failed', error);
    return { success: false as const, error: 'Failed to create download URL.' };
  }
  return { success: true as const, url: data.signedUrl };
}

export async function getSupportDeskAssignments(userId: string) {
  const actor = await getActor();
  if (!actor || !canAccessUserManagement(actor.roles)) {
    return { success: false as const, error: 'Not authorized.' };
  }
  const targetRoles = await loadTargetUserRoles(userId);
  if (!targetRoles) return { success: false as const, error: 'User not found.' };
  if (!canManageUser(actor.roles, targetRoles) && userId !== actor.userId) {
    return { success: false as const, error: 'You cannot manage users at or above your own admin tier.' };
  }
  const assignments = await prisma.supportDeskAssignment.findMany({
    where: { userId },
    orderBy: [{ desk: 'asc' }, { sortOrder: 'asc' }],
  });
  return {
    success: true as const,
    assignments: assignments.map((assignment) => ({
      id: assignment.id,
      desk: assignment.desk,
      active: assignment.active,
      lenders: assignment.lenders,
      loanTypes: assignment.loanTypes,
      states: assignment.states,
    })),
  };
}

export async function updateSupportDeskAssignments(input: {
  userId: string;
  assignments: SupportDeskAssignmentInput[];
}) {
  const actor = await getActor();
  if (!actor || !canAccessUserManagement(actor.roles)) {
    return { success: false as const, error: 'Not authorized.' };
  }
  const targetRoles = await loadTargetUserRoles(input.userId);
  if (!targetRoles) return { success: false as const, error: 'User not found.' };
  if (!canManageUser(actor.roles, targetRoles)) {
    return { success: false as const, error: 'You cannot manage users at or above your own admin tier.' };
  }

  const validAssignments = input.assignments.filter((assignment) =>
    Object.values(SupportDesk).includes(assignment.desk)
  );
  await prisma.$transaction(
    validAssignments.map((assignment, index) =>
      prisma.supportDeskAssignment.upsert({
        where: {
          userId_desk: {
            userId: input.userId,
            desk: assignment.desk,
          },
        },
        create: {
          userId: input.userId,
          desk: assignment.desk,
          active: Boolean(assignment.active),
          lenders: uniqueStrings(assignment.lenders),
          loanTypes: uniqueStrings(assignment.loanTypes),
          states: uniqueStrings(assignment.states),
          sortOrder: index,
        },
        update: {
          active: Boolean(assignment.active),
          lenders: uniqueStrings(assignment.lenders),
          loanTypes: uniqueStrings(assignment.loanTypes),
          states: uniqueStrings(assignment.states),
          sortOrder: index,
        },
      })
    )
  );

  revalidatePath('/admin/users');
  revalidatePath('/admin/support');
  return { success: true as const };
}
