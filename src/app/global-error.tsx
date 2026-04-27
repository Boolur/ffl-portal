'use client';

// Root-level error boundary. Catches crashes that happen in the root
// layout itself (which `error.tsx` cannot reach). Without this file,
// a server error in the root layout bubbles up as Next's opaque
// "An error occurred in the Server Components render" digest with no
// way to recover short of a hard refresh. With this file, the user at
// least gets the digest (so they can send it to us) and a retry button.

import { useEffect } from 'react';

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // Surface it in the browser console too — `error.digest` is the
    // key we'd need to trace it server-side in Vercel logs.
    // eslint-disable-next-line no-console
    console.error('[global-error]', {
      message: error?.message,
      digest: error?.digest,
      stack: error?.stack,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
          padding: '24px',
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
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>
            Something went wrong loading the portal
          </h1>
          <p style={{ marginTop: 12, color: '#475569', lineHeight: 1.55 }}>
            The page hit an unexpected error. Most of the time this is caused by
            a stale browser cache after a deploy. Try the steps below in order.
          </p>

          <ol
            style={{
              marginTop: 16,
              paddingLeft: 20,
              color: '#334155',
              lineHeight: 1.6,
            }}
          >
            <li>
              Hard refresh the page: <strong>Ctrl + Shift + R</strong> (Windows) or{' '}
              <strong>Cmd + Shift + R</strong> (Mac).
            </li>
            <li>If that doesn&apos;t fix it, open the site in an Incognito / Private window.</li>
            <li>If it still fails, copy the digest below and send it to your admin.</li>
          </ol>

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
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') window.location.href = '/';
              }}
              style={{
                padding: '9px 14px',
                borderRadius: 10,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#0f172a',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Go to Overview
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
