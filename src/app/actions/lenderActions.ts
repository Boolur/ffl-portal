'use server';

import { prisma } from '@/lib/prisma';
import { UserRole, type LenderLinkType, type Prisma } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { revalidatePath } from 'next/cache';
import { randomUUID } from 'crypto';
import {
  getLenderLogosBucket,
  getSignedUrlExpirySeconds,
  getSupabaseAdmin,
} from '@/lib/supabaseAdmin';
import { canAccessLendersDirectory } from '@/lib/lendersPilot';

type SessionUser = {
  id: string;
  role: UserRole;
  email: string;
  name: string;
};

type LenderContactInput = {
  id?: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  notes?: string;
  sortOrder?: number;
};

type LenderLinkInput = {
  id?: string;
  label: string;
  url: string;
  linkType?: LenderLinkType;
  sortOrder?: number;
};

export type LenderRecord = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoStoragePath: string | null;
  logoFilename: string | null;
  logoUrl: string | null;
  portalUrl: string | null;
  active: boolean;
  sortOrder: number;
  contacts: Array<{
    id: string;
    name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    notes: string | null;
    sortOrder: number;
  }>;
  links: Array<{
    id: string;
    label: string;
    url: string;
    linkType: LenderLinkType;
    sortOrder: number;
  }>;
};

function toLenderRecord(
  lender: Prisma.LenderGetPayload<{
    include: { contacts: true; links: true };
  }>
): LenderRecord {
  return {
    id: lender.id,
    name: lender.name,
    slug: lender.slug,
    description: lender.description,
    logoStoragePath: lender.logoStoragePath,
    logoFilename: lender.logoFilename,
    logoUrl: lender.logoUrl,
    portalUrl: lender.portalUrl,
    active: lender.active,
    sortOrder: lender.sortOrder,
    contacts: lender.contacts.map((contact) => ({
      id: contact.id,
      name: contact.name,
      title: contact.title,
      email: contact.email,
      phone: contact.phone,
      notes: contact.notes,
      sortOrder: contact.sortOrder,
    })),
    links: lender.links.map((link) => ({
      id: link.id,
      label: link.label,
      url: link.url,
      linkType: link.linkType,
      sortOrder: link.sortOrder,
    })),
  };
}

function sanitizeFilename(filename: string) {
  const trimmed = filename.trim();
  const replaced = trimmed.replace(/[^\w.\-()+\s]/g, '_').replace(/\s+/g, ' ');
  return replaced.length ? replaced : 'file';
}

function toSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 70);
}

