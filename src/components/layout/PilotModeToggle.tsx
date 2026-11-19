'use client';

import React, { useEffect, useRef, useState } from 'react';
import { FlaskConical, Loader2, X } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { UserRole } from '@prisma/client';
import { getPilotPreferences, setPilotViewEnabled } from '@/app/actions/pilotPreferenceActions';
import { isPilotLeadershipRole } from '@/lib/pilotLeadership';
import { resetPortalIdentity } from '@/lib/portalLiveUpdates';
import { hasOpenStandardDraft, pilotModeTransition } from '@/lib/pilotModeTransition';

/** The client check avoids requests for staff; the server authorizes every read/save. */
export function PilotModeToggle({ activeRole, availableRoles }: { activeRole: UserRole; availableRoles: UserRole[] }) {
  const { data: session, status } = useSession();
  const id = session?.user?.id;
  const candidate = isPilotLeadershipRole(activeRole);
  if (status !== 'authenticated' || !id || !candidate) return null;
  const identity = JSON.stringify([id, activeRole, [...availableRoles].sort()]);
  return <AuthorizedPilotToggle key={identity} userId={id} />;
}

function AuthorizedPilotToggle({ userId }: { userId: string }) {
  const channel = useRef<BroadcastChannel | null>(null);
  const [preference, setPreference] = useState<{ enabled: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const busy = useRef(false);
  const mounted = useRef(false);
  const tabMode = useRef<boolean | null>(null);
  const [keepDraft, setKeepDraft] = useState(false);
  const draftDialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    mounted.current = true;
    let current = true;
    void getPilotPreferences().then(result => {
      if (current && result.success && result.data.eligible && result.data.available) {
        tabMode.current = result.data.enabled;
        setPreference({ enabled: result.data.enabled });
      }
    }).catch(() => { /* Fail closed: no authorized state, no toggle. */ });
    return () => { current = false; mounted.current = false; };
  }, []);

  useEffect(() => {
    const updates = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`bisu-pilot-preference:${userId}`);
    channel.current = updates;
    let sequence = 0;
    const recheck = async () => {
      const ticket = ++sequence;
      if (tabMode.current === null || busy.current) return;
      try {
        const current = await getPilotPreferences();
        if (!mounted.current || busy.current || ticket !== sequence) return;
        if (!current.success || !current.data.eligible || !current.data.available) {
          resetPortalIdentity(); window.location.reload(); return;
        }
        const action = pilotModeTransition(tabMode.current, current.data.enabled, hasOpenStandardDraft(document));
        if (action === 'reload') { resetPortalIdentity(); window.location.reload(); }
        else setKeepDraft(action === 'preserve-draft');
      } catch { /* The server still authorizes every request if this check cannot connect. */ }
    };
    if (updates) updates.onmessage = recheck;
    window.addEventListener('focus', recheck);
    return () => { sequence++; channel.current = null; updates?.close(); window.removeEventListener('focus', recheck); };
  }, [userId]);

  useEffect(() => {
    if (keepDraft && !draftDialog.current?.open) draftDialog.current?.showModal();
    if (!keepDraft && draftDialog.current?.open) draftDialog.current.close();
  }, [keepDraft]);

  const toggle = async () => {
    if (busy.current || !preference) return;
    if (!preference.enabled && hasOpenStandardDraft(document)) {
      setNotice({ text: 'Finish or close the open form before switching to Pilot.', error: false });
      return;
    }
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
      resetPortalIdentity();
      channel.current?.postMessage('changed');
      window.location.reload();
    } catch {
      if (mounted.current) setNotice({ text: 'Could not save your mode. Please try again.', error: true });
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  const resumeDraft = async () => {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const result = await setPilotViewEnabled(false);
      if (!mounted.current) return;
      if (!result.success) { setNotice({text: result.error, error: true}); return; }
      tabMode.current = false;
      setPreference({enabled: false});
      channel.current?.postMessage('changed');
      setKeepDraft(false);
    } catch {
      if (mounted.current) setNotice({text: 'Could not restore Standard mode. Your form is still open.', error: true});
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  if (!preference) return null;
  return (
    <div className="relative">
      <dialog ref={draftDialog} onKeyDown={event => event.stopPropagation()} onCancel={event => event.preventDefault()} aria-labelledby="mode-draft-title"
        className="m-auto max-w-md rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl backdrop:bg-slate-950/60">
        <h2 id="mode-draft-title" className="text-lg font-bold">Your Standard form is still open</h2>
        <p className="mt-2 text-sm">Pilot was turned on in another tab. Return to Standard to finish this form, or discard your edits and open Pilot.</p>
        {notice?.error && <p role="alert" className="mt-2 text-sm text-red-600">{notice.text}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className="app-btn-primary" disabled={saving} onClick={() => void resumeDraft()}>Return to Standard</button>
          <button type="button" className="app-btn-secondary" disabled={saving} onClick={() => {resetPortalIdentity(); window.location.reload();}}>Discard and open Pilot</button>
        </div>
      </dialog>
      <button
        type="button"
        role="switch"
        aria-label="Pilot mode"
        aria-checked={preference.enabled}
        aria-busy={saving}
        disabled={saving}
        onClick={() => void toggle()}
        title={preference.enabled ? 'Return to Standard mode' : 'Turn on Pilot mode'}
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
