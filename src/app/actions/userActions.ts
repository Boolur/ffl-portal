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
const normalizeRoleList = (roles: UserRole[]) =>
  Array.from(new Set(roles.filter((role) => ALLOWED_ROLES.includes(role))));
const formatRoleLabel = (role: UserRole) => role.replace(/_/g, ' ');
const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function buildAccountInviteEmail(input: {
  recipientName: string;
  role: UserRole;
  inviteUrl: string;
  baseUrl: string;
}) {
  const roleLabel = formatRoleLabel(input.role);
  const subject = 'Welcome to FFL Portal - Set up your account';
  const logoUrl = process.env.EMAIL_BRAND_LOGO_URL?.trim() || `${input.baseUrl}/logo.png`;

  const html = `
  <div style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" style="max-width:680px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#eff6ff,#eef2ff);">
          <table role="presentation" style="width:100%;">
            <tr>
              <td style="vertical-align:middle;">
                <img src="${escapeHtml(
                  logoUrl
                )}" alt="Federal First Lending" width="180" style="display:block;width:180px;max-width:180px;height:auto;max-height:44px;object-fit:contain;" />
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Account Invite</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 24px 8px;">
          <h1 style="margin:0 0 10px;font-size:24px;line-height:1.2;color:#0f172a;">You're invited to FFL Portal</h1>
          <p style="margin:0;color:#475569;font-size:15px;line-height:1.7;">
            Hi ${escapeHtml(
              input.recipientName
            )}, your account is ready. Click below to create your password and finish setup.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:4px 24px 12px;">
          <table role="presentation" style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;width:140px;vertical-align:top;">Role</td>
              <td style="padding:10px 0;color:#0f172a;font-size:14px;font-weight:700;">${escapeHtml(
                roleLabel
              )}</td>
            </tr>
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;width:140px;vertical-align:top;">Invite Expires</td>
              <td style="padding:10px 0;color:#0f172a;font-size:14px;font-weight:700;">In ${INVITE_TTL_HOURS} hours</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
            <tr>
              <td bgcolor="#1d4ed8" style="border-radius:12px;background:#1d4ed8;">
                <a
                  href="${escapeHtml(input.inviteUrl)}"
                  style="display:inline-block;padding:14px 24px;border:1px solid #1e40af;border-radius:12px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#ffffff;font-size:15px;line-height:1.2;font-weight:700;text-decoration:none;letter-spacing:0.01em;"
                >
                  Set Up My Account
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6;">
            If the button above does not work, copy and paste this URL into your browser:<br />
            <a href="${escapeHtml(input.inviteUrl)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(
    input.inviteUrl
  )}</a>
          </p>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;">
            This invitation link is private to you. If you did not expect this email, you can safely ignore it.
          </p>
        </td>
      </tr>
    </table>
  </div>
  `;

  const text = [
    'You are invited to FFL Portal.',
    '',
    `Name: ${input.recipientName}`,
    `Role: ${roleLabel}`,
    `Invite expires in: ${INVITE_TTL_HOURS} hours`,
    '',
    `Set up your account: ${input.inviteUrl}`,
  ].join('\n');

  return { subject, html, text };
}

