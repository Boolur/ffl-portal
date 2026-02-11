'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { UserRole } from '@prisma/client';
import { hash } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { sendEmail } from '@/lib/email';

const ALLOWED_ROLES = Object.values(UserRole);
const INVITE_TTL_HOURS = 72;
const RESET_TTL_HOURS = 2;

const normalizeEmail = (email: string) => email.toLowerCase().trim();
const getBaseUrl = () => process.env.NEXTAUTH_URL || 'http://localhost:3000';

export async function getAllUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
  });
}

export async function createUser({
  name,
  email,
  role,
  password,
}: {
  name: string;
  email: string;
  role: UserRole;
  password: string;
}) {
  const trimmedName = name.trim();
  const trimmedEmail = normalizeEmail(email);
  const trimmedPassword = password.trim();

  if (!trimmedName || !trimmedEmail || !trimmedPassword) {
    return { success: false, error: 'Name, email, and password are required.' };
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return { success: false, error: 'Invalid role selected.' };
  }

  const existing = await prisma.user.findUnique({
    where: { email: trimmedEmail },
    select: { id: true },
  });

  if (existing) {
    return { success: false, error: 'A user with this email already exists.' };
  }

  const passwordHash = await hash(trimmedPassword, 10);

  await prisma.user.create({
    data: {
      name: trimmedName,
      email: trimmedEmail,
      role,
      passwordHash,
      active: true,
    },
  });

  revalidatePath('/admin/users');
  return { success: true };
}

