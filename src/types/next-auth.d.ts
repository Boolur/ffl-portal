import { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id?: string;
      role?: string;
      roles?: string[];
      activeRole?: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sessionGeneration?: string;
    id?: string;
    role?: string;
    roles?: string[];
    activeRole?: string;
  }
}
