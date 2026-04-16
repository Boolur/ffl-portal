import { Loader2 } from 'lucide-react';

export default function LeadsLoading() {
  return (
    <div className="fixed inset-0 z-[50] flex items-center justify-center bg-white/80 backdrop-blur-[2px]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-10 w-10 animate-spin text-blue-600" />
        <p className="text-sm font-medium text-slate-500">Loading...</p>
      </div>
    </div>
  );
}
