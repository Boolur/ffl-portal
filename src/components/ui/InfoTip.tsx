'use client';

import React, { useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';

/**
 * Tooltip with a help icon that renders in a fixed position above the icon,
 * so it escapes any overflow-hidden parent (like modals).
 */
export function InfoTip({ text, width = 224 }: { text: string; width?: number }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const iconRef = useRef<HTMLSpanElement>(null);

  const open = () => {
    clearTimeout(timeout.current);
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      let left = rect.left + rect.width / 2 - width / 2;
      if (left < 8) left = 8;
      if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
      setPos({ top: rect.top - 8, left });
    }
  };
  const close = () => {
    timeout.current = setTimeout(() => setPos(null), 150);
  };

  return (
    <span
      ref={iconRef}
      className="inline-flex ml-1 align-middle"
      onMouseEnter={open}
      onMouseLeave={close}
    >
      <HelpCircle className="h-3.5 w-3.5 text-slate-400 hover:text-slate-600 cursor-help transition-colors" />
      {pos && (
        <span
          className="fixed z-[9999] rounded-lg border border-slate-200 bg-slate-800 px-3 py-2 text-[11px] font-normal normal-case tracking-normal leading-relaxed text-white shadow-lg"
          style={{ top: pos.top, left: pos.left, width, transform: 'translateY(-100%)' }}
          onMouseEnter={() => clearTimeout(timeout.current)}
          onMouseLeave={close}
        >
          {text}
        </span>
      )}
    </span>
  );
}
