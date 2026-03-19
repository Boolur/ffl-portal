import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { compare } from 'bcryptjs';
import { UserRole } from '@prisma/client';

const ALL_ROLES = Object.values(UserRole) as string[];

function normalizeRole(value?: string | null): UserRole | null {
  if (!value) return null;
  const normalized = value.trim().toUpperCase();
  if (!ALL_ROLES.includes(normalized)) return null;
  return normalized as UserRole;
}

function normalizeRoles(values?: string[] | null, fallbackRole?: UserRole | null): UserRole[] {
  const normalized = (values || [])
    .map((value) => normalizeRole(value))
    .filter((value): value is UserRole => Boolean(value));
  const deduped = Array.from(new Set(normalized));
  if (deduped.length > 0) return deduped;
  if (fallbackRole) return [fallbackRole];
  return [UserRole.LOAN_OFFICER];
}

function resolveActiveRole(
  roles: UserRole[],
  preferredRole?: UserRole | null,
  fallbackRole?: UserRole | null
): UserRole {
  if (preferredRole && roles.includes(preferredRole)) return preferredRole;
  if (fallbackRole && roles.includes(fallbackRole)) return fallbackRole;
  return roles[0] || UserRole.LOAN_OFFICER;
}

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        try {
          const email = credentials?.email?.toLowerCase().trim();
          const password = credentials?.password;

          if (!email || !password) return null;

          // Keep auth resilient to unrelated schema drift (e.g. optional profile/theme fields)
          // by selecting only the columns required for credential checks + role session state.
          const user = await prisma.user.findUnique({
            where: { email },
            select: {
              id: true,
              name: true,
              email: true,
              passwordHash: true,
              active: true,
              role: true,
              roles: true,
            },
          });

          if (!user) {
            console.warn('[auth] user not found', { email });
            return null;
          }

          if (!user.active) {
            console.warn('[auth] user inactive', { email });
            return null;
          }

          if (!user.passwordHash) {
            console.warn('[auth] missing password hash', { email });
            return null;
          }

          const isValid = await compare(password, user.passwordHash);
          if (!isValid) {
            console.warn('[auth] password mismatch', { email });
            return null;
          }

          return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            roles: user.roles?.length ? user.roles : [user.role],
            activeRole: user.role,
          };
        } catch (error) {
          console.error('[auth] authorize failed', error);
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      if (user) {
        token.id = (user as { id?: string }).id;
        const fallbackRole = normalizeRole((user as { role?: string }).role);
        const roles = normalizeRoles((user as { roles?: string[] }).roles, fallbackRole);
        const activeRole = resolveActiveRole(
          roles,
          normalizeRole((user as { activeRole?: string }).activeRole),
          fallbackRole
        );
        token.roles = roles;
        token.activeRole = activeRole;
        token.role = activeRole;
      }

      if (trigger === 'update') {
        const tokenRoles = normalizeRoles(
          (token.roles as string[] | undefined) || undefined,
          normalizeRole((token.role as string | undefined) || undefined)
        );
        const requestedActiveRole = normalizeRole(
          (session as { activeRole?: string } | undefined)?.activeRole
        );
        const activeRole = resolveActiveRole(tokenRoles, requestedActiveRole, token.activeRole as UserRole);
        token.roles = tokenRoles;
        token.activeRole = activeRole;
        token.role = activeRole;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;

        const tokenUserId = token.id as string | undefined;
        if (tokenUserId) {
          const dbUser = await prisma.user.findUnique({
            where: { id: tokenUserId },
            select: { role: true, roles: true, name: true, active: true },
          });
          if (dbUser?.active) {
            const roles = normalizeRoles(dbUser.roles, dbUser.role);
            const activeRole = resolveActiveRole(
              roles,
              normalizeRole((token.activeRole as string | undefined) || undefined),
              normalizeRole((token.role as string | undefined) || undefined)
            );
            session.user.roles = roles;
            session.user.activeRole = activeRole;
            session.user.role = activeRole;
            session.user.name = dbUser.name || session.user.name;
            token.roles = roles;
            token.activeRole = activeRole;
            token.role = activeRole;
          } else {
            const roles = normalizeRoles(
              (token.roles as string[] | undefined) || undefined,
              normalizeRole((token.role as string | undefined) || undefined)
            );
            const activeRole = resolveActiveRole(
              roles,
              normalizeRole((token.activeRole as string | undefined) || undefined),
              normalizeRole((token.role as string | undefined) || undefined)
            );
            session.user.roles = roles;
            session.user.activeRole = activeRole;
            session.user.role = activeRole;
          }
        } else {
          const roles = normalizeRoles(
            (token.roles as string[] | undefined) || undefined,
            normalizeRole((token.role as string | undefined) || undefined)
          );
          const activeRole = resolveActiveRole(
            roles,
            normalizeRole((token.activeRole as string | undefined) || undefined),
            normalizeRole((token.role as string | undefined) || undefined)
          );
          session.user.roles = roles;
          session.user.activeRole = activeRole;
          session.user.role = activeRole;
        }
      }
      return session;
    },
  },
};
