'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FlaskConical, Loader2, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { UserRole } from '@prisma/client';
import { getPilotPreferences, setPilotViewEnabled } from '@/app/actions/pilotPreferenceActions';
import { SUBMISSION_PILOT_LO_ID } from '@/lib/submissionPilot';

const adminRoles: UserRole[] = [UserRole.ADMIN_I, UserRole.ADMIN_II, UserRole.ADMIN_III];

/** The client check avoids requests for staff; the server authorizes every read/save. */
export function PilotModeToggle({ activeRole, availableRoles }: { activeRole: UserRole; availableRoles: UserRole[] }) {
  const { data: session, status } = useSession();
  const id = session?.user?.id;
  const candidate = id === SUBMISSION_PILOT_LO_ID || [activeRole, ...availableRoles].some(role => adminRoles.includes(role));
  if (status !== 'authenticated' || !id || !candidate) return null;
  const identity = JSON.stringify([id, activeRole, [...availableRoles].sort()]);
  return <AuthorizedPilotToggle key={identity} />;
}

function AuthorizedPilotToggle() {
  const [preference, setPreference] = useState<{ enabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let current = true;
    void getPilotPreferences().then(result => {
      if (current && result.success && result.data.eligible && result.data.available) {
        setPreference({ enabled: result.data.enabled });
      }
    }).catch(() => { /* Fail closed: no authorized state, no toggle. */ });
    return () => { current = false; mounted.current = false; };
  }, []);

  const toggle = async () => {
    if (busy.current || !preference) return;
    busy.current = true;
    setSaving(true);
    setNotice(null);
    try {
      const result = await setPilotViewEnabled(!preference.enabled);
      if (!mounted.current) return;
      if (!result.success) {
        setNotice({ text: result.error, error: true });
        return;
      }
      setPreference({ enabled: result.data.enabled });
      setNotice({
        text: result.data.enabled
          ? 'Pilot mode is on. These screens still use live records. The facelift and separate practice workspace will be added next.'
          : 'Standard mode is on. Your Pilot preference has been saved.',
        error: false,
      });
    } catch {
      if (mounted.current) setNotice({ text: 'Could not save your mode. Please try again.', error: true });
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  if (!preference) return null;
  return (
    <div className="relative">
      <button
        type="button"
        role="switch"
        aria-label="Pilot mode"
        aria-checked={preference.enabled}
        aria-busy={saving}
        disabled={saving}
        onClick={() => void toggle()}
        title={preference.enabled ? 'Pilot mode is on. Current screens use live records. Click to return to Standard.' : 'Turn on Pilot mode'}
        className={`inline-flex h-9 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-wait disabled:opacity-70 ${preference.enabled ? 'border-primary bg-primary text-primary-foreground shadow-sm' : 'border-border bg-card text-muted-foreground hover:bg-secondary hover:text-foreground'}`}
      >
        {saving ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" /> : <FlaskConical aria-hidden="true" className="h-4 w-4" />}
        <span>Pilot</span>
        <span aria-hidden="true" className={`rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${preference.enabled ? 'bg-white/20' : 'bg-secondary'}`}>{preference.enabled ? 'On' : 'Off'}</span>
      </button>
      {notice && (
        <div className="fixed inset-x-3 top-[4.5rem] z-[120] flex items-start gap-3 rounded-xl border border-border bg-card p-3 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-80">
          <p role={notice.error ? 'alert' : 'status'} className={`min-w-0 flex-1 text-xs leading-relaxed ${notice.error ? 'text-red-600 dark:text-red-400' : 'text-foreground'}`}>{notice.text}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss Pilot message" className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X aria-hidden="true" className="h-4 w-4" /></button>
        </div>
      )}
    </div>
  );
}
