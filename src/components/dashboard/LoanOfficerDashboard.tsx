import React, { useState } from 'react';
import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import { NewTaskModal } from '@/components/loanOfficer/NewTaskModal';
import { TaskKind, TaskStatus } from '@prisma/client';

type Loan = {
  id: string;
  loanNumber: string;
  borrowerName: string;
  amount: number; // or Decimal
  stage: string;
  updatedAt: Date;
};

type LoanOfficerDashboardProps = {
  loans?: Loan[];
  submissions?: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    kind: TaskKind | null;
    createdAt: Date;
    loan: {
      loanNumber: string;
      borrowerName: string;
      loanOfficer?: { name: string };
    };
  }>;
  loanOfficerName?: string;
  disclosureEnabled?: boolean;
  qcEnabled?: boolean;
};

export function LoanOfficerDashboard({
  submissions = [],
  loanOfficerName,
  disclosureEnabled = true,
  qcEnabled = false,
}: LoanOfficerDashboardProps) {
  const [showNewTask, setShowNewTask] = useState(false);
  const [initialTaskType, setInitialTaskType] = useState<'DISCLOSURES' | 'QC'>('DISCLOSURES');
  const scopedSubmissions = loanOfficerName
    ? submissions.filter((t) => t.loan.loanOfficer?.name === loanOfficerName)
    : submissions;
  // Keep dashboard counts aligned with LO request queues (not child workflow tasks).
  const requestSubmissions = scopedSubmissions.filter(
    (t) => t.kind === TaskKind.SUBMIT_DISCLOSURES || t.kind === TaskKind.SUBMIT_QC
  );
  const pendingCount = requestSubmissions.filter((t) => t.status === TaskStatus.PENDING).length;
  const inProgressCount = requestSubmissions.filter((t) => t.status === TaskStatus.IN_PROGRESS).length;
  const completedCount = requestSubmissions.filter((t) => t.status === TaskStatus.COMPLETED).length;

  const openTaskModal = (type: 'DISCLOSURES' | 'QC') => {
    setInitialTaskType(type);
    setShowNewTask(true);
  };

  return (
    <div className="space-y-8">
      {/* Primary Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button
          type="button"
          onClick={() => {
            if (!disclosureEnabled) return;
            openTaskModal('DISCLOSURES');
          }}
          disabled={!disclosureEnabled}
          title={
            disclosureEnabled
              ? 'Submit for Disclosures'
              : 'Submit for Disclosures is disabled for this user by Admin.'
          }
          className={`group relative flex flex-col items-start p-8 rounded-2xl border shadow-sm text-left overflow-hidden ${
            disclosureEnabled
              ? 'border-blue-200/70 bg-card hover:shadow-md hover:border-blue-300 transition-all'
              : 'border-border bg-secondary/70 cursor-not-allowed'
          }`}
        >
          <div className={`absolute top-0 right-0 p-8 ${disclosureEnabled ? 'opacity-20 group-hover:opacity-35 transition-opacity' : 'opacity-10'}`}>
            <ClipboardCheck className={`w-32 h-32 ${disclosureEnabled ? 'text-blue-600 dark:text-blue-400' : 'text-slate-500'}`} />
          </div>
          <div className={`w-14 h-14 rounded-xl flex items-center justify-center mb-6 shadow-sm ${
            disclosureEnabled ? 'bg-blue-600 text-white group-hover:scale-105 transition-transform' : 'bg-secondary text-muted-foreground'
          }`}>
            <ClipboardCheck className="w-7 h-7" />
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className={`text-2xl font-bold ${disclosureEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>
              Submit for Disclosures
            </h3>
            <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {disclosureEnabled ? 'Active' : 'Disabled'}
            </span>
          </div>
          <p className="text-muted-foreground mb-8 max-w-sm">
            Send loan information and initial documents to the Disclosure Team for processing.
          </p>
          <div className={`mt-auto w-full inline-flex items-center justify-center px-6 py-3 rounded-xl font-semibold ${
            disclosureEnabled
              ? 'bg-blue-50 text-blue-700 group-hover:bg-blue-600 group-hover:text-white dark:bg-blue-700 dark:text-white dark:hover:bg-blue-600 transition-colors'
              : 'bg-secondary text-muted-foreground'
          }`}>
            {disclosureEnabled ? 'Start Request' : 'Disabled by Admin'}
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            if (!qcEnabled) return;
            openTaskModal('QC');
          }}
          disabled={!qcEnabled}
          title={qcEnabled ? 'Submit for QC' : 'Submit for QC is disabled for this user by Admin.'}
          className={`group relative flex flex-col items-start p-8 rounded-2xl border shadow-sm text-left overflow-hidden ${
            qcEnabled
              ? 'border-violet-200/70 bg-card hover:shadow-md hover:border-violet-300 transition-all'
              : 'border-border bg-secondary/70 cursor-not-allowed'
          }`}
        >
          <div className={`absolute top-0 right-0 p-8 ${qcEnabled ? 'opacity-22 group-hover:opacity-35 transition-opacity' : 'opacity-10'}`}>
            <ShieldCheck className={`w-32 h-32 ${qcEnabled ? 'text-violet-600 dark:text-violet-400' : 'text-slate-500'}`} />
          </div>
          <div
            className={`w-14 h-14 rounded-xl flex items-center justify-center mb-6 shadow-sm ${
              qcEnabled ? 'bg-violet-600 text-white' : 'bg-secondary text-muted-foreground'
            }`}
          >
            <ShieldCheck className="w-7 h-7" />
          </div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h3 className={`text-2xl font-bold ${qcEnabled ? 'text-foreground' : 'text-muted-foreground'}`}>
              Submit for QC
            </h3>
            <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {qcEnabled ? 'Active' : 'Disabled'}
            </span>
          </div>
          <p className="text-muted-foreground mb-8 max-w-sm">
            Send a completed loan file to the Quality Control team for final review and approval.
          </p>
          <div
            className={`mt-auto w-full inline-flex items-center justify-center px-6 py-3 rounded-xl font-semibold ${
              qcEnabled
                ? 'bg-violet-50 text-violet-700 group-hover:bg-violet-600 group-hover:text-white dark:bg-violet-700 dark:text-white dark:hover:bg-violet-600 transition-colors'
                : 'bg-secondary text-muted-foreground'
            }`}
          >
            {qcEnabled ? 'Start Request' : 'Disabled by Admin'}
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-card p-6 rounded-xl border border-border shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-muted-foreground text-sm font-medium">Pending Requests</h3>
            <span className="bg-amber-50 text-amber-700 text-xs px-2 py-1 rounded-full font-medium border border-amber-100">Open</span>
          </div>
          <p className="text-3xl font-bold text-foreground mt-2">{pendingCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Awaiting action</p>
        </div>

        <div className="bg-card p-6 rounded-xl border border-border shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-muted-foreground text-sm font-medium">In Progress</h3>
            <span className="bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full font-medium border border-blue-100">Working</span>
          </div>
          <p className="text-3xl font-bold text-foreground mt-2">{inProgressCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Currently being processed</p>
        </div>

        <div className="bg-card p-6 rounded-xl border border-border shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-muted-foreground text-sm font-medium">Completed</h3>
            <span className="bg-green-50 text-green-700 text-xs px-2 py-1 rounded-full font-medium border border-green-100">Done</span>
          </div>
          <p className="text-3xl font-bold text-foreground mt-2">{completedCount}</p>
          <p className="text-xs text-muted-foreground mt-1">Finished requests</p>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">Recent Task Requests</h2>
          <span className="text-xs text-muted-foreground">{requestSubmissions.length} total</span>
        </div>
        <div className="divide-y divide-border">
          {requestSubmissions.map((task) => (
            <div key={task.id} className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{task.title}</p>
                <p className="text-xs text-muted-foreground">
                  {task.loan.borrowerName} • {task.loan.loanNumber}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">{new Date(task.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {requestSubmissions.length === 0 && (
            <div className="p-6 text-sm text-muted-foreground">No task requests yet.</div>
          )}
        </div>
      </div>

      <NewTaskModal
        open={showNewTask}
        onClose={() => setShowNewTask(false)}
        loanOfficerName={loanOfficerName || 'Admin User'}
        initialType={initialTaskType}
        disclosureEnabled={disclosureEnabled}
        qcEnabled={qcEnabled}
      />
    </div>
  );
}
