'use client';

import React from 'react';
import {
  Calendar,
  CheckCircle,
  ChevronDown,
  FileText,
  Trash2,
  Loader2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  deleteTask,
  reviewInitialDisclosureFigures,
  requestInfoFromLoanOfficer,
  respondToDisclosureRequest,
  updateTaskStatus,
} from '@/app/actions/taskActions';
import {
  createTaskAttachmentUploadUrl,
  finalizeTaskAttachment,
  getTaskAttachmentDownloadUrl,
} from '@/app/actions/attachmentActions';
import {
  DisclosureDecisionReason,
  Prisma,
  TaskAttachmentPurpose,
  TaskKind,
  TaskStatus,
  TaskWorkflowState,
  UserRole,
} from '@prisma/client';

const disclosureReasonOptions: Array<{
  value: DisclosureDecisionReason;
  label: string;
}> = [
  {
    value: DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES,
    label: 'Approve Initial Disclosures',
  },
  { value: DisclosureDecisionReason.MISSING_ITEMS, label: 'Missing Items' },
  { value: DisclosureDecisionReason.OTHER, label: 'Other' },
];

const qcReasonOptions: Array<{
  value: DisclosureDecisionReason;
  label: string;
}> = [
  { value: DisclosureDecisionReason.MISSING_ITEMS, label: 'Missing Items' },
  { value: DisclosureDecisionReason.OTHER, label: 'Other' },
];

const disclosureReasonLabel: Record<DisclosureDecisionReason, string> = {
  [DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES]:
    'Approve Initial Disclosures',
  [DisclosureDecisionReason.MISSING_ITEMS]: 'Missing Items',
  [DisclosureDecisionReason.OTHER]: 'Other',
};

const workflowStateLabel: Record<TaskWorkflowState, string> = {
  [TaskWorkflowState.NONE]: 'None',
  [TaskWorkflowState.WAITING_ON_LO]: 'Waiting on LO',
  [TaskWorkflowState.WAITING_ON_LO_APPROVAL]: 'Waiting on LO Approval',
  [TaskWorkflowState.READY_TO_COMPLETE]: 'Ready to Complete',
};

function getWorkflowChip(
  workflowState: TaskWorkflowState,
  reason: DisclosureDecisionReason | null
): { label: string; className: string } | null {
  if (workflowState === TaskWorkflowState.WAITING_ON_LO_APPROVAL) {
    return {
      label: 'Awaiting LO Approval',
      className: 'border-blue-200 bg-blue-50 text-blue-700',
    };
  }
  if (workflowState === TaskWorkflowState.WAITING_ON_LO) {
    return {
      label:
        reason === DisclosureDecisionReason.MISSING_ITEMS
          ? 'Missing Items from LO'
          : 'Waiting on LO Response',
      className: 'border-amber-200 bg-amber-50 text-amber-700',
    };
  }
  if (workflowState === TaskWorkflowState.READY_TO_COMPLETE) {
    return {
      label:
        reason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
          ? 'Ready to Complete'
          : 'LO Responded (Needs Review)',
      className:
        reason === DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-violet-200 bg-violet-50 text-violet-700',
    };
  }
  return null;
}

type Task = {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  dueDate: Date | null;
  kind: TaskKind | null;
  workflowState: TaskWorkflowState;
  disclosureReason: DisclosureDecisionReason | null;
  parentTaskId: string | null;
  loanOfficerApprovedAt: Date | null;
  submissionData?: Prisma.JsonValue | null;
  loan: {
    loanNumber: string;
    borrowerName: string;
    stage?: string;
  };
  assignedRole: string | null;
  attachments?: {
    id: string;
    filename: string;
    purpose: TaskAttachmentPurpose;
    createdAt: Date;
  }[];
};

