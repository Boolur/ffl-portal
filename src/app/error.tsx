'use client';

// Segment-level error boundary for all routes under the root layout.
// Catches any render error thrown by a page or nested layout and
// surfaces the digest so we can trace it in Vercel logs, instead of
// the browser showing Next's generic "Server Components render" error
// with no recovery path.

import { useEffect } from 'react';

type ErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function RouteError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('[route-error]', {
      message: error?.message,
      digest: error?.digest,
      stack: error?.stack,
    });
  }, [error]);

  return (
    <div
      style={{
        minHeight: '70vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 520,
          width: '100%',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 16,
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
          padding: 32,
        }}
      >
        <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>
          This screen ran into a problem
        </h1>
        <p style={{ marginTop: 12, color: '#475569', lineHeight: 1.55 }}>
          Other parts of the portal should still work. You can retry this screen,
          or head back to the Overview. If it keeps happening, send the digest
          below to your admin.
        </p>

        <div
          style={{
            marginTop: 20,
            padding: '10px 12px',
            background: '#f1f5f9',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            fontFamily:
              'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            fontSize: 12,
            color: '#334155',
            overflowWrap: 'anywhere',
          }}
        >
          <div>
            <span style={{ color: '#64748b' }}>digest:</span>{' '}
            {error?.digest || '(none)'}
          </div>
          {error?.message ? (
            <div style={{ marginTop: 6 }}>
              <span style={{ color: '#64748b' }}>message:</span> {error.message}
            </div>
          ) : null}
        </div>

        <div style={{ marginTop: 20, display: 'flex', gap: 8 }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '9px 14px',
              borderRadius: 10,
              border: '1px solid #1d4ed8',
              background: '#2563eb',
              color: '#ffffff',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <a
            href="/"
            style={{
              padding: '9px 14px',
              borderRadius: 10,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#0f172a',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            Go to Overview
          </a>
        </div>
      </div>
    </div>
  );
}
