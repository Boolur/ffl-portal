'use client';

import React, { createContext, useContext, useState } from 'react';
import { UserRole } from '@prisma/client';

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

  React.useEffect(() => {
    const nextRoles = availableRoles.length > 0 ? availableRoles : [initialRole];
    setRoles(nextRoles);
    setActiveRole(nextRoles.includes(initialRole) ? initialRole : nextRoles[0]);
  }, [availableRoles, initialRole]);

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
