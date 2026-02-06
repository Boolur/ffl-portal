'use server';

import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { UserRole } from '@prisma/client';
import { hash } from 'bcryptjs';

const ALLOWED_ROLES = Object.values(UserRole);

const normalizeEmail = (email: string) => email.toLowerCase().trim();

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
