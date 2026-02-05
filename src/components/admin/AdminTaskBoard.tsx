'use client';

import React, { useState } from 'react';
import { TaskStatus, TaskPriority } from '@prisma/client';
import { 
  Clock, 
  Trash2, 
  User, 
  FileText, 
  MessageSquare, 
  Settings, 
  Mail, 
  Building2,
  LayoutGrid,
  ListFilter
} from 'lucide-react';

type TaskWithRelations = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  createdAt: Date;
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

export function AdminTaskBoard({ initialTasks }: { initialTasks: TaskWithRelations[] }) {
  const [activeTab, setActiveTab] = useState('tasks');
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'ALL'>('ALL');

  const stats = {
    new: initialTasks.filter(t => t.status === 'PENDING').length,
    inProgress: initialTasks.filter(t => t.status === 'IN_PROGRESS').length,
    completed: initialTasks.filter(t => t.status === 'COMPLETED').length,
    blocked: initialTasks.filter(t => t.status === 'BLOCKED').length,
  };

  const filteredTasks = initialTasks.filter(task => 
    filterStatus === 'ALL' || task.status === filterStatus
  );

  return (
    <div className="space-y-6">
      {/* Top Navigation Tabs */}
      <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-lg border border-slate-200 w-fit">
        <TabButton 
          active={activeTab === 'tasks'} 
          onClick={() => setActiveTab('tasks')} 
          icon={LayoutGrid} 
          label="Task Management" 
          count={stats.new}
          color="blue"
        />
        <TabButton 
          active={activeTab === 'questions'} 
          onClick={() => setActiveTab('questions')} 
          icon={MessageSquare} 
          label="Questions & Scenarios" 
          count={3}
          color="red"
        />
        <TabButton 
          active={activeTab === 'users'} 
          onClick={() => setActiveTab('users')} 
          icon={User} 
          label="User Management" 
        />
        <TabButton 
          active={activeTab === 'email'} 
          onClick={() => setActiveTab('email')} 
          icon={Mail} 
          label="Email Settings" 
        />
        <TabButton 
          active={activeTab === 'lenders'} 
          onClick={() => setActiveTab('lenders')} 
          icon={Building2} 
          label="Lender Management" 
        />
      </div>

      {/* Status Filters */}
      <div className="bg-white p-2 rounded-lg border border-slate-200 flex items-center space-x-2 overflow-x-auto shadow-sm">
        <FilterButton 
          active={filterStatus === 'ALL'} 
          onClick={() => setFilterStatus('ALL')}
          label="All Tasks"
          count={initialTasks.length}
          color="slate"
        />
        <FilterButton 
          active={filterStatus === 'PENDING'} 
          onClick={() => setFilterStatus('PENDING')}
          label="New Tasks"
          count={stats.new}
          color="blue"
        />
        <FilterButton 
          active={filterStatus === 'IN_PROGRESS'} 
          onClick={() => setFilterStatus('IN_PROGRESS')}
          label="In Progress"
          count={stats.inProgress}
          color="amber"
        />
        <FilterButton 
          active={filterStatus === 'COMPLETED'} 
          onClick={() => setFilterStatus('COMPLETED')}
          label="Completed"
          count={stats.completed}
          color="green"
        />
        <FilterButton 
          active={filterStatus === 'BLOCKED'} 
          onClick={() => setFilterStatus('BLOCKED')}
          label="Blocked"
          count={stats.blocked}
          color="red"
        />
      </div>

      {/* Sorting / Controls */}
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-2 text-slate-500 text-sm">
          <ListFilter className="w-4 h-4" />
          <span>Sort by Priority</span>
        </div>
      </div>

      {/* Task Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTasks.map((task) => (
          <TaskCard key={task.id} task={task} />
        ))}
      </div>

      {/* Quick Stats Footer */}
      <div className="grid grid-cols-4 gap-4 mt-8">
        <StatCard label="New Tasks" value={stats.new} color="bg-blue-600" />
        <StatCard label="In Progress" value={stats.inProgress} color="bg-amber-600" />
        <StatCard label="Completed" value={stats.completed} color="bg-green-600" />
        <StatCard label="Blocked" value={stats.blocked} color="bg-red-600" />
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, label, count, color = 'blue' }: any) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium transition-all ${
        active 
          ? `bg-white text-slate-900 shadow-sm border border-slate-200` 
          : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/50'
      }`}
    >
      <Icon className={`w-4 h-4 ${active ? `text-${color}-600` : ''}`} />
      <span>{label}</span>
      {count !== undefined && (
        <span className={`ml-2 px-1.5 py-0.5 rounded-full text-[10px] ${
          active ? 'bg-slate-100 text-slate-600' : 'bg-slate-200 text-slate-600'
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

function FilterButton({ active, onClick, label, count, color }: any) {
  const colorStyles = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100',
    green: 'bg-green-50 text-green-700 border-green-100 hover:bg-green-100',
    red: 'bg-red-50 text-red-700 border-red-100 hover:bg-red-100',
    slate: 'bg-slate-50 text-slate-700 border-slate-100 hover:bg-slate-100',
  };

  const activeStyles = {
    blue: 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200',
    amber: 'bg-amber-600 text-white border-amber-600 shadow-md shadow-amber-200',
    green: 'bg-green-600 text-white border-green-600 shadow-md shadow-green-200',
    red: 'bg-red-600 text-white border-red-600 shadow-md shadow-red-200',
    slate: 'bg-slate-800 text-white border-slate-800 shadow-md shadow-slate-200',
  };

  return (
    <button
      onClick={onClick}
      className={`flex items-center space-x-2 px-3 py-1.5 rounded-md text-xs font-medium border transition-all whitespace-nowrap ${
        active ? (activeStyles[color as keyof typeof activeStyles] || activeStyles.slate) : (colorStyles[color as keyof typeof colorStyles] || colorStyles.slate)
      }`}
    >
      <span>{label}</span>
      <span className={`ml-1 px-1.5 py-0.5 rounded-full text-[10px] ${active ? 'bg-white/20 text-white' : 'bg-white/50'}`}>
        {count}
      </span>
    </button>
  );
}

