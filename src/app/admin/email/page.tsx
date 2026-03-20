import React from 'react';
import { DashboardShell } from '@/components/layout/DashboardShell';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  getNotificationOutboxStats,
  requeueFailedNotificationOutbox,
} from '@/app/actions/taskActions';

export default async function EmailSettingsPage() {
  const session = await getServerSession(authOptions);
  const user = {
    name: session?.user?.name || 'Admin User',
    role: session?.user?.activeRole || session?.user?.role || 'ADMIN',
  };
  const outboxStats = await getNotificationOutboxStats();

  return (
    <DashboardShell user={user}>
      <div className="app-page-header">
        <h1 className="app-page-title">Email Settings</h1>
        <p className="app-page-subtitle">
          Configure sender identity and invitation/reset delivery settings.
        </p>
      </div>
      <div className="app-surface-card">
        <h2 className="text-base font-semibold text-slate-900">Notification Outbox Diagnostics</h2>
        <p className="mt-1 text-sm text-slate-600">
          Delivery mode: <span className="font-semibold uppercase">{outboxStats.mode}</span>
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending</p>
            <p className="mt-1 text-2xl font-bold text-slate-900">{outboxStats.pending}</p>
          </div>
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Processing</p>
            <p className="mt-1 text-2xl font-bold text-blue-900">{outboxStats.processing}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Retry Queue</p>
            <p className="mt-1 text-2xl font-bold text-amber-900">{outboxStats.retry}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Sent (24h)</p>
            <p className="mt-1 text-2xl font-bold text-emerald-900">{outboxStats.sent24h}</p>
          </div>
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">Failed</p>
            <p className="mt-1 text-2xl font-bold text-rose-900">{outboxStats.failed}</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-slate-500">
          Set <code className="rounded bg-slate-100 px-1.5 py-0.5">NOTIFICATION_DELIVERY_MODE</code>{' '}
          to <code className="rounded bg-slate-100 px-1.5 py-0.5">sync</code>,{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">dual</code>, or{' '}
          <code className="rounded bg-slate-100 px-1.5 py-0.5">async</code>. Configure
          <code className="rounded bg-slate-100 px-1.5 py-0.5"> NOTIFICATION_OUTBOX_SECRET</code>{' '}
          for the cron drain endpoint.
        </p>
        <form action={async () => {
          'use server';
          await requeueFailedNotificationOutbox(200);
        }} className="mt-4">
          <button
            type="submit"
            className="inline-flex items-center rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Requeue Failed Notifications
          </button>
        </form>
      </div>
    </DashboardShell>
  );
}