function normalizeOptional(value: string | null | undefined) {
  const trimmed = String(value || '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeUrl(value: string | null | undefined) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeEmail(value: string | null | undefined) {
  const trimmed = String(value || '').trim().toLowerCase();
  if (!trimmed) return null;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(trimmed) ? trimmed : null;
}

function normalizeLenderContacts(contacts: LenderContactInput[]) {
  return contacts
    .map((contact, index) => {
      const name = String(contact.name || '').trim();
      if (!name) return null;
      return {
        name,
        title: normalizeOptional(contact.title),
        email: normalizeEmail(contact.email),
        phone: normalizeOptional(contact.phone),
        notes: normalizeOptional(contact.notes),
        sortOrder: Number.isFinite(contact.sortOrder) ? Number(contact.sortOrder) : index,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

function normalizeLenderLinks(links: LenderLinkInput[]) {
  return links
    .map((link, index) => {
      const label = String(link.label || '').trim();
      const url = normalizeUrl(link.url);
      if (!label || !url) return null;
      return {
        label,
        url,
        linkType: link.linkType || 'PORTAL',
        sortOrder: Number.isFinite(link.sortOrder) ? Number(link.sortOrder) : index,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
}

async function getSessionUser(): Promise<SessionUser | null> {
  const session = await getServerSession(authOptions);
  const role = (session?.user?.activeRole || session?.user?.role) as UserRole | undefined;
  const id = session?.user?.id;
  if (!id || !role) return null;
  return {
    id,
    role,
    email: String(session?.user?.email || ''),
    name: String(session?.user?.name || ''),
  };
}

function canManageLenders(role: UserRole) {
  return role === UserRole.ADMIN;
}

function canViewLenders(user: SessionUser) {
  return canManageLenders(user.role) || canAccessLendersDirectory(user);
}

async function ensureUniqueSlug(baseName: string, lenderIdToIgnore?: string) {
  const baseSlug = toSlug(baseName) || `lender-${randomUUID().slice(0, 6)}`;
  let slug = baseSlug;
  let attempt = 1;

  // Keep trying suffixes until the slug is unique.
  // Usually this exits on first attempt.
  while (true) {
    const existing = await prisma.lender.findFirst({
      where: {
        slug,
        ...(lenderIdToIgnore ? { id: { not: lenderIdToIgnore } } : {}),
      },
      select: { id: true },
    });
    if (!existing) return slug;
    attempt += 1;
    slug = `${baseSlug}-${attempt}`;
  }
}

function lenderInclude() {
  return {
    contacts: {
      orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    },
    links: {
      orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    },
  };
}

function revalidateLenderRoutes() {
  revalidatePath('/lenders');
  revalidatePath('/admin/lenders');
}

export async function listLendersForDirectory(): Promise<{
  success: boolean;
  error?: string;
  lenders?: LenderRecord[];
}> {
  try {
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    if (!canViewLenders(user)) return { success: false, error: 'Not authorized.' };

    const lenders = await prisma.lender.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: lenderInclude(),
    });

    return { success: true, lenders: lenders.map(toLenderRecord) };
  } catch (error) {
    console.error('Failed to list lenders for directory:', error);
    return { success: false, error: 'Failed to load lenders.' };
  }
}

export async function listLendersForAdmin(): Promise<{
  success: boolean;
  error?: string;
  lenders?: LenderRecord[];
}> {
  try {
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    if (!canManageLenders(user.role)) return { success: false, error: 'Not authorized.' };

    const lenders = await prisma.lender.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: lenderInclude(),
    });
    return { success: true, lenders: lenders.map(toLenderRecord) };
  } catch (error) {
    console.error('Failed to list lenders for admin:', error);
    return { success: false, error: 'Failed to load lenders.' };
  }
}

export async function createLender(input: {
  name: string;
  description?: string;
  portalUrl?: string;
  active?: boolean;
  sortOrder?: number;
  contacts?: LenderContactInput[];
  links?: LenderLinkInput[];
}) {
  try {
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    if (!canManageLenders(user.role)) return { success: false, error: 'Not authorized.' };

    const name = String(input.name || '').trim();
    if (!name) return { success: false, error: 'Lender name is required.' };
    if (name.length > 120) return { success: false, error: 'Lender name is too long.' };

    const contacts = normalizeLenderContacts(input.contacts || []);
    const links = normalizeLenderLinks(input.links || []);
    const slug = await ensureUniqueSlug(name);

    const lender = await prisma.lender.create({
      data: {
        name,
        slug,
        description: normalizeOptional(input.description),
        portalUrl: normalizeUrl(input.portalUrl),
        active: input.active ?? true,
        sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
        contacts: contacts.length > 0 ? { createMany: { data: contacts } } : undefined,
        links: links.length > 0 ? { createMany: { data: links } } : undefined,
      },
      include: lenderInclude(),
    });

    revalidateLenderRoutes();
    return { success: true, lender: toLenderRecord(lender) };
  } catch (error) {
    console.error('Failed to create lender:', error);
    return { success: false, error: 'Failed to create lender.' };
  }
}

export async function updateLender(input: {
  lenderId: string;
  name: string;
  description?: string;
  portalUrl?: string;
  active?: boolean;
  sortOrder?: number;
  contacts?: LenderContactInput[];
  links?: LenderLinkInput[];
}) {
  try {
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    if (!canManageLenders(user.role)) return { success: false, error: 'Not authorized.' };

    const lenderId = String(input.lenderId || '').trim();
    const name = String(input.name || '').trim();
    if (!lenderId) return { success: false, error: 'Lender ID is required.' };
    if (!name) return { success: false, error: 'Lender name is required.' };

    const existing = await prisma.lender.findUnique({
      where: { id: lenderId },
      select: { id: true, name: true },
    });
    if (!existing) return { success: false, error: 'Lender not found.' };

    const contacts = normalizeLenderContacts(input.contacts || []);
    const links = normalizeLenderLinks(input.links || []);
    const slug =
      existing.name.trim().toLowerCase() === name.trim().toLowerCase()
        ? undefined
        : await ensureUniqueSlug(name, lenderId);

    await prisma.$transaction(async (tx) => {
      await tx.lender.update({
        where: { id: lenderId },
        data: {
          name,
          ...(slug ? { slug } : {}),
          description: normalizeOptional(input.description),
          portalUrl: normalizeUrl(input.portalUrl),
          active: input.active ?? true,
          sortOrder: Number.isFinite(input.sortOrder) ? Number(input.sortOrder) : 0,
        },
      });

      await tx.lenderContact.deleteMany({ where: { lenderId } });
      if (contacts.length > 0) {
        await tx.lenderContact.createMany({
          data: contacts.map((contact) => ({ lenderId, ...contact })),
        });
      }

      await tx.lenderLink.deleteMany({ where: { lenderId } });
      if (links.length > 0) {
        await tx.lenderLink.createMany({
          data: links.map((link) => ({ lenderId, ...link })),
        });
      }
    });

    const lender = await prisma.lender.findUnique({
      where: { id: lenderId },
      include: lenderInclude(),
    });
    if (!lender) return { success: false, error: 'Lender not found after update.' };

    revalidateLenderRoutes();
    return { success: true, lender: toLenderRecord(lender) };
  } catch (error) {
    console.error('Failed to update lender:', error);
    return { success: false, error: 'Failed to update lender.' };
  }
}

export async function deleteLender(lenderId: string) {
  try {
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    if (!canManageLenders(user.role)) return { success: false, error: 'Not authorized.' };

    const normalizedId = String(lenderId || '').trim();
    if (!normalizedId) return { success: false, error: 'Lender ID is required.' };

    const lender = await prisma.lender.findUnique({
      where: { id: normalizedId },
      select: { id: true, logoStoragePath: true },
    });
    if (!lender) return { success: false, error: 'Lender not found.' };

    if (lender.logoStoragePath) {
      const supabase = getSupabaseAdmin();
      const bucket = getLenderLogosBucket();
      const { error } = await supabase.storage.from(bucket).remove([lender.logoStoragePath]);
      if (error) {
        console.error('[lenders] remove logo failed during delete:', error);
      }
    }

    await prisma.lender.delete({ where: { id: normalizedId } });
    revalidateLenderRoutes();
    return { success: true };
  } catch (error) {
    console.error('Failed to delete lender:', error);
    return { success: false, error: 'Failed to delete lender.' };
  }
}

export async function createLenderLogoUploadUrl(input: {
  lenderId: string;
  filename: string;
}) {
  try {
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    if (!canManageLenders(user.role)) return { success: false, error: 'Not authorized.' };

    const lenderId = String(input.lenderId || '').trim();
    if (!lenderId) return { success: false, error: 'Lender ID is required.' };
    const lender = await prisma.lender.findUnique({
      where: { id: lenderId },
      select: { id: true },
    });
    if (!lender) return { success: false, error: 'Lender not found.' };

    const safeName = sanitizeFilename(input.filename);
    const storagePath = `lenders/${lenderId}/${randomUUID()}-${safeName}`;
    const supabase = getSupabaseAdmin();
    const bucket = getLenderLogosBucket();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUploadUrl(storagePath);
    if (error || !data) {
      console.error('[lenders] createSignedUploadUrl failed', error);
      return {
        success: false,
        error: error?.message
          ? `Failed to create upload URL: ${error.message}`
          : 'Failed to create upload URL.',
      };
    }

    return {
      success: true,
      signedUrl: data.signedUrl,
      path: data.path,
      token: data.token,
    };
  } catch (error) {
    console.error('Failed to create lender logo upload URL:', error);
    return { success: false, error: 'Failed to create upload URL.' };
  }
}

export async function finalizeLenderLogoUpload(input: {
  lenderId: string;
  storagePath: string;
  filename: string;
}) {
  try {
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    if (!canManageLenders(user.role)) return { success: false, error: 'Not authorized.' };

    const lenderId = String(input.lenderId || '').trim();
    const storagePath = String(input.storagePath || '').trim();
    const filename = String(input.filename || '').trim();
    if (!lenderId || !storagePath || !filename) {
      return { success: false, error: 'Lender ID, path, and filename are required.' };
    }

    const lender = await prisma.lender.findUnique({
      where: { id: lenderId },
      select: { id: true, logoStoragePath: true },
    });
    if (!lender) return { success: false, error: 'Lender not found.' };

    const supabase = getSupabaseAdmin();
    const bucket = getLenderLogosBucket();
    const publicUrlData = supabase.storage.from(bucket).getPublicUrl(storagePath);
    const logoUrl = normalizeOptional(publicUrlData?.data?.publicUrl) || null;

    if (lender.logoStoragePath && lender.logoStoragePath !== storagePath) {
      const { error: removeError } = await supabase.storage
        .from(bucket)
        .remove([lender.logoStoragePath]);
      if (removeError) {
        console.error('[lenders] remove old logo failed', removeError);
      }
    }

    await prisma.lender.update({
      where: { id: lenderId },
      data: {
        logoStoragePath: storagePath,
        logoFilename: filename,
        logoUrl,
      },
    });

    revalidateLenderRoutes();
    return { success: true, logoUrl };
  } catch (error) {
    console.error('Failed to finalize lender logo upload:', error);
    return { success: false, error: 'Failed to save logo.' };
  }
}

export async function removeLenderLogo(lenderId: string) {
  try {
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    if (!canManageLenders(user.role)) return { success: false, error: 'Not authorized.' };

    const normalizedId = String(lenderId || '').trim();
    if (!normalizedId) return { success: false, error: 'Lender ID is required.' };

    const lender = await prisma.lender.findUnique({
      where: { id: normalizedId },
      select: { id: true, logoStoragePath: true },
    });
    if (!lender) return { success: false, error: 'Lender not found.' };

    if (lender.logoStoragePath) {
      const supabase = getSupabaseAdmin();
      const bucket = getLenderLogosBucket();
      const { error } = await supabase.storage.from(bucket).remove([lender.logoStoragePath]);
      if (error) {
        console.error('[lenders] remove logo failed', error);
      }
    }

    await prisma.lender.update({
      where: { id: normalizedId },
      data: {
        logoStoragePath: null,
        logoFilename: null,
        logoUrl: null,
      },
    });

    revalidateLenderRoutes();
    return { success: true };
  } catch (error) {
    console.error('Failed to remove lender logo:', error);
    return { success: false, error: 'Failed to remove logo.' };
  }
}

export async function getLenderLogoDownloadUrl(lenderId: string) {
  try {
    const user = await getSessionUser();
    if (!user) return { success: false, error: 'Not authenticated.' };
    if (!canViewLenders(user)) return { success: false, error: 'Not authorized.' };

    const lender = await prisma.lender.findUnique({
      where: { id: lenderId },
      select: { logoStoragePath: true, logoUrl: true },
    });
    if (!lender) return { success: false, error: 'Lender not found.' };
    if (lender.logoUrl) return { success: true, url: lender.logoUrl };
    if (!lender.logoStoragePath) return { success: false, error: 'No logo found.' };

    const supabase = getSupabaseAdmin();
    const bucket = getLenderLogosBucket();
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(lender.logoStoragePath, getSignedUrlExpirySeconds());
    if (error || !data) {
      console.error('[lenders] createSignedUrl failed', error);
      return { success: false, error: 'Failed to create logo URL.' };
    }
    return { success: true, url: data.signedUrl };
  } catch (error) {
    console.error('Failed to get lender logo URL:', error);
    return { success: false, error: 'Failed to get logo URL.' };
  }
}