function TaskCard({ task }: { task: TaskWithRelations }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 hover:border-blue-300 hover:shadow-md transition-all group relative">
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-mono text-slate-400">#{task.id.slice(0, 8)}</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
            task.priority === 'URGENT' ? 'bg-red-100 text-red-700' :
            task.priority === 'HIGH' ? 'bg-orange-100 text-orange-700' :
            'bg-blue-100 text-blue-700'
          }`}>
            {task.priority || 'Normal'}
          </span>
        </div>
        <button className="text-slate-400 hover:text-red-500 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <h3 className="text-slate-900 font-semibold mb-1 truncate group-hover:text-blue-600 transition-colors">{task.title}</h3>
      
      <div className="space-y-2 mt-4">
        <div className="flex items-center text-xs text-slate-500">
          <User className="w-3 h-3 mr-2 text-slate-400" />
          <span>{task.loan.loanOfficer.name} (LO)</span>
        </div>
        <div className="flex items-center text-xs text-slate-500">
          <FileText className="w-3 h-3 mr-2 text-slate-400" />
          <span>{task.loan.borrowerName}</span>
        </div>
        <div className="flex items-center text-xs text-slate-500">
          <Clock className="w-3 h-3 mr-2 text-slate-400" />
          <span>{new Date(task.createdAt).toLocaleString()}</span>
        </div>
      </div>

      <div className="mt-4 pt-3 border-t border-slate-100 flex justify-between items-center">
        <button className="text-xs text-blue-600 hover:text-blue-700 font-medium">Show More</button>
        <span className="text-[10px] text-slate-400 uppercase tracking-wider">
          {task.assignedRole?.replace(/_/g, ' ') || 'Unassigned'}
        </span>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: any) {
  // Extract the color name to map to light theme equivalents
  const baseColor = color.replace('bg-', '').replace('-600', '');
  const bgClass = `bg-${baseColor}-50`;
  const textClass = `text-${baseColor}-700`;
  const borderClass = `border-${baseColor}-100`;

  return (
    <div className={`bg-white border border-slate-200 p-4 rounded-lg flex items-center space-x-4 shadow-sm`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center font-bold ${bgClass} ${textClass} border ${borderClass}`}>
        {value}
      </div>
      <div>
        <p className="text-2xl font-bold text-slate-900">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </div>
  );
}
