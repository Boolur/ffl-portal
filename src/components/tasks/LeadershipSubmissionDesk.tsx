'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { NewTaskModal } from '../loanOfficer/NewTaskModal';
import { TaskList, type Task } from './TaskList';

export function LeadershipSubmissionDesk({ officers, tasks, role, userId }: {
  officers: { id: string; name: string }[]; tasks: Task[]; role: string; userId: string;
}) {
  const [creating, setCreating] = useState(false);
  const [persona, setPersona] = useState<'JR' | 'LO'>('JR');
  const router = useRouter();
  const visibleTasks = tasks.filter(task => task.kind === (persona === 'JR' ? 'SUBMIT_PROCESSING' : 'LO_NEEDS_INFO'));
  return <section className="mx-auto max-w-6xl space-y-4">
    <Link href="/pipeline" className="text-sm underline">Back to Pipeline</Link>
    <div className="app-surface-card space-y-3 p-5">
      <h1 className="app-page-title">Processing test submissions</h1>
      <p className="text-sm text-muted-foreground">Import a test file’s MISMO and attach its documents. Submitting creates a task in the staff queue and sends the usual notifications.</p>
      <button className="app-btn-primary" onClick={() => setCreating(true)}>Act as LO · Submit a test file</button>
    </div>
    <section className="app-surface-card space-y-3 p-5" aria-label="Shared test tasks">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Select a task role">
        <button type="button" aria-pressed={persona === 'JR'} className={persona === 'JR' ? 'app-btn-primary' : 'app-btn-secondary'} onClick={() => setPersona('JR')}>Act as Jr Processor · Review</button>
        <button type="button" aria-pressed={persona === 'LO'} className={persona === 'LO' ? 'app-btn-primary' : 'app-btn-secondary'} onClick={() => setPersona('LO')}>Act as LO · Respond to corrections</button>
      </div>
      {visibleTasks.length ? <TaskList key={persona} tasks={visibleTasks} currentRole={role} currentUserId={userId} leadershipDesk onDataChanged={() => router.refresh()} />
        : <p className="text-sm text-muted-foreground">{persona === 'JR' ? 'No test submissions are available for review.' : 'There are no test correction tasks to respond to.'}</p>}
    </section>
    <NewTaskModal leadershipTest open={creating} initialType="QC" qcEnabled disclosureEnabled={false}
      isLoanOfficerAssistant loanOfficerOptions={officers} onClose={() => setCreating(false)} onSubmissionSuccess={() => router.refresh()} />
  </section>;
}
