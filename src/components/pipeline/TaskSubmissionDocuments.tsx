'use client';
import { useEffect, useState } from 'react';
import type { getSubmissionPilot } from '@/app/actions/submissionPilotActions';
import { preloadPilotReview, peekPilotReview, invalidatePilotReview } from '@/lib/pilotReviewLoader';
import { PILOT_DOCUMENT_TYPES } from '@/lib/submissionPilot';
import { SubmissionPilot } from './SubmissionPilot';

export function TaskSubmissionDocuments({ taskId, cacheKey, startControl }: { taskId: string; cacheKey: string; startControl?: React.ReactNode }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof getSubmissionPilot>> | null>(() => peekPilotReview(cacheKey));
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void preloadPilotReview(taskId, cacheKey).then(r => { if (active) setResult(r); }).catch(() => { if (active) setResult({ success: false, error: 'Unable to load submission documents.' }); });
    return () => { active = false; };
  }, [taskId, cacheKey, attempt]);
  if (!result) return <section aria-busy="true" className="space-y-4"><h3 className="text-lg font-bold">Document review</h3>{startControl}<p role="status" className="text-sm text-muted-foreground">Loading your document checklist…</p><div className="grid gap-4 xl:grid-cols-2">{PILOT_DOCUMENT_TYPES.map(([id, label]) => <div key={id} className="rounded-2xl border border-border bg-secondary/30 p-4"><h4 className="text-sm font-semibold">{label}</h4><div className="mx-auto my-4 h-40 w-40 animate-pulse rounded-xl bg-secondary motion-reduce:animate-none" /><div className="h-9 rounded-lg bg-secondary" /></div>)}</div></section>;
  if (!result.success) return <div role="alert" className="app-surface-card"><p>{result.error}</p><button type="button" className="app-btn-secondary mt-2" onClick={() => { invalidatePilotReview(taskId); setResult(null); setAttempt(a => a + 1); }}>Retry</button></div>;
  return <SubmissionPilot key={`${cacheKey}:${result.data.owner}:${result.data.packages[0]?.package.state}:${result.data.packages[0]?.package.reviewerId}`} initialData={result.data} initialTask={result.data.packages[0]?.id} requestTaskId={taskId} startControl={startControl} />;
}
