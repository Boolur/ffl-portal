'use server';

import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { revalidatePath } from 'next/cache';
import { authOptions } from '@/lib/auth';
import { canAccessUserManagement, canManageUser } from '@/lib/adminTiers';
import { prisma } from '@/lib/prisma';
import { normalizeWebsiteProfileSlug } from '@/lib/websiteLoanOfficerProfiles';
import {
  isValidExternalHttpUrl,
  isValidWebsitePhotoUrl,
  requiresNmlsForWebsiteTitle,
} from '@/lib/websiteProfileValidation';

export type WebsiteLoanOfficerProfileInput = {
  slug: string;
  title: string;
  nmls?: string | null;
  photoUrl?: string | null;
  phone?: string | null;
  bookingUrl?: string | null;
  licensedStates: string[];
  specialties: string[];
  languages: string[];
  bio: string;
  yearsExperience?: number | null;
  loansClosed?: string | null;
  city?: string | null;
  featured: boolean;
};

function cleanOptional(value: string | null | undefined) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function cleanList(values: string[]) {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

function cleanStates(values: string[]) {
  return cleanList(values).map((value) => value.toUpperCase());
}

async function getActor() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  const primaryRole = session?.user?.role as UserRole | undefined;
  const sessionRoles = session?.user?.roles as UserRole[] | undefined;
  const roles = sessionRoles?.length ? sessionRoles : primaryRole ? [primaryRole] : [];
  if (!userId || !canAccessUserManagement(roles)) return null;
  return { userId, roles };
}

async function authorizeProfileTarget(userId: string) {
  const actor = await getActor();
  if (!actor) return { ok: false as const, error: 'Not authorized.' };
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, roles: true },
  });
  if (!user) return { ok: false as const, error: 'Loan officer not found.' };
  const targetRoles = Array.from(new Set([user.role, ...user.roles]));
  if (!canManageUser(actor.roles, targetRoles)) {
    return { ok: false as const, error: 'You cannot manage this user.' };
  }
  if (!targetRoles.includes(UserRole.LOAN_OFFICER)) {
    return { ok: false as const, error: 'Website profiles are only available to loan officers.' };
  }
  return { ok: true as const };
}

function revalidateProfileRoutes() {
  revalidatePath('/admin/users');
  revalidatePath('/admin/users/website-profiles');
}

export async function listWebsiteLoanOfficerProfiles() {
  const actor = await getActor();
  if (!actor) return [];

  return prisma.user.findMany({
    where: {
      active: true,
      OR: [{ role: UserRole.LOAN_OFFICER }, { roles: { has: UserRole.LOAN_OFFICER } }],
    },
    select: {
      id: true,
      name: true,
      email: true,
      active: true,
      role: true,
      roles: true,
      websiteLoanOfficerProfile: true,
    },
    orderBy: { name: 'asc' },
  });
}

export async function updateWebsiteLoanOfficerProfile(
  userId: string,
  input: WebsiteLoanOfficerProfileInput,
) {
  const authorization = await authorizeProfileTarget(userId);
  if (!authorization.ok) return { success: false as const, error: authorization.error };

  const slug = normalizeWebsiteProfileSlug(input.slug);
  const title = input.title.trim();
  const bio = input.bio.trim();
  const photoUrl = cleanOptional(input.photoUrl);
  const bookingUrl = cleanOptional(input.bookingUrl);
  if (!slug || !title) {
    return { success: false as const, error: 'Slug and title are required.' };
  }
  if (!isValidWebsitePhotoUrl(photoUrl)) {
    return {
      success: false as const,
      error: 'Photo must use http, https, or a site path beginning with "/".',
    };
  }
  if (!isValidExternalHttpUrl(bookingUrl)) {
    return { success: false as const, error: 'Booking links must use http or https.' };
  }

  try {
    await prisma.websiteLoanOfficerProfile.upsert({
      where: { userId },
      update: {
        slug,
        title,
        nmls: cleanOptional(input.nmls),
        photoUrl,
        phone: cleanOptional(input.phone),
        bookingUrl,
        licensedStates: cleanStates(input.licensedStates),
        specialties: cleanList(input.specialties),
        languages: cleanList(input.languages),
        bio,
        yearsExperience:
          typeof input.yearsExperience === 'number' && input.yearsExperience >= 0
            ? Math.floor(input.yearsExperience)
            : null,
        loansClosed: cleanOptional(input.loansClosed),
        city: cleanOptional(input.city),
        featured: Boolean(input.featured),
      },
      create: {
        userId,
        slug,
        title,
        nmls: cleanOptional(input.nmls),
        photoUrl,
        phone: cleanOptional(input.phone),
        bookingUrl,
        licensedStates: cleanStates(input.licensedStates),
        specialties: cleanList(input.specialties),
        languages: cleanList(input.languages),
        bio,
        yearsExperience:
          typeof input.yearsExperience === 'number' && input.yearsExperience >= 0
            ? Math.floor(input.yearsExperience)
            : null,
        loansClosed: cleanOptional(input.loansClosed),
        city: cleanOptional(input.city),
        featured: Boolean(input.featured),
      },
    });
    revalidateProfileRoutes();
    return { success: true as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('Unique constraint') && message.includes('slug')) {
      return { success: false as const, error: 'That website slug is already in use.' };
    }
    console.error('[website-profile] update failed', error);
    return { success: false as const, error: 'Failed to save the website profile.' };
  }
}

export async function setWebsiteLoanOfficerProfilePublished(
  userId: string,
  published: boolean,
) {
  const authorization = await authorizeProfileTarget(userId);
  if (!authorization.ok) return { success: false as const, error: authorization.error };

  const record = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      active: true,
      name: true,
      email: true,
      websiteLoanOfficerProfile: true,
    },
  });
  if (!record?.websiteLoanOfficerProfile) {
    return { success: false as const, error: 'Save the draft profile before publishing.' };
  }

  if (published) {
    const profile = record.websiteLoanOfficerProfile;
    const requiresNmls = requiresNmlsForWebsiteTitle(profile.title);
    const missing = [
      !record.active && 'active portal account',
      !record.name.trim() && 'name',
      !record.email.trim() && 'email',
      !profile.slug.trim() && 'slug',
      !profile.title.trim() && 'title',
      requiresNmls && !profile.nmls?.trim() && 'NMLS',
      !profile.phone?.trim() && 'phone',
      !profile.bio.trim() && 'bio',
      profile.licensedStates.length === 0 && 'licensed states',
    ].filter(Boolean);
    if (missing.length > 0) {
      return {
        success: false as const,
        error: `Complete these fields before publishing: ${missing.join(', ')}.`,
      };
    }
  }

  await prisma.websiteLoanOfficerProfile.update({
    where: { userId },
    data: { publishedAt: published ? new Date() : null },
  });
  revalidateProfileRoutes();
  return { success: true as const };
}
