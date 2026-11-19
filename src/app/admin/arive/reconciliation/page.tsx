import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getAriveOneTimeReconciliationStatus } from '@/app/actions/ariveOneTimeReconciliationActions';
import { AriveOneTimeReconciliation } from '@/components/pipeline/AriveOneTimeReconciliation';

export const dynamic = 'force-dynamic';
export const maxDuration = 180;

export default async function AriveReconciliationPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const result = await getAriveOneTimeReconciliationStatus();
  return <DashboardShell user={{ name: session.user.name || 'User', role: (session.user.activeRole || session.user.role) as UserRole }}>
    <div className="mx-auto max-w-5xl space-y-5">
      <div><h1 className="app-page-title">Reviewed Arive matches</h1>
        <p className="mt-2 text-sm text-muted-foreground">One-time reconciliation of the seven reviewed files. Automatic synchronization stays paused.</p></div>
      {result.success ? <AriveOneTimeReconciliation initial={result} /> : <p role="alert" className="app-surface-card">{result.error}</p>}
    </div>
  </DashboardShell>;
}
