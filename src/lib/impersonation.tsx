'use client';

import React, { createContext, useContext, useState } from 'react';
import { UserRole } from '@prisma/client';
import { useSession } from 'next-auth/react';

type ImpersonationContextType = {
  activeRole: UserRole;
  availableRoles: UserRole[];
  setActiveRole: (role: UserRole) => void;
  // Backward-compatible aliases while callers migrate.
  isImpersonating: boolean;
  startImpersonating: (role: UserRole) => void;
  stopImpersonating: () => void;
};

const ImpersonationContext = createContext<ImpersonationContextType | undefined>(undefined);

export function ImpersonationProvider({
  children,
  initialRole,
  availableRoles,
}: {
  children: React.ReactNode;
  initialRole: UserRole;
  availableRoles: UserRole[];
}) {
  const normalizedRoles = availableRoles.length > 0 ? availableRoles : [initialRole];
  const initialActiveRole = normalizedRoles.includes(initialRole) ? initialRole : normalizedRoles[0];
  const [activeRole, setActiveRole] = useState<UserRole>(initialActiveRole);
  const [roles, setRoles] = useState<UserRole[]>(normalizedRoles);
  const { data: session, status } = useSession();

  React.useEffect(() => {
    const nextRoles = availableRoles.length > 0 ? availableRoles : [initialRole];
    setRoles(nextRoles);
    setActiveRole(nextRoles.includes(initialRole) ? initialRole : nextRoles[0]);
  }, [availableRoles, initialRole]);

  // Ensure role context catches up immediately after auth transitions.
  // This prevents a stale LO default from flashing on first load post-login.
  React.useEffect(() => {
    if (status !== 'authenticated') return;
    const sessionRoles = (session?.user?.roles as UserRole[] | undefined) || [];
    const sessionActiveRole =
      (session?.user?.activeRole as UserRole | undefined) ||
      (session?.user?.role as UserRole | undefined);
    const nextRoles = sessionRoles.length > 0
      ? Array.from(new Set(sessionRoles))
      : sessionActiveRole
      ? [sessionActiveRole]
      : [];
    if (nextRoles.length === 0) return;

    setRoles((prev) => {
      if (prev.length === nextRoles.length && prev.every((role, index) => role === nextRoles[index])) {
        return prev;
      }
      return nextRoles;
    });
    setActiveRole((prev) => {
      const nextActiveRole =
        sessionActiveRole && nextRoles.includes(sessionActiveRole)
          ? sessionActiveRole
          : nextRoles[0];
      return prev === nextActiveRole ? prev : nextActiveRole;
    });
  }, [session?.user?.activeRole, session?.user?.role, session?.user?.roles, status]);

  const applyActiveRole = (role: UserRole) => {
    if (!roles.includes(role)) return;
    setActiveRole(role);
  };

  const startImpersonating = (role: UserRole) => {
    applyActiveRole(role);
  };

  const stopImpersonating = () => {
    setActiveRole(initialActiveRole);
  };

  return (
    <ImpersonationContext.Provider
      value={{
        activeRole,
        availableRoles: roles,
        setActiveRole: applyActiveRole,
        isImpersonating: false,
        startImpersonating,
        stopImpersonating,
      }}
    >
      {children}
    </ImpersonationContext.Provider>
  );
}

export function useImpersonation() {
  const context = useContext(ImpersonationContext);
  if (context === undefined) {
    throw new Error('useImpersonation must be used within an ImpersonationProvider');
  }
  return context;
}
