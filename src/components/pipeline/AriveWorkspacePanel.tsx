'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { getSubmissionPilot, linkExistingAriveTestPackage } from '@/app/actions/submissionPilotActions';
import { fetchPilotReview } from '@/lib/pilotReviewLoader';
import { PilotDocumentFile } from './PilotDocumentFile';
import { ArivePackagePanel } from './ArivePilotPanel';
type Data = Extract<Awaited<ReturnType<typeof getSubmissionPilot>>, { success: true }>['data'];
export function AriveWorkspacePanel({ requestTaskId }: { requestTaskId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const reload = useCallback(async () => {
    const r = await fetchPilotReview(requestTaskId);
    if (!r.success) throw new Error(r.error);
    setData(r.data);
  }, [requestTaskId]);
  useEffect(() => { let active = true; void fetchPilotReview(requestTaskId).then(r => { if (!active) return; if (r.success) setData(r.data); else setError(r.error); }).catch(() => { if (active) setError('Unable to load Arive integration.'); }); return () => { active = false; }; }, [requestTaskId]);
  const entry = data?.packages[0];
  return <div className="mt-4 space-y-3"><div className="app-surface-card space-y-3"><h3 className="font-bold">Arive integration · test file</h3><p className="text-sm text-muted-foreground">Use this borrower workspace to link the approved submission, import Arive notes, and transfer approved files.</p>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{!data && !error && <p role="status">Loading Arive connection…</p>}{data && !data.ariveConfigured && <p className="text-sm">Branch credentials have not been connected. A portal Admin III can configure them in <Link href="/admin/arive" className="font-semibold text-primary underline">Arive integration settings</Link>.</p>}{entry && data?.ariveConfigured && !entry.package.ariveLink && <button type="button" className="app-btn-primary" disabled={busy} onClick={async () => { if (lock.current) return; lock.current = true; setBusy(true); setError(''); try { const r = await linkExistingAriveTestPackage(entry.id); if (!r.success) throw new Error(r.error); await reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Unable to link Arive.'); } finally { setBusy(false); lock.current = false; } }}>{busy && <Loader2 size={16} className="animate-spin" />}{busy ? 'Verifying Arive loan…' : 'Link TESTING TESTER in Arive'}</button>}</div>{entry && <section className="app-surface-card space-y-3"><h3 className="font-bold">Submission documents</h3><div className="grid items-start gap-3 md:grid-cols-2">{entry.package.items.filter(item => item.files.length || item.waiver).map(item => <div key={item.id} className="min-w-0 space-y-2 rounded-xl border border-border bg-white p-3"><div className="flex items-start justify-between gap-2"><h4 className="text-sm font-semibold">{item.label}</h4><span className="app-count-badge">{item.review === 'APPROVED' ? 'Approved' : 'Awaiting review'}</span></div>{item.files.map(file => <PilotDocumentFile key={file.id} taskId={entry.id} file={file} />)}{item.waiver && <p className="text-sm text-muted-foreground">Not applicable: {item.waiver}</p>}</div>)}</div></section>}{entry?.package.ariveLink && data && <ArivePackagePanel taskId={entry.id} pkg={entry.package} configured={data.ariveConfigured} parentBusy={busy} onChanged={reload} />}</div>;
}
