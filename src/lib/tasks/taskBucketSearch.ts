import { Prisma } from '@prisma/client';

function expandSearchTerms(query: string): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  const terms = new Set<string>([normalized]);
  if (normalized.includes('united wholesale mortgage')) terms.add('uwm');
  if (normalized === 'uwm') terms.add('united wholesale mortgage');
  return Array.from(terms);
}

export function buildTaskSearchWhere(search: string | undefined): Prisma.TaskWhereInput | null {
  const terms = expandSearchTerms(search || '');
  if (terms.length === 0) return null;

  const orClauses: Prisma.TaskWhereInput[] = [];

  for (const term of terms) {
    orClauses.push(
      { title: { contains: term, mode: 'insensitive' } },
      { description: { contains: term, mode: 'insensitive' } },
      { loan: { borrowerName: { contains: term, mode: 'insensitive' } } },
      { loan: { loanNumber: { contains: term, mode: 'insensitive' } } },
      { loan: { loanOfficer: { is: { name: { contains: term, mode: 'insensitive' } } } } },
      {
        loan: {
          secondaryLoanOfficer: { is: { name: { contains: term, mode: 'insensitive' } } },
        },
      },
      { assignedUser: { is: { name: { contains: term, mode: 'insensitive' } } } }
    );

    if (term.length >= 2) {
      orClauses.push({
        submissionData: {
          string_contains: term,
        },
      });
      orClauses.push({
        parentTask: {
          is: {
            submissionData: {
              string_contains: term,
            },
          },
        },
      });
    }
  }

  return { OR: orClauses };
}
