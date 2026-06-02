'use client';

import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  TaskBucketsBoard,
  type TaskBucketsBoardHandle,
} from '@/components/tasks/TaskBucketsBoard';
import type { Task } from '@/components/tasks/TaskList';

type BucketConfig = {
  id: string;
  label: string;
  chipLabel: string;
  chipClassName: string;
  isCompleted?: boolean;
  tasks: Task[];
};

export function TaskDeskSection({
  title,
  icon,
  iconClassName,
  buckets,
  activeBucketId,
  canDelete,
  currentRole,
  currentUserId,
  jrAssigneeOptions = [],
  initialFocusedTaskId,
  bucketScrollMode = 'auto',
  fixedScrollClassName = 'max-h-[520px] overflow-y-auto pr-1',
  enableBatchDelete = false,
}: {
  title: string;
  icon: React.ReactNode;
  iconClassName: string;
  buckets: BucketConfig[];
  activeBucketId: string | null;
  canDelete: boolean;
  currentRole: string;
  currentUserId?: string;
  jrAssigneeOptions?: Array<{ id: string; name: string }>;
  initialFocusedTaskId?: string | null;
  bucketScrollMode?: 'auto' | 'fixed';
  fixedScrollClassName?: string;
  enableBatchDelete?: boolean;
}) {
  const boardRef = useRef<TaskBucketsBoardHandle | null>(null);
  const [collapseSummary, setCollapseSummary] = useState({
    total: buckets.length,
    collapsed: 0,
  });

  const allCollapsed = useMemo(() => {
    return collapseSummary.total > 0 && collapseSummary.collapsed === collapseSummary.total;
  }, [collapseSummary.collapsed, collapseSummary.total]);

  return (
    <section>
      <div className="mb-2">
        <h2 className="flex flex-wrap items-center gap-3 text-xl font-bold text-slate-900">
          <span
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg ring-1 ${iconClassName}`}
          >
            {icon}
          </span>
          {title}
          <button
            type="button"
            onClick={() => boardRef.current?.setAllBucketsCollapsed(!allCollapsed)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            aria-label={allCollapsed ? `Expand ${title}` : `Collapse ${title}`}
            title={allCollapsed ? `Expand ${title}` : `Collapse ${title}`}
          >
            {allCollapsed ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronUp className="h-4 w-4" />
            )}
          </button>
        </h2>
      </div>
      <TaskBucketsBoard
        ref={boardRef}
        buckets={buckets}
        activeBucketId={activeBucketId}
        canDelete={canDelete}
        currentRole={currentRole}
        currentUserId={currentUserId}
        jrAssigneeOptions={jrAssigneeOptions}
        initialFocusedTaskId={initialFocusedTaskId}
        bucketScrollMode={bucketScrollMode}
        fixedScrollClassName={fixedScrollClassName}
        onCollapseSummaryChange={setCollapseSummary}
        enableBatchDelete={enableBatchDelete}
      />
    </section>
  );
}
