import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { toBisuPublicEmail } from '@/lib/websitePublicContact';

/**
 * Versioned, key-protected source of truth for published BISU website
 * loan-officer profiles.
 */
function isAuthorized(request: Request) {
  const expected =
    process.env.BISU_ROSTER_API_KEY?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    '';
  if (!expected) return false;
  const key = request.headers.get('x-api-key')?.trim() || '';
  return key === expected;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const profiles = await prisma.websiteLoanOfficerProfile.findMany({
    where: {
      publishedAt: { not: null },
      user: {
        active: true,
        OR: [{ role: 'LOAN_OFFICER' }, { roles: { has: 'LOAN_OFFICER' } }],
      },
    },
    select: {
      slug: true,
      title: true,
      nmls: true,
      photoUrl: true,
      phone: true,
      bookingUrl: true,
      licensedStates: true,
      specialties: true,
      languages: true,
      bio: true,
      yearsExperience: true,
      loansClosed: true,
      city: true,
      featured: true,
      updatedAt: true,
      user: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: [{ featured: 'desc' }, { user: { name: 'asc' } }],
  });

  return NextResponse.json(
    {
      version: 1,
      officers: profiles.map(({ user, ...profile }) => ({
        id: user.id,
        name: user.name,
        email: toBisuPublicEmail(user.email),
        slug: profile.slug,
        title: profile.title,
        nmls: profile.nmls ?? undefined,
        photoUrl: profile.photoUrl ?? undefined,
        phone: profile.phone ?? undefined,
        bookingUrl: profile.bookingUrl ?? undefined,
        licensedStates: profile.licensedStates,
        specialties: profile.specialties,
        languages: profile.languages,
        bio: profile.bio,
        yearsExperience: profile.yearsExperience ?? undefined,
        loansClosed: profile.loansClosed ?? undefined,
        city: profile.city ?? undefined,
        featured: profile.featured,
        updatedAt: profile.updatedAt,
      })),
    },
    { headers: { 'Cache-Control': 'private, max-age=300' } }
  );
}
