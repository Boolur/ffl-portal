import { getServerSession } from 'next-auth';
import { redirect } from 'next/navigation';
import { UserRole } from '@prisma/client';
import { authOptions } from '@/lib/auth';
import { getAriveConnectionSettings } from '@/app/actions/submissionPilotActions';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { AriveConnectionSettings } from '@/components/pipeline/AriveConnectionSettings';
export const dynamic = 'force-dynamic';
export default async function AriveSettingsPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect('/login');
  const r = await getAriveConnectionSettings();
  return <DashboardShell user={{ name: session.user.name || 'User', role: (session.user.activeRole || session.user.role) as UserRole }}><div className="mx-auto max-w-4xl space-y-5"><div><h1 className="app-page-title">Arive integration settings</h1><p className="text-sm text-muted-foreground">Branch-scoped connection · Portal Admin III</p></div>{r.success ? <AriveConnectionSettings initialConfigured={r.data.configured} /> : <p role="alert" className="app-surface-card">{r.error}</p>}</div></DashboardShell>;
}
