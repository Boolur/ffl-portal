export default function DashboardLoading() {
  return (
    <div className="min-h-screen app-shell-bg p-6" role="status" aria-label="Loading dashboard">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-24 rounded-2xl bg-slate-200/70" />
        <div className="grid gap-4 md:grid-cols-3">
          <div className="h-32 rounded-2xl bg-slate-200/70" />
          <div className="h-32 rounded-2xl bg-slate-200/70" />
          <div className="h-32 rounded-2xl bg-slate-200/70" />
        </div>
        <div className="h-80 rounded-2xl bg-slate-200/70" />
      </div>
      <span className="sr-only">Loading dashboard…</span>
    </div>
  );
}
