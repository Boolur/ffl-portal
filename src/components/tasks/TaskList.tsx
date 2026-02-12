'use client';

import React from 'react';
import { Calendar, CheckCircle, Clock, FileText, Trash2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { deleteTask, updateTaskStatus } from '@/app/actions/taskActions';
import { TaskStatus } from '@prisma/client';

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: Date | null;
  loan: {
    loanNumber: string;
    borrowerName: string;
    stage?: string;
  };
  assignedRole: string | null;
};

export function TaskList({ tasks, canDelete = false }: { tasks: Task[]; canDelete?: boolean }) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    if (updatingId) return;
    setUpdatingId(taskId);
    // In a real app, we'd use optimistic UI here
    await updateTaskStatus(taskId, newStatus);
    router.refresh();
    setUpdatingId(null);
  };

  const handleDelete = async (taskId: string) => {
    if (deletingId) return;
    const confirmed = window.confirm('Delete this task? This cannot be undone.');
    if (!confirmed) return;
    
    setDeletingId(taskId);
    const result = await deleteTask(taskId);
    if (!result.success) {
      alert(result.error || 'Failed to delete task.');
      setDeletingId(null);
      return;
    }
    router.refresh();
    setDeletingId(null);
  };

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
        <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-lg font-medium text-slate-900">All caught up!</h3>
        <p className="text-slate-500 mt-1">No pending tasks in your queue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tasks.map((task) => (
        <div 
          key={task.id} 
          className="bg-white p-4 rounded-xl border border-slate-200 hover:shadow-md transition-shadow flex items-start justify-between group"
        >
          <div className="flex items-start space-x-4">
            <div className={`mt-1 p-2 rounded-lg ${
              task.status === 'COMPLETED' ? 'bg-green-100 text-green-600' : 
              task.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-600' : 
              'bg-slate-100 text-slate-500'
            }`}>
              <FileText className="w-5 h-5" />
            </div>
            
            <div>
              <h3 className={`font-medium text-slate-900 ${task.status === 'COMPLETED' ? 'line-through text-slate-500' : ''}`}>
                {task.title}
              </h3>
              <div className="flex items-center space-x-3 mt-1 text-sm text-slate-500">
                <span className="font-medium text-slate-700">{task.loan.borrowerName}</span>
                <span>•</span>
                <span>{task.loan.loanNumber}</span>
                {task.loan.stage && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs font-medium border border-blue-100">
                      {task.loan.stage.replace(/_/g, ' ')}
                    </span>
                  </>
                )}
                {task.assignedRole && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-slate-600">
                      {task.assignedRole.replace(/_/g, ' ')}
                    </span>
                  </>
                )}
              </div>
              {task.description && (
                <p className="text-sm text-slate-400 mt-2">{task.description}</p>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end space-y-3">
            {task.dueDate && (
              <div className={`flex items-center text-xs font-medium ${
                new Date(task.dueDate) < new Date() && task.status !== 'COMPLETED' 
                  ? 'text-red-600 bg-red-50 px-2 py-1 rounded' 
                  : 'text-slate-500'
              }`}>
                <Calendar className="w-3 h-3 mr-1" />
                {new Date(task.dueDate).toLocaleDateString()}
              </div>
            )}

            <div className="flex items-center space-x-2">
              {task.status !== 'COMPLETED' && (
                <button 
                  onClick={() => handleStatusChange(task.id, 'COMPLETED')}
                  disabled={!!updatingId}
                  className="inline-flex h-9 items-center px-3 bg-green-50 text-green-700 text-sm font-medium rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updatingId === task.id ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-1.5" />
                  )}
                  {updatingId === task.id ? 'Saving...' : 'Complete'}
                </button>
              )}
              
              {task.status === 'PENDING' && (
                <button 
                  onClick={() => handleStatusChange(task.id, 'IN_PROGRESS')}
                  disabled={!!updatingId}
                  className="inline-flex h-9 items-center px-3 text-slate-500 text-sm font-medium hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed gap-2"
                >
                  {updatingId === task.id && <Loader2 className="w-3 h-3 animate-spin" />}
                  Start
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => handleDelete(task.id)}
                  disabled={!!deletingId}
                  className="inline-flex h-9 w-9 items-center justify-center text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Delete task"
                >
                  {deletingId === task.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
