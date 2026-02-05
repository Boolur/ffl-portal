'use server';

import { prisma } from '@/lib/prisma';
import { TaskStatus } from '@prisma/client';

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
