import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { prisma } from '@/lib/prisma';
import { TaskList } from '@/components/tasks/TaskList';
import { UserRole } from '@prisma/client';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';

// In a real app, we'd get the current user from the session
const MOCK_USER = {
  id: 'mock-user-id',
  name: 'Sarah Disclosure',
  role: 'DISCLOSURE_SPECIALIST', // Change this to test different views
};

async function getTasks(role: string) {
  // Fetch tasks assigned to this role OR specifically to this user
  // For MVP, we'll just fetch by role for the pool
  const tasks = await prisma.task.findMany({
    where: {
      OR: [
        { assignedRole: role as UserRole },
        // { assignedUserId: userId } // Add this later
      ],
      status: {
        not: 'COMPLETED', // Default view hides completed
      }
    },
    include: {
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
        },
      },
    },
    orderBy: {
      dueDate: 'asc', // Urgent first
    },
  });
  
  return tasks;
}

export default async function TasksPage() {
  const session = await getServerSession(authOptions);
  const sessionRole = session?.user?.role || MOCK_USER.role;
  const sessionUser = {
    name: session?.user?.name || MOCK_USER.name,
    role: sessionRole,
  };
  const tasks = await getTasks(sessionRole);
  const canDelete =
    sessionRole === UserRole.ADMIN || sessionRole === UserRole.MANAGER;

  return (
    <DashboardShell user={sessionUser}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Task Queue</h1>
          <p className="text-slate-500 mt-1">
            Manage your assigned tasks and workflow steps.
          </p>
        </div>
        <div className="flex space-x-3">
          <span className="bg-slate-100 text-slate-600 px-3 py-1 rounded-full text-sm font-medium">
            {tasks.length} Pending
          </span>
        </div>
      </div>

      <TaskList tasks={tasks} canDelete={canDelete} />
    </DashboardShell>
  );
}
