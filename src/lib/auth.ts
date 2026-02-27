import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { prisma } from '@/lib/prisma';
import { compare } from 'bcryptjs';

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
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = (user as { role?: string }).role;
        token.id = (user as { id?: string }).id;
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
            select: { role: true, name: true, active: true },
          });
          if (dbUser?.active) {
            session.user.role = dbUser.role;
            session.user.name = dbUser.name || session.user.name;
            token.role = dbUser.role;
          } else {
            session.user.role = token.role as string;
          }
        } else {
          session.user.role = token.role as string;
        }
      }
      return session;
    },
  },
};
