'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { isOnboardingEnabled } from '@/lib/onboardingFeature';

const items = [
  { href: '/admin/users', label: 'People' },
  { href: '/admin/users/onboarding', label: 'Onboarding' },
  { href: '/admin/users?view=invites', label: 'Pending Invites' },
  { href: '/admin/users/website-profiles', label: 'Website Profiles' },
  { href: '/admin/users/sign-in-activity', label: 'Sign-in Activity' },
];

export function UserManagementNav({
  showSignInActivity = false,
}: {
  showSignInActivity?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <nav aria-label="User Management sections" className="mb-6 flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
      {items.filter((item) => {
        if (item.label === 'Onboarding') return isOnboardingEnabled();
        if (item.label === 'Sign-in Activity') return showSignInActivity;
        return true;
      }).map((item) => {
        const active =
          item.href === '/admin/users'
            ? pathname === '/admin/users' && searchParams.get('view') !== 'invites'
            : item.href.includes('view=invites')
              ? pathname === '/admin/users' && searchParams.get('view') === 'invites'
            : pathname === item.href.split('?')[0];
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium transition ${
              active ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
