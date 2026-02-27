import React, { useState } from 'react';
import { ClipboardCheck, ShieldCheck } from 'lucide-react';
import { NewTaskModal } from '@/components/loanOfficer/NewTaskModal';

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
    status: string;
    createdAt: Date;
    loan: {
      loanNumber: string;
      borrowerName: string;
      loanOfficer?: { name: string };
    };
  }>;
  loanOfficerName?: string;
};

export function LoanOfficerDashboard({ submissions = [], loanOfficerName }: LoanOfficerDashboardProps) {
  const [showNewTask, setShowNewTask] = useState(false);
  const [initialTaskType, setInitialTaskType] = useState<'DISCLOSURES' | 'QC'>('DISCLOSURES');
  const filteredSubmissions = loanOfficerName
    ? submissions.filter((t) => t.loan.loanOfficer?.name === loanOfficerName)
    : submissions;
  const pendingCount = filteredSubmissions.filter((t) => t.status === 'PENDING').length;
  const inProgressCount = filteredSubmissions.filter((t) => t.status === 'IN_PROGRESS').length;
  const completedCount = filteredSubmissions.filter((t) => t.status === 'COMPLETED').length;

  const openTaskModal = (type: 'DISCLOSURES' | 'QC') => {
    setInitialTaskType(type);
    setShowNewTask(true);
  };

  return (
    <div className="space-y-8">
      {/* Primary Action Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button
          onClick={() => openTaskModal('DISCLOSURES')}
          className="group relative flex flex-col items-start p-8 rounded-2xl border border-blue-200 bg-white shadow-sm hover:shadow-md hover:border-blue-300 transition-all text-left overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <ClipboardCheck className="w-32 h-32 text-blue-600" />
          </div>
          <div className="w-14 h-14 rounded-xl bg-blue-600 text-white flex items-center justify-center mb-6 shadow-sm group-hover:scale-105 transition-transform">
            <ClipboardCheck className="w-7 h-7" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mb-2">Submit for Disclosures</h3>
          <p className="text-slate-500 mb-8 max-w-sm">
            Send loan information and initial documents to the Disclosure Team for processing.
          </p>
          <div className="mt-auto w-full inline-flex items-center justify-center px-6 py-3 rounded-xl bg-blue-50 text-blue-700 font-semibold group-hover:bg-blue-600 group-hover:text-white transition-colors">
            Start Request
          </div>
        </button>

        <button
          onClick={() => openTaskModal('QC')}
          className="group relative flex flex-col items-start p-8 rounded-2xl border border-indigo-200 bg-white shadow-sm hover:shadow-md hover:border-indigo-300 transition-all text-left overflow-hidden"
        >
          <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
            <ShieldCheck className="w-32 h-32 text-indigo-600" />
          </div>
          <div className="w-14 h-14 rounded-xl bg-indigo-600 text-white flex items-center justify-center mb-6 shadow-sm group-hover:scale-105 transition-transform">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h3 className="text-2xl font-bold text-slate-900 mb-2">Submit for QC</h3>
          <p className="text-slate-500 mb-8 max-w-sm">
            Send a completed loan file to the Quality Control team for final review and approval.
          </p>
          <div className="mt-auto w-full inline-flex items-center justify-center px-6 py-3 rounded-xl bg-indigo-50 text-indigo-700 font-semibold group-hover:bg-indigo-600 group-hover:text-white transition-colors">
            Start Request
          </div>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-slate-500 text-sm font-medium">Pending Requests</h3>
            <span className="bg-amber-50 text-amber-700 text-xs px-2 py-1 rounded-full font-medium border border-amber-100">Open</span>
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">{pendingCount}</p>
          <p className="text-xs text-slate-500 mt-1">Awaiting action</p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-slate-500 text-sm font-medium">In Progress</h3>
            <span className="bg-blue-50 text-blue-700 text-xs px-2 py-1 rounded-full font-medium border border-blue-100">Working</span>
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">{inProgressCount}</p>
          <p className="text-xs text-slate-500 mt-1">Currently being processed</p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-slate-500 text-sm font-medium">Completed</h3>
            <span className="bg-green-50 text-green-700 text-xs px-2 py-1 rounded-full font-medium border border-green-100">Done</span>
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">{completedCount}</p>
          <p className="text-xs text-slate-500 mt-1">Finished requests</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Recent Task Requests</h2>
          <span className="text-xs text-slate-500">{filteredSubmissions.length} total</span>
        </div>
        <div className="divide-y divide-slate-100">
          {filteredSubmissions.map((task) => (
            <div key={task.id} className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-slate-900">{task.title}</p>
                <p className="text-xs text-slate-500">
                  {task.loan.borrowerName} • {task.loan.loanNumber}
                </p>
              </div>
              <span className="text-xs text-slate-500">{new Date(task.createdAt).toLocaleString()}</span>
            </div>
          ))}
          {filteredSubmissions.length === 0 && (
            <div className="p-6 text-sm text-slate-500">No task requests yet.</div>
          )}
        </div>
      </div>

      <NewTaskModal
        open={showNewTask}
        onClose={() => setShowNewTask(false)}
        loanOfficerName={loanOfficerName || 'Admin User'}
        initialType={initialTaskType}
      />
    </div>
  );
}
