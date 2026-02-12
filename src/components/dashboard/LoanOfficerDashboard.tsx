import React, { useState } from 'react';
import { Clock, AlertCircle, ArrowRight, TrendingUp } from 'lucide-react';
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Loan Officer Workspace</h2>
          <p className="text-sm text-slate-500">Create requests, monitor task progress, and track pipeline movement.</p>
        </div>
        <button
          onClick={() => setShowNewTask(true)}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 shadow-sm"
        >
          Create Task
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
      />
    </div>
  );
}
