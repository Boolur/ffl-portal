import React from 'react';
import Image from 'next/image';

type PortalLoadingStateProps = {
  label?: string;
  description?: string;
  variant?: 'workspace' | 'compact' | 'navigation';
  preview?: 'cards' | 'table';
};

function LoadingMark({ small = false }: { small?: boolean }) {
  return (
    <div aria-hidden="true" className={small ? 'relative h-5 w-5 shrink-0' : 'relative mx-auto mb-6 flex h-[76px] w-[76px] items-center justify-center'}>
      {!small && <div className="absolute inset-2 rounded-full bg-card shadow-sm ring-1 ring-border/70" />}
      <svg viewBox="0 0 64 64" fill="none" className="absolute inset-0 h-full w-full" focusable="false">
        <circle cx="32" cy="32" r="30" className="stroke-primary/10" strokeWidth="1.5" />
      </svg>
      <svg viewBox="0 0 64 64" fill="none" className="absolute inset-0 h-full w-full motion-safe:animate-spin motion-safe:[animation-duration:3s]" focusable="false">
        <circle cx="32" cy="32" r="30" className="stroke-primary" strokeWidth="2" strokeLinecap="round" strokeDasharray="42 147" />
        <circle cx="32" cy="2" r="2.5" className="fill-teal-400" />
      </svg>
      {!small && <Image src="/bisu-icon.png" alt="" width={30} height={30} className="relative" />}
    </div>
  );
}

function WorkspacePreview({ table }: { table: boolean }) {
  return (
    <div aria-hidden="true" className="mx-auto mt-9 w-full max-w-xl select-none motion-safe:animate-pulse motion-safe:[animation-duration:3s]">
      <div className="mb-4 flex items-center justify-between px-1">
        <div className="space-y-2">
          <div className="h-2 w-28 rounded-full bg-foreground/10" />
          <div className="h-1.5 w-40 rounded-full bg-foreground/5" />
        </div>
        <div className="h-6 w-16 rounded-md border border-primary/10 bg-primary/5" />
      </div>
      {table ? (
        <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-sm">
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-6 border-b border-border/70 bg-muted px-5 py-3">
            <div className="h-1.5 w-16 rounded-full bg-foreground/10" />
            <div className="h-1.5 w-12 rounded-full bg-foreground/10" />
            <div className="h-1.5 w-10 rounded-full bg-foreground/10" />
          </div>
          {[0, 1, 2].map(row => (
            <div key={row} className="grid grid-cols-[2fr_1fr_1fr] items-center gap-6 border-b border-border/50 px-5 py-4 last:border-b-0">
              <div className="flex min-w-0 items-center gap-3">
                <div className="h-7 w-7 shrink-0 rounded-lg bg-primary/5" />
                <div className={row === 1 ? 'h-2 w-16 rounded-full bg-foreground/5' : 'h-2 w-24 rounded-full bg-foreground/5'} />
              </div>
              <div className="h-1.5 w-full max-w-14 rounded-full bg-foreground/5" />
              <div className={row === 1 ? 'h-5 w-full max-w-16 rounded-full bg-teal-500/10' : 'h-5 w-full max-w-16 rounded-full bg-primary/5'} />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map(card => (
            <div key={card} className="rounded-xl border border-border/80 bg-card p-4 shadow-sm sm:p-5">
              <div className={card === 1 ? 'mb-5 h-8 w-8 rounded-lg bg-teal-500/10' : 'mb-5 h-8 w-8 rounded-lg bg-primary/5'} />
              <div className="h-3 w-8 rounded-full bg-foreground/10" />
              <div className="mt-3 h-1.5 w-full max-w-20 rounded-full bg-foreground/5" />
              <div className="mt-2 h-1.5 w-2/3 rounded-full bg-foreground/5" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** One quiet loading treatment for route boundaries and embedded workspaces. */
export function PortalLoadingState({
  label = 'Opening your workspace',
  description = 'Getting everything ready for you.',
  variant = 'workspace',
  preview = 'cards',
}: PortalLoadingStateProps) {
  if (variant === 'navigation') {
    return (
      <div role="status" aria-live="polite" aria-atomic="true" className="inline-flex items-center gap-2.5 rounded-full border border-border bg-card/95 px-4 py-2 text-xs font-medium text-muted-foreground shadow-sm">
        <LoadingMark small />
        <span>{label}</span>
      </div>
    );
  }

  return (
    <div data-portal-loading={variant} className={variant === 'compact'
      ? 'grid min-h-[360px] w-full place-items-center px-4 py-8'
      : 'grid min-h-[60vh] w-full place-items-center px-2 py-10 sm:py-14'}>
      <div className="w-full max-w-2xl">
        <div role="status" aria-live="polite" aria-atomic="true" className="text-center">
          <LoadingMark />
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary/80">BISU Workspace</p>
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{label}</h2>
          {description && <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{description}</p>}
        </div>
        <WorkspacePreview table={preview === 'table'} />
      </div>
    </div>
  );
}