function buildPasswordResetEmail(input: {
  recipientName: string;
  resetUrl: string;
  baseUrl: string;
}) {
  const subject = 'Reset your FFL Portal password';
  const logoUrl = process.env.EMAIL_BRAND_LOGO_URL?.trim() || `${input.baseUrl}/logo.png`;

  const html = `
  <div style="margin:0;padding:24px;background:#f8fafc;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" style="max-width:680px;width:100%;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:20px 24px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#eff6ff,#eef2ff);">
          <table role="presentation" style="width:100%;">
            <tr>
              <td style="vertical-align:middle;">
                <img src="${escapeHtml(
                  logoUrl
                )}" alt="Federal First Lending" width="180" style="display:block;width:180px;max-width:180px;height:auto;max-height:44px;object-fit:contain;" />
              </td>
              <td style="vertical-align:middle;text-align:right;">
                <span style="display:inline-block;padding:6px 10px;border-radius:999px;background:#dbeafe;color:#1d4ed8;font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Security</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 24px 8px;">
          <h1 style="margin:0 0 10px;font-size:24px;line-height:1.2;color:#0f172a;">Reset your password</h1>
          <p style="margin:0;color:#475569;font-size:15px;line-height:1.7;">
            Hi ${escapeHtml(
              input.recipientName
            )}, we received a request to reset your FFL Portal password.
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:4px 24px 12px;">
          <table role="presentation" style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;width:140px;vertical-align:top;">Link Expires</td>
              <td style="padding:10px 0;color:#0f172a;font-size:14px;font-weight:700;">In ${RESET_TTL_HOURS} hours</td>
            </tr>
            <tr>
              <td style="padding:10px 0;color:#64748b;font-size:13px;font-weight:600;width:140px;vertical-align:top;">Action</td>
              <td style="padding:10px 0;color:#0f172a;font-size:14px;font-weight:700;">Create a new password</td>
            </tr>
          </table>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 24px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="border-collapse:separate;">
            <tr>
              <td bgcolor="#1d4ed8" style="border-radius:12px;background:#1d4ed8;">
                <a
                  href="${escapeHtml(input.resetUrl)}"
                  style="display:inline-block;padding:14px 24px;border:1px solid #1e40af;border-radius:12px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#ffffff;font-size:15px;line-height:1.2;font-weight:700;text-decoration:none;letter-spacing:0.01em;"
                >
                  Reset Password
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0;color:#64748b;font-size:12px;line-height:1.6;">
            If the button above does not work, copy and paste this URL into your browser:<br />
            <a href="${escapeHtml(input.resetUrl)}" style="color:#2563eb;text-decoration:none;">${escapeHtml(
    input.resetUrl
  )}</a>
          </p>
          <p style="margin:16px 0 0;color:#94a3b8;font-size:12px;line-height:1.6;">
            If you did not request this, you can safely ignore this email.
          </p>
        </td>
      </tr>
    </table>
  </div>
  `;

  const text = [
    'We received a request to reset your FFL Portal password.',
    '',
    `Name: ${input.recipientName}`,
    `Reset link expires in: ${RESET_TTL_HOURS} hours`,
    '',
    `Reset your password: ${input.resetUrl}`,
    '',
    'If you did not request this, you can ignore this email.',
  ].join('\n');

  return { subject, html, text };
}

export async function getAllUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      roles: true,
      loDisclosureSubmissionEnabled: true,
      loQcSubmissionEnabled: true,
      active: true,
      createdAt: true,
    },
  });
}

