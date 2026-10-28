'use client';

import { useState, type FormEvent } from 'react';
import { CheckCircle2, CircleAlert, Globe2, Loader2, ShieldCheck } from 'lucide-react';
import { runAriveCredentialDiagnostic, runAriveEgressDiagnostic } from '@/app/actions/ariveDiagnosticActions';
import type { AriveCredentialDiagnostic, AriveEgressDiagnostic } from '@/lib/ariveDiagnostics';

function EgressResult({ result }: { result: AriveEgressDiagnostic }) {
  return <div className="space-y-3 text-sm">
    <p className="font-semibold">Measured from the portal server</p>
    <ul className="space-y-1">{result.samples.map((sample, index) => <li key={index} className="flex flex-wrap justify-between gap-2 rounded-lg border border-border px-3 py-2"><span>Connection {index + 1}</span><span className="font-mono">{sample.ip || sample.error || 'Unavailable'}</span></li>)}</ul>
    <p className="text-xs text-muted-foreground">Region: {result.region} · Runtime: {result.node} · Checked {result.checkedAt}</p>
    <p className="break-all text-xs text-muted-foreground">Deployment: {result.deployment}</p>
    <p className="text-xs text-muted-foreground">These are the source addresses observed by AWS’s IP checker. Arive’s logs are needed to confirm the address and filtering rule for its specific request.</p>
  </div>;
}

export function AriveDiagnosticsPanel() {
  const [busy, setBusy] = useState<'egress' | 'compare' | null>(null);
  const [error, setError] = useState('');
  const [egress, setEgress] = useState<AriveEgressDiagnostic | null>(null);
  const [comparison, setComparison] = useState<AriveCredentialDiagnostic | null>(null);

  async function checkEgress() {
    if (busy) return;
    setBusy('egress'); setError(''); setEgress(null);
    try {
      const result = await runAriveEgressDiagnostic();
      if (!result.success) { setError(result.error); return; }
      setEgress(result.data);
    } catch { setError('The network check could not finish. Please try again.'); }
    finally { setBusy(null); }
  }

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy('compare'); setError(''); setComparison(null);
    try {
      const result = await runAriveCredentialDiagnostic({
        clientId: String(data.get('clientId') || ''), secret: String(data.get('secret') || ''),
        apiKey: String(data.get('apiKey') || ''), comparisonCode: String(data.get('comparisonCode') || ''),
      });
      if (!result.success) { setError(result.error); return; }
      setComparison(result.data);
    } catch { setError('The comparison could not finish. Please try again.'); }
    finally { form.reset(); setBusy(null); }
  }

  return <div className="space-y-5">
    <section className="app-surface-card space-y-4">
      <div className="flex items-start gap-3"><Globe2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><div><h2 className="font-bold">1. Check outgoing IP addresses</h2><p className="mt-1 text-sm text-muted-foreground">Make three requests from Vercel to AWS’s IP checker. No Arive credentials are sent.</p></div></div>
      <button type="button" className="app-btn-secondary" disabled={busy !== null} onClick={() => void checkEgress()}>{busy === 'egress' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{busy === 'egress' ? 'Measuring outgoing IPs…' : 'Check outgoing IPs'}</button>
      {egress && <div aria-live="polite"><EgressResult result={egress} /></div>}
    </section>
    <section className="app-surface-card space-y-4">
      <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" /><div><h2 className="font-bold">2. Compare credentials and test authentication</h2><p className="mt-1 text-sm text-muted-foreground">Use the comparison code from the local test and enter the same current Arive credentials. The server compares protected fingerprints, then tests authentication only if every value matches.</p></div></div>
      <form autoComplete="off" onSubmit={event => void compare(event)}>
        <fieldset disabled={busy !== null} className="space-y-4">
          <label className="block text-sm font-medium">Credential comparison code<textarea name="comparisonCode" className="app-input mt-1 min-h-24 font-mono text-xs" required maxLength={2048} spellCheck={false} placeholder="Paste the comparison code from the local result" /></label>
          <div className="grid gap-3 md:grid-cols-3">{[{ name: 'clientId', label: 'Client ID' }, { name: 'secret', label: 'Client secret' }, { name: 'apiKey', label: 'API key' }].map(field => <label key={field.name} className="block text-sm font-medium">{field.label}<input name={field.name} type="password" autoComplete="new-password" className="app-input mt-1" required maxLength={4096} spellCheck={false} /></label>)}</div>
          <p className="text-xs text-muted-foreground">Credentials are used only for this test and cleared afterward. This does not save a connection, call loan APIs, or enable the pilot.</p>
          <button type="submit" className="app-btn-primary">{busy === 'compare' && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}{busy === 'compare' ? 'Comparing and testing…' : 'Compare and test — don’t save'}</button>
        </fieldset>
      </form>
      {comparison && <div className="space-y-4 border-t border-border pt-4" aria-live="polite">
        <ul className="space-y-2">{[{ key: 'clientId', label: 'Client ID' }, { key: 'secret', label: 'Client secret' }, { key: 'apiKey', label: 'API key' }, { key: 'request', label: 'Complete authentication payload' }].map(item => {
          const match = comparison.matches[item.key as keyof typeof comparison.matches];
          const Icon = match ? CheckCircle2 : CircleAlert;
          return <li key={item.key} className="flex items-center gap-2 text-sm"><Icon className={`h-4 w-4 shrink-0 ${match ? 'text-emerald-600' : 'text-red-600'}`} aria-hidden="true" /><strong>{item.label}:</strong> {match ? 'Matches local test' : 'Does not match local test'}</li>;
        })}</ul>
        <p className="text-sm font-medium">{comparison.authentication.message}</p>
        <EgressResult result={comparison.egress} />
      </div>}
    </section>
    {error && <p role="alert" className="app-surface-card text-sm text-red-700">{error}</p>}
  </div>;
}
