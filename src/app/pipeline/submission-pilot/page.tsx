import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { getSubmissionPilot } from '@/app/actions/submissionPilotActions';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { SubmissionPilot } from '@/components/pipeline/SubmissionPilot';

export const dynamic = 'force-dynamic';
export default async function SubmissionPilotPage({ searchParams }: { searchParams: Promise<{ task?: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const result = await getSubmissionPilot();
  if (!result.success) return <div className="app-surface-card m-6"><h1 className="app-page-title">Submission pilot unavailable</h1><p>{result.error}</p><a href="/pipeline" className="app-btn-secondary mt-4">Back to pipeline</a></div>;
  const query = await searchParams;
  return <DashboardShell user={{ name: session.user.name || 'User', role: (session.user.activeRole || session.user.role) as UserRole }}><SubmissionPilot initialData={result.data} initialTask={query.task} /></DashboardShell>;
}
