'use client';

import React, { useState } from 'react';
import { TaskStatus, TaskPriority, UserRole } from '@prisma/client';
import { 
  MoreHorizontal, 
  Plus, 
  AlertCircle, 
  Clock, 
  CheckCircle2, 
  Filter,
  Search,
  ArrowRight
} from 'lucide-react';

type TaskWithRelations = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
  dueDate: Date | null;
  assignedRole: string | null;
  loan: {
    loanNumber: string;
    borrowerName: string;
    loanOfficer: {
      name: string;
    };
  };
  assignedUser: {
    name: string;
  } | null;
};

// Define the buckets (Departments)
const DEPARTMENTS = [
  { 
    id: 'DISCLOSURE', 
    label: 'Disclosure Team', 
    roles: [UserRole.DISCLOSURE_SPECIALIST],
    color: 'bg-indigo-50 border-indigo-100 text-indigo-700'
  },
  { 
    id: 'VA', 
    label: 'Virtual Assistants', 
    roles: [UserRole.VA],
    color: 'bg-purple-50 border-purple-100 text-purple-700'
  },
  { 
    id: 'QC', 
    label: 'Quality Control', 
    roles: [UserRole.QC],
    color: 'bg-amber-50 border-amber-100 text-amber-700'
  },
  { 
    id: 'PROCESSING', 
    label: 'Processing', 
    roles: [UserRole.PROCESSOR_JR, UserRole.PROCESSOR_SR],
    color: 'bg-emerald-50 border-emerald-100 text-emerald-700'
  }
];

export function DepartmentBoard({ tasks }: { tasks: TaskWithRelations[] }) {
  const [selectedDept, setSelectedDept] = useState<string | null>(null);

  // Group tasks by department
  const getDeptTasks = (roles: UserRole[]) => {
    return tasks.filter(t => t.assignedRole && roles.includes(t.assignedRole as UserRole));
  };

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* Header Controls */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text" 
              placeholder="Filter tasks..." 
              className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-64 shadow-sm"
            />
          </div>
          <button className="flex items-center space-x-2 px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-600 hover:bg-slate-50 shadow-sm">
            <Filter className="w-4 h-4" />
            <span>Filter</span>
          </button>
        </div>
        <button className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 shadow-sm shadow-blue-600/20 transition-all">
          <Plus className="w-4 h-4" />
          <span>New Task</span>
        </button>
      </div>

      {/* Kanban Board */}
      <div className="flex-1 overflow-x-auto pb-4">
        <div className="flex space-x-6 h-full min-w-max px-1">
          {DEPARTMENTS.map((dept) => {
            const deptTasks = getDeptTasks(dept.roles);
            const urgentCount = deptTasks.filter(t => t.priority === 'URGENT' || t.priority === 'HIGH').length;
            
            return (
              <div key={dept.id} className="w-96 flex flex-col h-full">
                {/* Column Header */}
                <div className={`p-4 rounded-t-xl border-t border-x ${dept.color} bg-white/50 backdrop-blur-sm flex items-center justify-between`}>
                  <div>
                    <h3 className="font-bold text-sm">{dept.label}</h3>
                    <p className="text-xs opacity-70 mt-0.5">{deptTasks.length} active tasks</p>
                  </div>
                  <div className="flex items-center space-x-2">
                    {urgentCount > 0 && (
                      <span className="flex items-center px-2 py-1 bg-red-100 text-red-700 rounded-full text-[10px] font-bold">
                        {urgentCount} Urgent
                      </span>
                    )}
                    <button className="p-1 hover:bg-black/5 rounded">
                      <MoreHorizontal className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Task List Container */}
                <div className="flex-1 bg-slate-50/50 border-x border-b border-slate-200 rounded-b-xl p-3 overflow-y-auto space-y-3">
                  {deptTasks.length === 0 ? (
                    <div className="text-center py-12 opacity-50">
                      <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                      <p className="text-sm text-slate-500">All clear</p>
                    </div>
                  ) : (
                    deptTasks.map(task => (
                      <TaskCard key={task.id} task={task} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function TaskCard({ task }: { task: TaskWithRelations }) {
  const isUrgent = task.priority === 'URGENT' || task.priority === 'HIGH';
  
  return (
    <div className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group relative overflow-hidden">
      {isUrgent && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-red-500" />
      )}
      
      <div className="flex justify-between items-start mb-2 pl-2">
        <span className="text-[10px] font-mono text-slate-400">#{task.loan.loanNumber}</span>
        {task.status === 'IN_PROGRESS' && (
          <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-[10px] font-medium border border-blue-100">
            In Progress
          </span>
        )}
      </div>

      <h4 className="font-semibold text-slate-900 text-sm mb-1 pl-2 group-hover:text-blue-600 transition-colors">
        {task.title}
      </h4>
      <p className="text-xs text-slate-500 mb-3 pl-2 truncate">
        {task.loan.borrowerName}
      </p>

      <div className="flex items-center justify-between pt-3 border-t border-slate-50 pl-2">
        <div className="flex items-center space-x-2">
          <div className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600 border border-slate-200">
            {task.assignedUser ? task.assignedUser.name.charAt(0) : '?'}
          </div>
          {task.dueDate && (
            <div className={`flex items-center text-[10px] ${
              new Date(task.dueDate) < new Date() ? 'text-red-600 font-medium' : 'text-slate-400'
            }`}>
              <Clock className="w-3 h-3 mr-1" />
              {new Date(task.dueDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
            </div>
          )}
        </div>
        <button className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-blue-600">
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
