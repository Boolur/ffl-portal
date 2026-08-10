export default function TasksLoading() {
  return (
    <div className="min-h-screen app-shell-bg p-6" role="status" aria-label="Loading tasks">
      <div className="mx-auto max-w-7xl animate-pulse space-y-5">
        <div className="h-24 rounded-2xl bg-slate-200/70" />
        <div className="grid gap-5 xl:grid-cols-2">
          <div className="h-[540px] rounded-2xl bg-slate-200/70" />
          <div className="h-[540px] rounded-2xl bg-slate-200/70" />
        </div>
      </div>
      <span className="sr-only">Loading tasks…</span>
    </div>
  );
}
