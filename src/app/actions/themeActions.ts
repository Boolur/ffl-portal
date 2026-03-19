'use server';

import { ThemePreference } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

function normalizeThemePreference(input: string | ThemePreference) {
  const value = String(input || '')
    .trim()
    .toUpperCase();
  if (value === ThemePreference.DARK) return ThemePreference.DARK;
  return ThemePreference.LIGHT;
}

export async function getMyThemePreference() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;
  if (!userId) {
    return { success: false as const, error: 'Not authenticated.' };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { themePreference: true },
  });

  return {
    success: true as const,
    themePreference: user?.themePreference || ThemePreference.LIGHT,
  };
}

export async function setMyThemePreference(input: string | ThemePreference) {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id as string | undefined;
  if (!userId) {
    return { success: false as const, error: 'Not authenticated.' };
  }

  const nextPreference = normalizeThemePreference(input);

  await prisma.user.update({
    where: { id: userId },
    data: { themePreference: nextPreference },
  });

  revalidatePath('/');
  revalidatePath('/tasks');
  revalidatePath('/pipeline');
  revalidatePath('/resources');
  revalidatePath('/reports');

  return { success: true as const, themePreference: nextPreference };
}
