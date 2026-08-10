export default function PipelineLoading() {
  return (
    <div className="min-h-screen app-shell-bg p-6" role="status" aria-label="Loading pipeline">
      <div className="mx-auto max-w-[1800px] animate-pulse space-y-5">
        <div className="h-24 rounded-2xl bg-slate-200/70" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="h-28 rounded-2xl bg-slate-200/70" />
          <div className="h-28 rounded-2xl bg-slate-200/70" />
          <div className="h-28 rounded-2xl bg-slate-200/70" />
          <div className="h-28 rounded-2xl bg-slate-200/70" />
        </div>
        <div className="h-[560px] rounded-2xl bg-slate-200/70" />
      </div>
      <span className="sr-only">Loading pipeline…</span>
    </div>
  );
}
