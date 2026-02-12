'use client';

import React, { createContext, useContext, useState } from 'react';
import { UserRole } from '@prisma/client';

type ImpersonationContextType = {
  activeRole: UserRole;
  isImpersonating: boolean;
  startImpersonating: (role: UserRole) => void;
  stopImpersonating: () => void;
};

const ImpersonationContext = createContext<ImpersonationContextType | undefined>(undefined);

export function ImpersonationProvider({ children, initialRole }: { children: React.ReactNode, initialRole: UserRole }) {
  const [activeRole, setActiveRole] = useState<UserRole>(initialRole);
  const [originalRole] = useState<UserRole>(initialRole);

  const isImpersonating = activeRole !== originalRole;

  const startImpersonating = (role: UserRole) => {
    setActiveRole(role);
  };

  const stopImpersonating = () => {
    setActiveRole(originalRole);
  };

  return (
    <ImpersonationContext.Provider value={{ activeRole, isImpersonating, startImpersonating, stopImpersonating }}>
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