export async function createUser({
  name,
  email,
  roles,
  password,
}: {
  name: string;
  email: string;
  roles: UserRole[];
  password: string;
}) {
  const trimmedName = name.trim();
  const trimmedEmail = normalizeEmail(email);
  const trimmedPassword = password.trim();

  if (!trimmedName || !trimmedEmail || !trimmedPassword) {
    return { success: false, error: 'Name, email, and password are required.' };
  }

  const normalizedRoles = normalizeRoleList(roles);
  if (normalizedRoles.length === 0) {
    return { success: false, error: 'Select at least one valid role.' };
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
      role: normalizedRoles[0],
      roles: normalizedRoles,
      loDisclosureSubmissionEnabled: true,
      loQcSubmissionEnabled: true,
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
    const inviteEmail = buildAccountInviteEmail({
      recipientName: trimmedName,
      role,
      inviteUrl,
      baseUrl: getBaseUrl(),
    });
    await sendEmail({
      to: trimmedEmail,
      subject: inviteEmail.subject,
      text: inviteEmail.text,
      html: inviteEmail.html,
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
    const inviteEmail = buildAccountInviteEmail({
      recipientName: existing.name?.trim() || existing.email,
      role: existing.role,
      inviteUrl,
      baseUrl: getBaseUrl(),
    });
    await sendEmail({
      to: existing.email,
      subject: inviteEmail.subject,
      text: inviteEmail.text,
      html: inviteEmail.html,
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
        roles: [invite.role],
        loDisclosureSubmissionEnabled: true,
        loQcSubmissionEnabled: true,
        passwordHash,
        active: true,
      },
      create: {
        email: invite.email,
        name: trimmedName,
        role: invite.role,
        roles: [invite.role],
        loDisclosureSubmissionEnabled: true,
        loQcSubmissionEnabled: true,
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
    const resetEmail = buildPasswordResetEmail({
      recipientName: user.name?.trim() || trimmedEmail,
      resetUrl,
      baseUrl: getBaseUrl(),
    });
    await sendEmail({
      to: trimmedEmail,
      subject: resetEmail.subject,
      text: resetEmail.text,
      html: resetEmail.html,
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

export async function updateUserRoles(userId: string, roles: UserRole[]) {
  const normalizedRoles = normalizeRoleList(roles);
  if (normalizedRoles.length === 0) {
    return { success: false, error: 'Select at least one valid role.' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      role: normalizedRoles[0],
      roles: normalizedRoles,
    },
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

export async function updateUserDeskPermissions(input: {
  userId: string;
  loDisclosureSubmissionEnabled: boolean;
  loQcSubmissionEnabled: boolean;
}) {
  if (!input.userId) {
    return { success: false, error: 'Missing user ID.' };
  }

  await prisma.user.update({
    where: { id: input.userId },
    data: {
      loDisclosureSubmissionEnabled: Boolean(input.loDisclosureSubmissionEnabled),
      loQcSubmissionEnabled: Boolean(input.loQcSubmissionEnabled),
    },
  });

  revalidatePath('/admin/users');
  return { success: true };
}

export async function updateUserName(userId: string, name: string) {
  const trimmedName = name.trim();
  if (!userId) {
    return { success: false, error: 'Missing user ID.' };
  }
  if (!trimmedName) {
    return { success: false, error: 'Name cannot be empty.' };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { name: trimmedName },
  });

  revalidatePath('/admin/users');
  return { success: true };
}

export async function deleteUser(userId: string, currentUserId?: string) {
  try {
    if (!userId) {
      return { success: false, error: 'Missing user ID.' };
    }
    if (currentUserId && userId === currentUserId) {
      return { success: false, error: 'You cannot delete your own account.' };
    }

    const [
      activeLoanCount,
      activeProcessorCount,
      uploadedTaskAttachmentCount,
      uploadedClientDocumentCount,
    ] = await Promise.all([
      prisma.loan.count({
        where: {
          loanOfficerId: userId,
          stage: { not: 'INTAKE' },
        },
      }),
      prisma.loan.count({
        where: {
          processorId: userId,
          stage: { not: 'INTAKE' },
        },
      }),
      prisma.taskAttachment.count({
        where: { uploadedById: userId },
      }),
      prisma.clientDocument.count({
        where: { uploadedById: userId },
      }),
    ]);

    if (activeLoanCount > 0 || activeProcessorCount > 0) {
      return {
        success: false,
        error:
          'User has active loans (in progress). Reassign loans or deactivate the account instead.',
      };
    }
    if (uploadedTaskAttachmentCount > 0 || uploadedClientDocumentCount > 0) {
      return {
        success: false,
        error:
          'User has uploaded documents/attachments in the system. Deactivate this account instead of deleting it.',
      };
    }

    // Delete leads (INTAKE loans) associated with this user before deleting the user.
    await prisma.loan.deleteMany({
      where: {
        loanOfficerId: userId,
        stage: 'INTAKE',
      },
    });

    await prisma.$transaction([
      prisma.task.updateMany({
        where: { assignedUserId: userId },
        data: { assignedUserId: null },
      }),
      prisma.loan.updateMany({
        where: { processorId: userId },
        data: { processorId: null },
      }),
      prisma.loan.updateMany({
        where: { pipelineStage: { userId } },
        data: { pipelineStageId: null },
      }),
      prisma.pipelineStage.deleteMany({ where: { userId } }),
      prisma.pipelineNote.deleteMany({ where: { userId } }),
      prisma.externalUser.deleteMany({ where: { userId } }),
      prisma.leadMailboxLead.deleteMany({ where: { userId } }),
      prisma.inviteToken.deleteMany({ where: { createdById: userId } }),
      prisma.passwordResetToken.deleteMany({ where: { userId } }),
      prisma.auditLog.deleteMany({ where: { userId } }),
      prisma.user.delete({ where: { id: userId } }),
    ]);

    revalidatePath('/admin/users');
    return { success: true };
  } catch (error) {
    console.error('Failed to delete user:', error);
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Failed to delete user.';
    return { success: false, error: message };
  }
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
