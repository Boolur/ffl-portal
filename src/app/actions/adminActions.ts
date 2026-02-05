'use server';

import { prisma } from '@/lib/prisma';

export async function getAllTasks() {
  const tasks = await prisma.task.findMany({
    include: {
      loan: {
        select: {
          loanNumber: true,
          borrowerName: true,
          loanOfficer: {
            select: {
              name: true
            }
          }
        }
      },
      assignedUser: {
        select: {
          name: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  return tasks;
}
