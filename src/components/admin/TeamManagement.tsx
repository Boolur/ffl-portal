'use client';

import React, { useState } from 'react';
import {
  TeamMemberSummary,
  MemberDetails,
  getMemberDetails,
  reassignLoans,
} from '@/app/actions/teamActions';
import { deleteTask } from '@/app/actions/taskActions';
import { deleteUser } from '@/app/actions/userActions';
import {
  User,
  Briefcase,
  CheckSquare,
  ChevronRight,
  MoreVertical,
  Trash2,
  ArrowRightLeft,
  Loader2,
  X,
  AlertCircle,
} from 'lucide-react';
import { useRouter } from 'next/navigation';

export function TeamManagement({
  members,
  currentUserId,
}: {
  members: TeamMemberSummary[];
  currentUserId: string;
}) {
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [details, setDetails] = useState<MemberDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [reassigning, setReassigning] = useState(false);
  const router = useRouter();

  const handleSelectMember = async (id: string) => {
    setSelectedMemberId(id);
    setLoading(true);
    const data = await getMemberDetails(id);
    setDetails(data);
    setLoading(false);
  };

  const handleCloseDetails = () => {
    setSelectedMemberId(null);
    setDetails(null);
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!confirm('Delete this task?')) return;
    await deleteTask(taskId);
    if (selectedMemberId) handleSelectMember(selectedMemberId);
    router.refresh();
  };

  const handleReassignAllLoans = async () => {
    const targetId = prompt(
      'Enter the User ID to reassign all loans to (e.g. copy from another member):'
    );
    if (!targetId || !selectedMemberId) return;

    setReassigning(true);
    const result = await reassignLoans(selectedMemberId, targetId);
    setReassigning(false);

    if (result.success) {
      alert('Loans reassigned successfully.');
      handleSelectMember(selectedMemberId);
      router.refresh();
    } else {
      alert(result.error);
    }
  };

  const handleDeleteUser = async () => {
    if (!selectedMemberId) return;
    if (
      !confirm(
        'Are you sure you want to delete this user? This action cannot be undone.'
      )
    )
      return;

    const result = await deleteUser(selectedMemberId, currentUserId);
    if (result.success) {
      handleCloseDetails();
      router.refresh();
    } else {
      alert(result.error);
    }
  };

  return (
    <div className="flex h-[calc(100vh-140px)] gap-6">
      {/* Member List */}
      <div className={`flex-1 overflow-y-auto ${selectedMemberId ? 'hidden md:block' : ''}`}>
        <div className="grid grid-cols-1 gap-3">
          {members.map((member) => (
            <div
              key={member.id}
              onClick={() => handleSelectMember(member.id)}
              className={`bg-white border p-4 rounded-xl cursor-pointer transition-all hover:shadow-md ${
                selectedMemberId === member.id
                  ? 'border-blue-500 ring-1 ring-blue-100'
                  : 'border-slate-200 hover:border-blue-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-600 font-bold">
                    {member.name.charAt(0)}
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900">{member.name}</h3>
                    <p className="text-xs text-slate-500">{member.role.replace(/_/g, ' ')}</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-300" />
              </div>
              <div className="mt-4 flex items-center gap-4 text-xs text-slate-600">
                <div className="flex items-center gap-1.5">
                  <Briefcase className="w-3.5 h-3.5 text-blue-500" />
                  <span>{member.loanCount} Active Loans</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <CheckSquare className="w-3.5 h-3.5 text-emerald-500" />
                  <span>{member.taskCount} Pending Tasks</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detail View */}
      {selectedMemberId && (
        <div className="flex-[1.5] bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col overflow-hidden h-full fixed inset-0 md:static z-50 md:z-auto">
          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : details ? (
            <>
              {/* Header */}
              <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
                <div>
                  <h2 className="text-xl font-bold text-slate-900">{details.user.name}</h2>
                  <p className="text-sm text-slate-500">{details.user.email}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
                      {details.user.role.replace(/_/g, ' ')}
                    </span>
                    <span className="text-xs text-slate-400">
                      Joined {new Date(details.user.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleCloseDetails}
                  className="p-2 hover:bg-slate-200 rounded-lg text-slate-500 md:hidden"
                >
                  <X className="w-5 h-5" />
                </button>
                <div className="hidden md:flex gap-2">
                  <button
                    onClick={handleDeleteUser}
                    className="flex items-center gap-2 px-3 py-2 bg-white border border-red-200 text-red-600 text-xs font-semibold rounded-lg hover:bg-red-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    Delete User
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8">
                {/* Loans Section */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                      <Briefcase className="w-4 h-4" />
                      Active Loans ({details.loans.length})
                    </h3>
                    {details.loans.length > 0 && (
                      <button
                        onClick={handleReassignAllLoans}
                        disabled={reassigning}
                        className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                      >
                        {reassigning ? <Loader2 className="w-3 h-3 animate-spin" /> : <ArrowRightLeft className="w-3 h-3" />}
                        Reassign All
                      </button>
                    )}
                  </div>
                  
                  {details.loans.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">No active loans assigned.</p>
                  ) : (
                    <div className="space-y-2">
                      {details.loans.map((loan) => (
                        <div key={loan.id} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-100">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{loan.borrowerName}</p>
                            <p className="text-xs text-slate-500">{loan.loanNumber} • ${loan.amount.toLocaleString()}</p>
                          </div>
                          <span className="px-2 py-1 bg-white rounded text-xs font-medium text-slate-600 border border-slate-200">
                            {loan.stage}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* Tasks Section */}
                <section>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide flex items-center gap-2">
                      <CheckSquare className="w-4 h-4" />
                      Pending Tasks ({details.tasks.length})
                    </h3>
                  </div>

                  {details.tasks.length === 0 ? (
                    <p className="text-sm text-slate-500 italic">No pending tasks.</p>
                  ) : (
                    <div className="space-y-2">
                      {details.tasks.map((task) => (
                        <div key={task.id} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg hover:border-blue-300 transition-colors group">
                          <div>
                            <p className="text-sm font-medium text-slate-900">{task.title}</p>
                            <p className="text-xs text-slate-500">
                              {task.loan.borrowerName} • {task.status}
                            </p>
                          </div>
                          <button
                            onClick={() => handleDeleteTask(task.id)}
                            className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            title="Delete Task"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
                
                {/* Mobile Delete Button */}
                <div className="md:hidden pt-6 border-t border-slate-100">
                   <button
                    onClick={handleDeleteUser}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-red-50 text-red-600 font-semibold rounded-xl"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete User Account
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-6 text-center">
              <AlertCircle className="w-12 h-12 mb-2 opacity-20" />
              <p>User not found or deleted.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
