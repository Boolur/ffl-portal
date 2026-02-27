import React, { useState } from 'react';
import { Clock, AlertCircle, ArrowRight, TrendingUp, ClipboardCheck, ShieldCheck } from 'lucide-react';
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

export function LoanOfficerDashboard({ loans = [], submissions = [], loanOfficerName }: LoanOfficerDashboardProps) {
  const [showNewTask, setShowNewTask] = useState(false);
  const [initialTaskType, setInitialTaskType] = useState<'DISCLOSURES' | 'QC'>('DISCLOSURES');

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
            <h3 className="text-slate-500 text-sm font-medium">Active Pipeline</h3>
            <span className="bg-blue-50 text-blue-600 text-xs px-2 py-1 rounded-full font-medium border border-blue-100">Live Data</span>
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">{loans.length}</p>
          <p className="text-xs text-slate-500 mt-1">Total Active Files</p>
        </div>
        
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-slate-500 text-sm font-medium">Volume</h3>
            <TrendingUp className="w-4 h-4 text-green-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">
            ${(loans.reduce((acc, curr) => acc + Number(curr.amount), 0) / 1000000).toFixed(1)}M
          </p>
          <p className="text-xs text-slate-500 mt-1">Total Loan Amount</p>
        </div>

        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between">
            <h3 className="text-slate-500 text-sm font-medium">Action Needed</h3>
            <AlertCircle className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-3xl font-bold text-slate-900 mt-2">0</p>
          <p className="text-xs text-slate-500 mt-1">Files requiring attention</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Pipeline Activity</h2>
          <button className="text-sm text-blue-600 hover:text-blue-700 font-medium">View All</button>
        </div>
        <div className="divide-y divide-slate-100">
          {loans.map((loan) => (
            <div key={loan.id} className="p-6 hover:bg-slate-50 transition-colors flex items-center justify-between group">
              <div className="flex items-center space-x-4">
                <div className={`w-2 h-2 rounded-full ${
                  loan.stage === 'INTAKE' ? 'bg-amber-500' : 
                  loan.stage === 'CLOSED' ? 'bg-green-500' : 'bg-blue-500'
                }`} />
                <div>
                  <p className="text-sm font-medium text-slate-900 group-hover:text-blue-600 transition-colors">{loan.borrowerName}</p>
                  <p className="text-xs text-slate-500">{loan.loanNumber} • ${Number(loan.amount).toLocaleString()}</p>
                </div>
              </div>
              
              <div className="flex items-center space-x-8">
                <div className="text-right">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Stage</p>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-100 mt-1">
                    {loan.stage.replace(/_/g, ' ')}
                  </span>
                </div>
                
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-medium text-slate-500 uppercase tracking-wider">Updated</p>
                  <p className="text-sm text-slate-500 mt-1 flex items-center justify-end">
                    <Clock className="w-3 h-3 mr-1" /> {new Date(loan.updatedAt).toLocaleDateString()}
                  </p>
                </div>

                <button className="p-2 text-slate-400 hover:text-blue-600 rounded-full hover:bg-slate-100 transition-colors">
                  <ArrowRight className="w-5 h-5" />
                </button>
              </div>
            </div>
          ))}
          {loans.length === 0 && (
            <div className="p-6 text-sm text-slate-500">No loans yet.</div>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Recent Task Requests</h2>
          <span className="text-xs text-slate-500">{submissions.length} total</span>
        </div>
        <div className="divide-y divide-slate-100">
          {(loanOfficerName
            ? submissions.filter((t) => t.loan.loanOfficer?.name === loanOfficerName)
            : submissions
          ).map((task) => (
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
          {submissions.length === 0 && (
            <div className="p-6 text-sm text-slate-500">No submissions yet.</div>
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
