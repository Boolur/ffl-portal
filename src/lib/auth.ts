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
        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;

        if (!email || !password) return null;

        const user = await prisma.user.findUnique({
          where: { email },
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
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // Throttled DB re-sync. Previously the `session` callback ran
      // `prisma.user.findUnique` on EVERY request (every
      // getServerSession call — which every server action does as its
      // first line). At 30+ users × 20s dashboard polling, that alone
      // saturated the Supabase pooler and manifested as "sign in spins
      // for a minute" + "saving attachment timed out". Now we cache
      // role/name/active in the JWT and only re-read once every
      // SESSION_DB_REFRESH_MS so admin role changes / deactivations
      // still propagate without forcing a sign-out.
      //
      // NB: JWT-callback mutations persist back to the signed cookie;
      // session-callback mutations do not. That's why the throttle
      // lives here, not in session().
      const SESSION_DB_REFRESH_MS = 5 * 60 * 1000;
      const tokenWithMeta = token as typeof token & {
        id?: string;
        dbSyncedAt?: number;
      };

      if (user) {
        tokenWithMeta.id = (user as { id?: string }).id;
        const fallbackRole = normalizeRole((user as { role?: string }).role);
        const roles = normalizeRoles((user as { roles?: string[] }).roles, fallbackRole);
        const activeRole = resolveActiveRole(
          roles,
          normalizeRole((user as { activeRole?: string }).activeRole),
          fallbackRole
        );
        tokenWithMeta.roles = roles;
        tokenWithMeta.activeRole = activeRole;
        tokenWithMeta.role = activeRole;
        // Just-signed-in user: authorize() already read the row, so
        // treat this as a fresh sync and skip the immediate re-read.
        tokenWithMeta.dbSyncedAt = Date.now();
      }

      if (trigger === 'update') {
        const tokenRoles = normalizeRoles(
          (tokenWithMeta.roles as string[] | undefined) || undefined,
          normalizeRole((tokenWithMeta.role as string | undefined) || undefined)
        );
        const requestedActiveRole = normalizeRole(
          (session as { activeRole?: string } | undefined)?.activeRole
        );
        const activeRole = resolveActiveRole(
          tokenRoles,
          requestedActiveRole,
          tokenWithMeta.activeRole as UserRole
        );
        tokenWithMeta.roles = tokenRoles;
        tokenWithMeta.activeRole = activeRole;
        tokenWithMeta.role = activeRole;
        // Force a fresh DB read on the next pass — admins flipping a
        // user's role/status from the admin UI trigger an update, and
        // we want that to reflect immediately.
        tokenWithMeta.dbSyncedAt = 0;
      }

      const needsDbSync =
        tokenWithMeta.id &&
        (!tokenWithMeta.dbSyncedAt ||
          Date.now() - tokenWithMeta.dbSyncedAt > SESSION_DB_REFRESH_MS);

      if (needsDbSync && tokenWithMeta.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: tokenWithMeta.id },
            select: { role: true, roles: true, name: true, active: true },
          });
          if (dbUser?.active) {
            const roles = normalizeRoles(dbUser.roles, dbUser.role);
            const activeRole = resolveActiveRole(
              roles,
              normalizeRole(
                (tokenWithMeta.activeRole as string | undefined) || undefined
              ),
              normalizeRole(
                (tokenWithMeta.role as string | undefined) || undefined
              )
            );
            tokenWithMeta.roles = roles;
            tokenWithMeta.activeRole = activeRole;
            tokenWithMeta.role = activeRole;
            tokenWithMeta.name = dbUser.name || tokenWithMeta.name;
            tokenWithMeta.dbSyncedAt = Date.now();
          } else if (dbUser && !dbUser.active) {
            // Deactivated accounts get an empty-roles token so downstream
            // guards fail closed instead of trusting stale JWT state.
            tokenWithMeta.roles = [];
            tokenWithMeta.activeRole = undefined;
            tokenWithMeta.role = undefined;
            tokenWithMeta.dbSyncedAt = Date.now();
          }
          // User row missing: leave token as-is; not our job to sign
          // them out from this layer, and failing closed on a transient
          // null could lock the whole company out.
        } catch (err) {
          // Transient pool timeout or network hiccup — keep serving
          // the slightly-stale JWT rather than 500-ing the app.
          // dbSyncedAt stays unchanged so we retry next request.
          console.warn('[auth] jwt db refresh failed, using cached token', err);
        }
      }

      return tokenWithMeta;
    },
    async session({ session, token }) {
      if (!session.user) return session;

      session.user.id = token.id as string;

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
      if (typeof token.name === 'string' && token.name) {
        session.user.name = token.name;
      }
      return session;
    },
  },
};
