import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { getAriveConnectionSettings } from '@/app/actions/submissionPilotActions';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { AriveDiagnosticsPanel } from '@/components/pipeline/AriveDiagnosticsPanel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function AriveDiagnosticsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const access = await getAriveConnectionSettings();
  return <DashboardShell user={{ name: session.user.name || 'User', role: (session.user.activeRole || session.user.role) as UserRole }}>
    <div className="mx-auto max-w-4xl space-y-5">
      <Link href="/admin/arive" className="app-btn-secondary">Back to Arive integration</Link>
      <div><h1 className="app-page-title">Arive connection diagnostics</h1><p className="mt-1 text-sm text-muted-foreground">Portal Admin III · Temporary connection verification</p></div>
      {access.success ? <AriveDiagnosticsPanel /> : <p role="alert" className="app-surface-card">{access.error}</p>}
    </div>
  </DashboardShell>;
}
