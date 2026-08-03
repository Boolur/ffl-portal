import 'server-only';

import { prisma } from '@/lib/prisma';

const DEFAULT_TITLE = 'Mortgage Loan Originator';

export function normalizeWebsiteProfileSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '')
    .slice(0, 70);
}

async function availableSlug(name: string, userId: string) {
  const base = normalizeWebsiteProfileSlug(name) || `loan-officer-${userId.slice(0, 8)}`;
  let candidate = base;
  let suffix = 2;

  while (true) {
    const existing = await prisma.websiteLoanOfficerProfile.findUnique({
      where: { slug: candidate },
      select: { userId: true },
    });
    if (!existing || existing.userId === userId) return candidate;
    candidate = `${base.slice(0, 65)}-${suffix}`;
    suffix += 1;
  }
}

export async function ensureWebsiteLoanOfficerProfileDraft(userId: string, name: string) {
  const existing = await prisma.websiteLoanOfficerProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (existing) return existing;

  const slug = await availableSlug(name, userId);
  return prisma.websiteLoanOfficerProfile.create({
    data: {
      userId,
      slug,
      title: DEFAULT_TITLE,
      languages: ['English'],
    },
    select: { id: true },
  });
}