export async function getPendingInvites() {
  const now = new Date();
  return prisma.inviteToken.findMany({
    where: {
      acceptedAt: null,
      expiresAt: { gt: now },
    },
    select: {
      id: true,
      email: true,
      role: true,
      createdAt: true,
      expiresAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function inviteUser({
  name,
  email,
  role,
  createdById,
}: {
  name: string;
  email: string;
  role: UserRole;
  createdById: string;
}) {
  try {
    const trimmedName = name.trim();
    const trimmedEmail = normalizeEmail(email);

    if (!trimmedName || !trimmedEmail) {
      return { success: false, error: 'Name and email are required.' };
    }

    if (!ALLOWED_ROLES.includes(role)) {
      return { success: false, error: 'Invalid role selected.' };
    }

    const existing = await prisma.user.findUnique({
      where: { email: trimmedEmail },
      select: { id: true, active: true },
    });

    if (existing?.active) {
      return { success: false, error: 'A user with this email already exists.' };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    await prisma.inviteToken.create({
      data: {
        token,
        email: trimmedEmail,
        name: trimmedName,
        role,
        createdById,
        expiresAt,
      },
    });

    const inviteUrl = `${getBaseUrl()}/auth/invite/${token}`;
    await sendEmail({
      to: trimmedEmail,
      subject: 'Your FFL Portal invite',
      text: `You have been invited to FFL Portal. Set your password here: ${inviteUrl}`,
      html: `<p>You have been invited to FFL Portal.</p><p><a href="${inviteUrl}">Set your password</a></p>`,
    });

    revalidatePath('/admin/users');
    return { success: true };
  } catch (error) {
    console.error('Failed to send invite email', error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Failed to send invite email.';
    return { success: false, error: message };
  }
}

export async function deleteInvite(inviteId: string) {
  if (!inviteId) {
    return { success: false, error: 'Missing invite ID.' };
  }

  await prisma.inviteToken.delete({
    where: { id: inviteId },
  });

  revalidatePath('/admin/users');
  return { success: true };
}

export async function resendInvite(inviteId: string) {
  if (!inviteId) {
    return { success: false, error: 'Missing invite ID.' };
  }

  try {
    const existing = await prisma.inviteToken.findUnique({
      where: { id: inviteId },
    });

    if (!existing || existing.acceptedAt) {
      return { success: false, error: 'Invite is invalid or already accepted.' };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);

    await prisma.$transaction([
      prisma.inviteToken.delete({ where: { id: inviteId } }),
      prisma.inviteToken.create({
        data: {
          token,
          email: existing.email,
          role: existing.role,
          createdById: existing.createdById,
          expiresAt,
        },
      }),
    ]);

    const inviteUrl = `${getBaseUrl()}/auth/invite/${token}`;
    await sendEmail({
      to: existing.email,
      subject: 'Your FFL Portal invite',
      text: `You have been invited to FFL Portal. Set your password here: ${inviteUrl}`,
      html: `<p>You have been invited to FFL Portal.</p><p><a href="${inviteUrl}">Set your password</a></p>`,
    });

    revalidatePath('/admin/users');
    return { success: true };
  } catch (error) {
    console.error('Failed to resend invite email', error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Failed to resend invite email.';
    return { success: false, error: message };
  }
}

export async function acceptInvite({
  token,
  password,
  name,
}: {
  token: string;
  password: string;
  name?: string;
}) {
  try {
    const invite = await prisma.inviteToken.findUnique({
      where: { token },
    });

    if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
      return { success: false, error: 'Invite is invalid or expired.' };
    }

    const trimmedName = invite.name?.trim() || name?.trim() || invite.email;
    const trimmedPassword = password.trim();
    if (!trimmedName || !trimmedPassword) {
      return { success: false, error: 'Name and password are required.' };
    }

    const passwordHash = await hash(trimmedPassword, 10);

    await prisma.user.upsert({
      where: { email: invite.email },
      update: {
        name: trimmedName,
        role: invite.role,
        passwordHash,
        active: true,
      },
      create: {
        email: invite.email,
        name: trimmedName,
        role: invite.role,
        passwordHash,
        active: true,
      },
    });

    await prisma.inviteToken.update({
      where: { token },
      data: { acceptedAt: new Date() },
    });

    return { success: true, email: invite.email };
  } catch (error) {
    console.error('Failed to accept invite', error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Invite failed. Please try again.';
    return { success: false, error: message };
  }
}

export async function requestPasswordReset(email: string) {
  try {
    const trimmedEmail = normalizeEmail(email);
    if (!trimmedEmail) {
      return { success: false, error: 'Email is required.' };
    }

    const user = await prisma.user.findUnique({
      where: { email: trimmedEmail },
      select: { id: true, name: true },
    });

    if (!user) {
      return { success: false, error: 'User not found.' };
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + RESET_TTL_HOURS * 60 * 60 * 1000);

    await prisma.passwordResetToken.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    const resetUrl = `${getBaseUrl()}/auth/reset/${token}`;
    await sendEmail({
      to: trimmedEmail,
      subject: 'Reset your FFL Portal password',
      text: `Reset your password here: ${resetUrl}`,
      html: `<p>Reset your password:</p><p><a href="${resetUrl}">Reset Password</a></p>`,
    });

    return { success: true };
  } catch (error) {
    console.error('Failed to send password reset email', error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Failed to send password reset email.';
    return { success: false, error: message };
  }
}

export async function resetPasswordWithToken(token: string, password: string) {
  const reset = await prisma.passwordResetToken.findUnique({
    where: { token },
  });

  if (!reset || reset.usedAt || reset.expiresAt < new Date()) {
    return { success: false, error: 'Reset link is invalid or expired.' };
  }

  const passwordHash = await hash(password.trim(), 10);
  await prisma.user.update({
    where: { id: reset.userId },
    data: { passwordHash },
  });

  await prisma.passwordResetToken.update({
    where: { token },
    data: { usedAt: new Date() },
  });

  return { success: true };
}

export async function updateUserRole(userId: string, role: UserRole) {
  if (!ALLOWED_ROLES.includes(role)) {
    return { success: false, error: 'Invalid role selected.' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { role },
  });

  revalidatePath('/admin/users');
  return { success: true };
}

export async function updateUserStatus(userId: string, active: boolean) {
  await prisma.user.update({
    where: { id: userId },
    data: { active },
  });

  revalidatePath('/admin/users');
  return { success: true };
}

export async function deleteUser(userId: string) {
  if (!userId) {
    return { success: false, error: 'Missing user ID.' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { active: false },
  });

  revalidatePath('/admin/users');
  return { success: true };
}

export async function resetUserPassword(userId: string, password: string) {
  const trimmedPassword = password.trim();
  if (!trimmedPassword) {
    return { success: false, error: 'Password cannot be empty.' };
  }

  const passwordHash = await hash(trimmedPassword, 10);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  revalidatePath('/admin/users');
  return { success: true };
}