export function TaskList({
  tasks,
  canDelete = false,
  currentRole,
}: {
  tasks: Task[];
  canDelete?: boolean;
  currentRole: string;
}) {
  const router = useRouter();
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const [uploadingId, setUploadingId] = React.useState<string | null>(null);
  const [expandedTaskId, setExpandedTaskId] = React.useState<string | null>(null);
  const [sendingToLoId, setSendingToLoId] = React.useState<string | null>(null);
  const [respondingId, setRespondingId] = React.useState<string | null>(null);
  const [disclosureReasonByTask, setDisclosureReasonByTask] = React.useState<
    Record<string, DisclosureDecisionReason>
  >({});
  const [disclosureMessageByTask, setDisclosureMessageByTask] = React.useState<
    Record<string, string>
  >({});
  const [loResponseByTask, setLoResponseByTask] = React.useState<
    Record<string, string>
  >({});

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    if (updatingId) return;
    setUpdatingId(taskId);
    // In a real app, we'd use optimistic UI here
    const result = await updateTaskStatus(taskId, newStatus);
    if (!result.success) {
      alert(result.error || 'Failed to update task.');
    }
    router.refresh();
    setUpdatingId(null);
  };

  const handleUploadProof = async (taskId: string, file: File) => {
    if (uploadingId) return;
    setUploadingId(taskId);

    try {
      const upload = await createTaskAttachmentUploadUrl({
        taskId,
        purpose: TaskAttachmentPurpose.PROOF,
        filename: file.name,
      });

      if (!upload.success || !upload.signedUrl || !upload.path) {
        alert(upload.error || 'Failed to create upload URL.');
        setUploadingId(null);
        return;
      }

      const put = await fetch(upload.signedUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
        body: file,
      });

      if (!put.ok) {
        console.error('Upload failed', await put.text());
        alert('Upload failed. Please try again.');
        setUploadingId(null);
        return;
      }

      const saved = await finalizeTaskAttachment({
        taskId,
        purpose: TaskAttachmentPurpose.PROOF,
        storagePath: upload.path,
        filename: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      });

      if (!saved.success) {
        alert(saved.error || 'Failed to save attachment.');
        setUploadingId(null);
        return;
      }

      router.refresh();
    } catch (error) {
      console.error(error);
      alert('Upload failed. Please try again.');
    } finally {
      setUploadingId(null);
    }
  };

  const handleViewAttachment = async (attachmentId: string) => {
    const result = await getTaskAttachmentDownloadUrl(attachmentId);
    if (!result.success) {
      alert(result.error || 'Failed to open attachment.');
      return;
    }
    window.open(result.url, '_blank', 'noopener,noreferrer');
  };

  const handleSendToLoanOfficer = async (task: Task) => {
    if (sendingToLoId) return;
    const reason =
      disclosureReasonByTask[task.id] ||
      DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
    const message = (disclosureMessageByTask[task.id] || '').trim();
    setSendingToLoId(task.id);
    const result = await requestInfoFromLoanOfficer(task.id, { reason, message });
    if (!result.success) {
      alert(result.error || 'Failed to send task to Loan Officer.');
      setSendingToLoId(null);
      return;
    }
    router.refresh();
    setSendingToLoId(null);
  };

  const handleLoanOfficerResponse = async (task: Task) => {
    if (respondingId) return;
    const response = (loResponseByTask[task.id] || '').trim();
    if (!response) {
      alert('Please add a response before sending this back to Disclosure.');
      return;
    }
    setRespondingId(task.id);
    const result = await respondToDisclosureRequest(task.id, response);
    if (!result.success) {
      alert(result.error || 'Failed to send response.');
      setRespondingId(null);
      return;
    }
    router.refresh();
    setRespondingId(null);
  };

  const handleLoanOfficerDisclosureReview = async (
    task: Task,
    decision: 'APPROVE' | 'REVISION_REQUIRED'
  ) => {
    if (respondingId) return;
    const response = (loResponseByTask[task.id] || '').trim();
    if (!response) {
      alert('Please add a response note before submitting your review.');
      return;
    }
    setRespondingId(task.id);
    const result = await reviewInitialDisclosureFigures({
      taskId: task.id,
      decision,
      message: response,
    });
    if (!result.success) {
      alert(result.error || 'Failed to submit review.');
      setRespondingId(null);
      return;
    }
    router.refresh();
    setRespondingId(null);
  };

  const handleDelete = async (taskId: string) => {
    if (deletingId) return;
    const confirmed = window.confirm('Delete this task? This cannot be undone.');
    if (!confirmed) return;
    
    setDeletingId(taskId);
    const result = await deleteTask(taskId);
    if (!result.success) {
      alert(result.error || 'Failed to delete task.');
      setDeletingId(null);
      return;
    }
    router.refresh();
    setDeletingId(null);
  };

  const isVaSubRole =
    currentRole === UserRole.VA_TITLE ||
    currentRole === UserRole.VA_HOI ||
    currentRole === UserRole.VA_PAYOFF ||
    currentRole === UserRole.VA_APPRAISAL;

  const isVaTaskKind = (kind: TaskKind | null) =>
    kind === TaskKind.VA_TITLE ||
    kind === TaskKind.VA_HOI ||
    kind === TaskKind.VA_PAYOFF ||
    kind === TaskKind.VA_APPRAISAL;

  const isDisclosureRole = currentRole === UserRole.DISCLOSURE_SPECIALIST;
  const isQcRole = currentRole === UserRole.QC;
  const isDisclosureSubmissionTask = (task: Task) =>
    task.kind === TaskKind.SUBMIT_DISCLOSURES;
  const isQcSubmissionTask = (task: Task) => task.kind === TaskKind.SUBMIT_QC;
  const isLoResponseTask = (task: Task) => task.kind === TaskKind.LO_NEEDS_INFO;

  if (tasks.length === 0) {
    return (
      <div className="text-center py-12 bg-white rounded-xl border border-slate-200">
        <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-6 h-6 text-slate-400" />
        </div>
        <h3 className="text-lg font-medium text-slate-900">All caught up!</h3>
        <p className="text-slate-500 mt-1">No pending tasks in your queue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {tasks.map((task) => {
        const isExpanded = expandedTaskId === task.id;
        const selectedReason =
          disclosureReasonByTask[task.id] ||
          DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
        const selectedQcReason =
          disclosureReasonByTask[task.id] || DisclosureDecisionReason.MISSING_ITEMS;
        const shouldShowProofUploader =
          task.status !== 'COMPLETED' &&
          ((isVaSubRole && isVaTaskKind(task.kind)) ||
            (isDisclosureRole && isDisclosureSubmissionTask(task)) ||
            (isQcRole && isQcSubmissionTask(task)));
        const proofCount =
          task.attachments?.filter((att) => att.purpose === TaskAttachmentPurpose.PROOF)
            .length || 0;
        const requiresProofForCompletion =
          isVaTaskKind(task.kind) ||
          isDisclosureSubmissionTask(task) ||
          isQcSubmissionTask(task);
        const canCompleteTask = !requiresProofForCompletion || proofCount > 0;
        const isLoTaskForCurrentLoanOfficer =
          currentRole === UserRole.LOAN_OFFICER && isLoResponseTask(task);
        const isApprovalReviewTask =
          isLoTaskForCurrentLoanOfficer &&
          task.disclosureReason ===
            DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES;
        const parsedSubmissionData =
          task.submissionData &&
          typeof task.submissionData === 'object' &&
          !Array.isArray(task.submissionData)
            ? task.submissionData
            : null;
        const workflowChip = getWorkflowChip(task.workflowState, task.disclosureReason);
        const submissionDataRows = parsedSubmissionData
          ? Object.entries(parsedSubmissionData).filter(([, value]) => {
              return (
                value !== null &&
                (typeof value === 'string' ||
                  typeof value === 'number' ||
                  typeof value === 'boolean')
              );
            })
          : [];

        return (
        <div 
          key={task.id} 
          className="bg-white p-4 rounded-xl border border-slate-200 hover:shadow-md transition-shadow flex items-start justify-between gap-4 group"
        >
          <div className="flex items-start space-x-4">
            <div className={`mt-1 p-2 rounded-lg ${
              task.status === 'COMPLETED' ? 'bg-green-100 text-green-600' : 
              task.status === 'IN_PROGRESS' ? 'bg-blue-100 text-blue-600' : 
              'bg-slate-100 text-slate-500'
            }`}>
              <FileText className="w-5 h-5" />
            </div>
            
            <div>
              <h3 className={`font-medium text-slate-900 ${task.status === 'COMPLETED' ? 'line-through text-slate-500' : ''}`}>
                {task.title}
              </h3>
              <div className="flex items-center space-x-3 mt-1 text-sm text-slate-500">
                <span className="font-medium text-slate-700">{task.loan.borrowerName}</span>
                <span>•</span>
                <span>{task.loan.loanNumber}</span>
                {task.loan.stage && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center rounded-full bg-blue-50 text-blue-700 px-2 py-0.5 text-xs font-medium border border-blue-100">
                      {task.loan.stage.replace(/_/g, ' ')}
                    </span>
                  </>
                )}
                {task.assignedRole && (
                  <>
                    <span>•</span>
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-slate-600">
                      {task.assignedRole.replace(/_/g, ' ')}
                    </span>
                  </>
                )}
              </div>
              {task.description && (
                <p className="text-sm text-slate-400 mt-2">{task.description}</p>
              )}

              {task.disclosureReason && (
                <p className="mt-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                  Reason: {disclosureReasonLabel[task.disclosureReason]}
                </p>
              )}

              {workflowChip ? (
                <p
                  className={`mt-2 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${workflowChip.className}`}
                >
                  {workflowChip.label}
                </p>
              ) : task.workflowState !== TaskWorkflowState.NONE ? (
                <p className="mt-2 inline-flex items-center rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-xs font-semibold text-indigo-700">
                  {workflowStateLabel[task.workflowState]}
                </p>
              ) : null}

              {(task.attachments?.length || 0) > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {task.attachments!.map((att) => (
                    <button
                      key={att.id}
                      onClick={() => handleViewAttachment(att.id)}
                      className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                      type="button"
                    >
                      <FileText className="h-3.5 w-3.5 text-slate-500" />
                      <span className="max-w-[220px] truncate">{att.filename}</span>
                    </button>
                  ))}
                </div>
              )}

              {shouldShowProofUploader && (
                <div className="mt-3">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-1">
                      Proof required
                    </span>
                    <span className="text-slate-500">
                      Upload PDF/Image before completing or sending this task.
                    </span>
                  </label>
                  <div className="mt-2 flex items-center gap-2">
                    <input
                      type="file"
                      accept="application/pdf,image/*"
                      disabled={!!uploadingId}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.currentTarget.value = '';
                        if (!f) return;
                        void handleUploadProof(task.id, f);
                      }}
                      className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-slate-700 hover:file:bg-slate-200 disabled:opacity-60"
                    />
                    {uploadingId === task.id && (
                      <div className="inline-flex items-center gap-2 text-xs font-semibold text-slate-500">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isDisclosureRole &&
                isDisclosureSubmissionTask(task) &&
                task.status !== 'COMPLETED' && (
                  <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      Disclosure Action
                    </p>
                    <select
                      value={selectedReason}
                      onChange={(event) =>
                        setDisclosureReasonByTask((prev) => ({
                          ...prev,
                          [task.id]: event.target.value as DisclosureDecisionReason,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                    >
                      {disclosureReasonOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <textarea
                      value={disclosureMessageByTask[task.id] || ''}
                      onChange={(event) =>
                        setDisclosureMessageByTask((prev) => ({
                          ...prev,
                          [task.id]: event.target.value,
                        }))
                      }
                      placeholder="Add context for the LO (what changed, what is missing, next steps)..."
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm min-h-20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleSendToLoanOfficer(task)}
                      disabled={sendingToLoId === task.id || proofCount < 1}
                      className="app-btn-secondary disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {sendingToLoId === task.id && (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                      {selectedReason ===
                      DisclosureDecisionReason.APPROVE_INITIAL_DISCLOSURES
                        ? 'Send to LO for Approval'
                        : 'Send Back to LO'}
                    </button>
                  </div>
                )}

              {isQcRole && isQcSubmissionTask(task) && task.status !== 'COMPLETED' && (
                <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/70 p-3 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    QC Action
                  </p>
                  <select
                    value={selectedQcReason}
                    onChange={(event) =>
                      setDisclosureReasonByTask((prev) => ({
                        ...prev,
                        [task.id]: event.target.value as DisclosureDecisionReason,
                      }))
                    }
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                  >
                    {qcReasonOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <textarea
                    value={disclosureMessageByTask[task.id] || ''}
                    onChange={(event) =>
                      setDisclosureMessageByTask((prev) => ({
                        ...prev,
                        [task.id]: event.target.value,
                      }))
                    }
                    placeholder="Add context for LO (what is missing or what needs correction)..."
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm min-h-20"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSendToLoanOfficer(task)}
                      disabled={sendingToLoId === task.id || proofCount < 1}
                    className="app-btn-secondary disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {sendingToLoId === task.id && (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    )}
                    Send Back to LO
                  </button>
                </div>
              )}

              {isLoTaskForCurrentLoanOfficer && task.status !== 'COMPLETED' && (
                <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50/60 p-3 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                    Loan Officer Response
                  </p>
                  <textarea
                    value={loResponseByTask[task.id] || ''}
                    onChange={(event) =>
                      setLoResponseByTask((prev) => ({
                        ...prev,
                        [task.id]: event.target.value,
                      }))
                    }
                    placeholder="Describe your response and what you updated for Disclosure..."
                    className="w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm min-h-20"
                  />
                  {isApprovalReviewTask ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          void handleLoanOfficerDisclosureReview(task, 'APPROVE')
                        }
                        disabled={respondingId === task.id}
                        className="app-btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {respondingId === task.id && (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        )}
                        Approve Figures
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void handleLoanOfficerDisclosureReview(
                            task,
                            'REVISION_REQUIRED'
                          )
                        }
                        disabled={respondingId === task.id}
                        className="app-btn-secondary disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {respondingId === task.id && (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        )}
                        Request Revision
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void handleLoanOfficerResponse(task)}
                      disabled={respondingId === task.id}
                      className="app-btn-primary disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {respondingId === task.id && (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      )}
                      Respond to Disclosure
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4">
                <button
                  type="button"
                  onClick={() =>
                    setExpandedTaskId((prev) => (prev === task.id ? null : task.id))
                  }
                  className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-900"
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                  {isExpanded ? 'Hide Details' : 'View Details'}
                </button>
              </div>

              {isExpanded && (
                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  {submissionDataRows.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-2">
                      {submissionDataRows.map(([key, value]) => (
                        <div key={key} className="text-xs">
                          <p className="font-semibold uppercase tracking-wide text-slate-500">
                            {key}
                          </p>
                          <p className="text-slate-700 break-words">{String(value)}</p>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      No additional submitted fields were captured for this task.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end space-y-3">
            {task.dueDate && (
              <div className={`flex items-center text-xs font-medium ${
                new Date(task.dueDate) < new Date() && task.status !== 'COMPLETED' 
                  ? 'text-red-600 bg-red-50 px-2 py-1 rounded' 
                  : 'text-slate-500'
              }`}>
                <Calendar className="w-3 h-3 mr-1" />
                {new Date(task.dueDate).toLocaleDateString()}
              </div>
            )}

            <div className="flex items-center space-x-2">
              {!isLoTaskForCurrentLoanOfficer && task.status !== 'COMPLETED' && (
                <button 
                  onClick={() => handleStatusChange(task.id, 'COMPLETED')}
                  disabled={!!updatingId || !canCompleteTask}
                  className="inline-flex h-9 items-center px-3 bg-green-50 text-green-700 text-sm font-medium rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {updatingId === task.id ? (
                    <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle className="w-4 h-4 mr-1.5" />
                  )}
                  {updatingId === task.id
                    ? 'Saving...'
                    : !canCompleteTask
                    ? 'Upload Proof First'
                    : 'Complete'}
                </button>
              )}
              
              {task.status === 'PENDING' && (
                <button 
                  onClick={() => handleStatusChange(task.id, 'IN_PROGRESS')}
                  disabled={!!updatingId}
                  className="inline-flex h-9 items-center px-3 text-slate-500 text-sm font-medium hover:text-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed gap-2"
                >
                  {updatingId === task.id && <Loader2 className="w-3 h-3 animate-spin" />}
                  Start
                </button>
              )}
              {canDelete && (
                <button
                  onClick={() => handleDelete(task.id)}
                  disabled={!!deletingId}
                  className="inline-flex h-9 w-9 items-center justify-center text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  aria-label="Delete task"
                >
                  {deletingId === task.id ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}
