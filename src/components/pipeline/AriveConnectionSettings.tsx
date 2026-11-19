'use client';
import { useState } from 'react';
import { getAriveConnectionSettings } from '@/app/actions/submissionPilotActions';
import { ArivePilotConnection } from './ArivePilotPanel';
export function AriveConnectionSettings({ initialConfigured }: { initialConfigured: boolean }) {
  const [configured, setConfigured] = useState(initialConfigured);
  return <ArivePilotConnection configured={configured} canConfigure onChanged={async () => { const r = await getAriveConnectionSettings(); if (!r.success) throw new Error(r.error); setConfigured(r.data.configured); }} />;
}
