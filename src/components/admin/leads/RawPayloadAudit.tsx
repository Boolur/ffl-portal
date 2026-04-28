'use client';

/**
 * Read-only diagnostic that shows exactly how the Lead Mailbox bridge
 * interpreted the inbound payload for this lead:
 *
 *   Applied    - payload keys that wrote to a column on the Lead row
 *   Dropped    - keys whose value was an unresolved LMB placeholder
 *                (e.g. the literal string "{phys_address}") so the bridge
 *                intentionally ignored them. These are the #1 reason
 *                address fields come in blank for a given vendor.
 *   Unmapped   - keys with no entry in LEAD_MAILBOX_FIELD_MAP (nothing
 *                broke - this is just informational so admins can tell
 *                us "hey, we also send X"). Collapsed by default since
 *                it's noisy.
 *
 * Pure client-side: we classify rawPayload against the bridge's field
 * map without a round trip. When the user fixes the LMB template and
 * resends a batch, opening the Lead Detail modal on any corrected lead
 * immediately shows the previously-dropped fields under "Applied".
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, HelpCircle } from 'lucide-react';
import { LEAD_MAILBOX_FIELD_MAP } from '@/lib/leadMailboxBridge';

type Props = {
  rawPayload: unknown;
  // Passed in so the audit can tell the user the specific column a
  // dropped key would have populated (e.g. "would map to propertyAddress").
  // If a column is currently blank on the Lead we flag the row more
  // aggressively.
  currentValues?: Record<string, string | null | undefined>;
};

type EntryKind = 'applied' | 'dropped' | 'unmapped';

type Entry = {
  kind: EntryKind;
  key: string;
  value: string;
  targetField?: string;
  // true iff `targetField` is currently blank on the Lead - i.e. fixing
  // this row would actually recover data.
  targetBlank?: boolean;
};

const PLACEHOLDER_PATTERN = /^\{[A-Za-z0-9_]+\}$/;

function classifyValue(raw: unknown): {
  str: string;
  isPlaceholder: boolean;
  isEmpty: boolean;
} {
  if (raw == null) return { str: '', isPlaceholder: false, isEmpty: true };
  if (typeof raw === 'object') {
    // Nested object / array - not something the bridge handles at this
    // layer. Show the JSON so admins can see what was sent.
    return {
      str: JSON.stringify(raw),
      isPlaceholder: false,
      isEmpty: false,
    };
  }
  const str = String(raw).trim();
  if (!str) return { str: '', isPlaceholder: false, isEmpty: true };
  return {
    str,
    isPlaceholder: PLACEHOLDER_PATTERN.test(str),
    isEmpty: false,
  };
}

export function RawPayloadAudit({ rawPayload, currentValues }: Props) {
  const [unmappedOpen, setUnmappedOpen] = useState(false);

  const entries = useMemo<Entry[]>(() => {
    if (!rawPayload || typeof rawPayload !== 'object') return [];
    const out: Entry[] = [];
    for (const [key, rawValue] of Object.entries(
      rawPayload as Record<string, unknown>
    )) {
      const target = LEAD_MAILBOX_FIELD_MAP[key];
      const { str, isPlaceholder, isEmpty } = classifyValue(rawValue);
      if (!target) {
        out.push({ kind: 'unmapped', key, value: str });
        continue;
      }
      // Key is in the bridge map but value was unusable -> it was dropped.
      if (isPlaceholder || isEmpty) {
        const currentVal = currentValues?.[target];
        out.push({
          kind: 'dropped',
          key,
          value: isPlaceholder ? str : '(empty)',
          targetField: target,
          targetBlank: !currentVal,
        });
        continue;
      }
      out.push({
        kind: 'applied',
        key,
        value: str,
        targetField: target,
      });
    }
    return out;
  }, [rawPayload, currentValues]);

  const applied = entries.filter((e) => e.kind === 'applied');
  const dropped = entries.filter((e) => e.kind === 'dropped');
  const unmapped = entries.filter((e) => e.kind === 'unmapped');

  if (entries.length === 0) {
    return (
      <div className="text-xs text-slate-400 px-4 py-3">
        No raw payload stored for this lead.
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-100">
      {dropped.length > 0 && (
        <Group
          icon={AlertTriangle}
          tone="amber"
          title={`Dropped - unresolved placeholder (${dropped.length})`}
          hint="These values looked like LMB placeholders (e.g. {phys_address}) so the bridge ignored them. Fix the LMB template's placeholder names to recover these fields."
        >
          {dropped.map((e) => (
            <Row
              key={`d-${e.key}`}
              keyName={e.key}
              value={e.value}
              target={e.targetField}
              rightBadge={
                e.targetBlank ? (
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded ring-1 ring-amber-200">
                    {e.targetField} is blank
                  </span>
                ) : null
              }
              tone="amber"
            />
          ))}
        </Group>
      )}

      {applied.length > 0 && (
        <Group
          icon={CheckCircle2}
          tone="emerald"
          title={`Applied (${applied.length})`}
          hint="These keys mapped cleanly to a Lead column."
        >
          {applied.map((e) => (
            <Row
              key={`a-${e.key}`}
              keyName={e.key}
              value={e.value}
              target={e.targetField}
              tone="emerald"
            />
          ))}
        </Group>
      )}

      {unmapped.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setUnmappedOpen((o) => !o)}
            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-slate-50 transition-colors"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 text-slate-400 transition-transform ${
                unmappedOpen ? 'rotate-90' : ''
              }`}
            />
            <HelpCircle className="h-3.5 w-3.5 text-slate-400" />
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Unmapped ({unmapped.length})
            </span>
            <span className="text-[11px] text-slate-400 ml-1">
              keys we don&apos;t currently recognize - informational only
            </span>
          </button>
          {unmappedOpen && (
            <div className="pb-2">
              {unmapped.map((e) => (
                <Row
                  key={`u-${e.key}`}
                  keyName={e.key}
                  value={e.value}
                  tone="slate"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  icon: Icon,
  tone,
  title,
  hint,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  tone: 'emerald' | 'amber';
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const toneClasses =
    tone === 'amber'
      ? 'text-amber-700 bg-amber-50/60'
      : 'text-emerald-700 bg-emerald-50/60';
  return (
    <div>
      <div className={`flex items-start gap-2 px-4 py-2.5 ${toneClasses}`}>
        <Icon className="h-4 w-4 shrink-0 mt-0.5" />
        <div>
          <div className="text-xs font-bold uppercase tracking-wider">
            {title}
          </div>
          <div className="text-[11px] mt-0.5 opacity-80">{hint}</div>
        </div>
      </div>
      <div className="py-1">{children}</div>
    </div>
  );
}

function Row({
  keyName,
  value,
  target,
  tone,
  rightBadge,
}: {
  keyName: string;
  value: string;
  target?: string;
  tone: 'emerald' | 'amber' | 'slate';
  rightBadge?: React.ReactNode;
}) {
  const valueTone =
    tone === 'amber'
      ? 'text-amber-800'
      : tone === 'emerald'
      ? 'text-slate-700'
      : 'text-slate-500';
  return (
    <div className="flex items-start gap-3 px-4 py-1.5 text-sm">
      <code className="font-mono text-[11px] font-semibold text-slate-700 whitespace-nowrap">
        {keyName}
      </code>
      {target && (
        <span className="text-[11px] text-slate-400 whitespace-nowrap">
          &rarr; {target}
        </span>
      )}
      <span
        className={`flex-1 min-w-0 text-[12px] truncate ${valueTone}`}
        title={value}
      >
        {value || <span className="italic text-slate-400">(empty)</span>}
      </span>
      {rightBadge}
    </div>
  );
}
