import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/** Resolve the actor on the server even for legacy actions accepting client filters. */
export async function currentPortalActor() {
  const session = await getServerSession(authOptions);
  const id = session?.user?.id;
  const requestedRole = session?.user?.activeRole || session?.user?.role;
  if (!id || !requestedRole) return null;
  const user = await prisma.user.findUnique({ where: { id }, select: { active: true, role: true, roles: true } });
  const role = user?.active && [user.role, ...user.roles].find((value) => value === requestedRole);
  return role ? { id, role } : null;
}
