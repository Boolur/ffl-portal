'use client';
import { useEffect, useState } from 'react';
import { getSubmissionPilot } from '@/app/actions/submissionPilotActions';
import { SubmissionPilot } from './SubmissionPilot';

export function TaskSubmissionDocuments({ taskId }: { taskId: string }) {
  const [result, setResult] = useState<Awaited<ReturnType<typeof getSubmissionPilot>> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void getSubmissionPilot(taskId).then(r => { if (active) setResult(r); }).catch(() => { if (active) setResult({ success: false, error: 'Unable to load submission documents.' }); });
    return () => { active = false; };
  }, [taskId, attempt]);
  if (!result) return <p role="status" className="p-4 text-sm text-muted-foreground">Loading submission documents…</p>;
  if (!result.success) return <div role="alert" className="app-surface-card"><p>{result.error}</p><button type="button" className="app-btn-secondary mt-2" onClick={() => { setResult(null); setAttempt(a => a + 1); }}>Retry</button></div>;
  return <SubmissionPilot initialData={result.data} initialTask={result.data.packages[0]?.id} requestTaskId={taskId} />;
}
