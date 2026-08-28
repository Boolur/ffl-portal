'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

export function OnboardingWelcomeIntro({ caseId }: { caseId: string }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const storageKey = `bisu-onboarding-welcome:${caseId}`;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduceMotion || window.sessionStorage.getItem(storageKey)) {
      const timeout = window.setTimeout(() => setVisible(false), 0);
      return () => window.clearTimeout(timeout);
    }

    window.sessionStorage.setItem(storageKey, 'shown');
    const timeout = window.setTimeout(() => setVisible(false), 1650);
    return () => window.clearTimeout(timeout);
  }, [caseId]);

  if (!visible) return null;

  return (
    <div className="onboarding-welcome-intro" aria-hidden="true">
      <div className="onboarding-welcome-mark">
        <Image
          src="/logo.png"
          alt=""
          width={420}
          height={203}
          className="h-auto w-64 sm:w-96"
          priority
        />
        <p>Welcome to your BISU journey</p>
      </div>
    </div>
  );
}
