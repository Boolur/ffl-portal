'use client';

import React from 'react';
import { useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Inbox,
  Loader2,
  Paperclip,
  RefreshCw,
  Send,
} from 'lucide-react';
import { SupportAttachmentPurpose, SupportConversationStatus, SupportDesk, UserRole } from '@prisma/client';
import {
  escalateSupportConversation,
  getSupportAttachmentDownloadUrl,
  getSupportConversation,
  getSupportInbox,
  sendSupportMessage,
  updateSupportConversationStatus,
} from '@/app/actions/supportChatActions';

type SupportConversationItem = {
  id: string;
  desk: SupportDesk;
  deskLabel: string;
  status: SupportConversationStatus;
  statusLabel: string;
  subject: string;
  requesterId: string;
  assignedUserId: string | null;
  escalated: boolean;
  requester?: { id: string; name: string; email: string } | null;
  assignedUser?: { id: string; name: string; email: string } | null;
  lender: string | null;
  loanType: string | null;
  propertyState: string | null;
  lastMessageAt: string;
  unreadCount: number;
  messages: Array<{
    id: string;
    authorId: string;
    body: string;
    createdAt: string;
    author: { id: string; name: string; email: string; role: UserRole };
  }>;
  attachments: Array<{
    id: string;
    purpose: SupportAttachmentPurpose;
    filename: string;
    contentType: string;
    sizeBytes: number;
    createdAt: string;
    uploadedBy: { id: string; name: string; email: string };
  }>;
};

const DESK_FILTERS = [
  { value: 'ALL', label: 'All Desks' },
  { value: SupportDesk.SCENARIO, label: 'Scenario' },
  { value: SupportDesk.PRICING, label: 'Pricing' },
  { value: SupportDesk.HELP, label: 'Help' },
] as const;

const STATUS_FILTERS = [
  { value: 'ALL', label: 'All Statuses' },
  { value: SupportConversationStatus.WAITING_ON_STAFF, label: 'Waiting on Staff' },
  { value: SupportConversationStatus.WAITING_ON_REQUESTER, label: 'Waiting on Requester' },
  { value: SupportConversationStatus.OPEN, label: 'Open' },
  { value: SupportConversationStatus.RESOLVED, label: 'Resolved' },
] as const;

function formatDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STAFF_MESSAGE_TONES = [
  { bubble: 'bg-blue-600 text-white', meta: 'text-blue-100' },
  { bubble: 'bg-sky-600 text-white', meta: 'text-sky-100' },
  { bubble: 'bg-indigo-600 text-white', meta: 'text-indigo-100' },
  { bubble: 'bg-cyan-700 text-white', meta: 'text-cyan-100' },
  { bubble: 'bg-violet-600 text-white', meta: 'text-violet-100' },
] as const;

function staffToneFor(authorId: string) {
  const hash = Array.from(authorId).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return STAFF_MESSAGE_TONES[hash % STAFF_MESSAGE_TONES.length];
}

function getLastStaffResponder(conversation: SupportConversationItem) {
  return [...conversation.messages]
    .reverse()
    .find((message) => message.author.role !== UserRole.LOAN_OFFICER && message.author.role !== UserRole.LOA)
    ?.author.name;
}

export function SupportInbox() {
  const searchParams = useSearchParams();
  const initialConversationId = searchParams.get('conversationId');
  const [conversations, setConversations] = React.useState<SupportConversationItem[]>([]);
  const [selectedConversationId, setSelectedConversationId] = React.useState<string | null>(initialConversationId);
  const [selectedConversation, setSelectedConversation] = React.useState<SupportConversationItem | null>(null);
  const [desk, setDesk] = React.useState<SupportDesk | 'ALL'>('ALL');
  const [status, setStatus] = React.useState<SupportConversationStatus | 'ALL'>('ALL');
  const [resolvedExpanded, setResolvedExpanded] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const [reply, setReply] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [pendingAction, setPendingAction] = React.useState<'escalate' | 'resolve' | null>(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const loadInbox = React.useCallback(async (showLoader = false) => {
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const result = await getSupportInbox({ desk, status, search });
      if (!result.success) {
        setError(result.error || 'Unable to load support inbox.');
        return;
      }
      setConversations(result.conversations as SupportConversationItem[]);
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [desk, search, status]);

  const openConversation = React.useCallback(async (conversationId: string, showLoader = true) => {
    setSelectedConversationId(conversationId);
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const result = await getSupportConversation(conversationId);
      if (!result.success) {
        setError(result.error || 'Unable to open support request.');
        return;
      }
      setSelectedConversation(result.conversation as SupportConversationItem);
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, ...(result.conversation as SupportConversationItem), unreadCount: 0 }
            : conversation
        )
      );
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadInbox(true);
  }, [loadInbox]);

  React.useEffect(() => {
    if (!initialConversationId) return;
    void openConversation(initialConversationId, true);
  }, [initialConversationId, openConversation]);

  React.useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadInbox(false);
      if (selectedConversationId) void openConversation(selectedConversationId, false);
    }, 30000);
    return () => window.clearInterval(interval);
  }, [loadInbox, openConversation, selectedConversationId]);

  const handleReply = async () => {
    if (!selectedConversationId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await sendSupportMessage({
        conversationId: selectedConversationId,
        body: reply,
      });
      if (!result.success) {
        setError(result.error || 'Unable to send reply.');
        return;
      }
      setReply('');
      setSelectedConversation(result.conversation as SupportConversationItem);
      await loadInbox(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (nextStatus: SupportConversationStatus) => {
    if (!selectedConversationId || submitting) return;
    setSubmitting(true);
    if (nextStatus === SupportConversationStatus.RESOLVED) setPendingAction('resolve');
    setError(null);
    try {
      const result = await updateSupportConversationStatus({
        conversationId: selectedConversationId,
        status: nextStatus,
      });
      if (!result.success) {
        setError(result.error || 'Unable to update status.');
        return;
      }
      setSelectedConversation(result.conversation as SupportConversationItem);
      await loadInbox(false);
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  };

  const handleEscalate = async () => {
    if (!selectedConversationId || submitting) return;
    setSubmitting(true);
    setPendingAction('escalate');
    setError(null);
    try {
      const result = await escalateSupportConversation(selectedConversationId);
      if (!result.success) {
        setError(result.error || 'Unable to escalate request.');
        return;
      }
      setSelectedConversation(result.conversation as SupportConversationItem);
      await loadInbox(false);
    } finally {
      setSubmitting(false);
      setPendingAction(null);
    }
  };

  const handleDownloadAttachment = async (attachmentId: string) => {
    setDownloadingAttachmentId(attachmentId);
    setError(null);
    try {
      const result = await getSupportAttachmentDownloadUrl(attachmentId);
      if (!result.success || !result.url) {
        setError(result.error || 'Unable to open attachment.');
        return;
      }
      window.open(result.url, '_blank', 'noopener,noreferrer');
    } finally {
      setDownloadingAttachmentId(null);
    }
  };

  const activeConversations = conversations.filter(
    (conversation) => conversation.status !== SupportConversationStatus.RESOLVED
  );
  const resolvedConversations = conversations.filter(
    (conversation) => conversation.status === SupportConversationStatus.RESOLVED
  );
  const showResolvedTasks = resolvedExpanded || status === SupportConversationStatus.RESOLVED;

  return (
    <div className="grid gap-4 xl:grid-cols-[360px_minmax(0,1fr)]">
      <section className="app-surface-card overflow-hidden">
        <div className="border-b border-slate-200 bg-slate-50/70 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                Request Queue
              </h2>
              <p className="text-xs text-slate-500">{conversations.length} visible requests</p>
            </div>
            <button
              type="button"
              onClick={() => void loadInbox(true)}
              className="app-icon-btn"
              aria-label="Refresh support inbox"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search requester, subject, lender"
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
            <div className="grid grid-cols-2 gap-2">
              <select
                value={desk}
                onChange={(event) => setDesk(event.target.value as SupportDesk | 'ALL')}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {DESK_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value as SupportConversationStatus | 'ALL')}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                {STATUS_FILTERS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {error && (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
            {error}
          </div>
        )}
        {loading && (
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        )}

        <div className="max-h-[calc(100vh-19rem)] overflow-y-auto">
          {activeConversations.map((conversation) => {
            const active = conversation.id === selectedConversationId;
            return (
              <QueueConversationButton
                key={conversation.id}
                conversation={conversation}
                active={active}
                onOpen={() => void openConversation(conversation.id)}
              />
            );
          })}
          {activeConversations.length === 0 && resolvedConversations.length === 0 && (
            <div className="flex flex-col items-center justify-center px-5 py-12 text-center text-slate-500">
              <Inbox className="mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm font-semibold">No support requests match this view.</p>
            </div>
          )}
          {resolvedConversations.length > 0 && (
            <div className="border-t border-slate-200 bg-slate-50/80">
              <button
                type="button"
                onClick={() => setResolvedExpanded((expanded) => !expanded)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-slate-600 hover:bg-slate-100"
              >
                <span className="flex items-center gap-2">
                  {showResolvedTasks ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  Resolved Tasks
                </span>
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-700">
                  {resolvedConversations.length}
                </span>
              </button>
              {showResolvedTasks &&
                resolvedConversations.map((conversation) => {
                  const active = conversation.id === selectedConversationId;
                  return (
                    <QueueConversationButton
                      key={conversation.id}
                      conversation={conversation}
                      active={active}
                      onOpen={() => void openConversation(conversation.id)}
                    />
                  );
                })}
            </div>
          )}
        </div>
      </section>

      <section className="app-surface-card min-h-[640px] overflow-hidden">
        {!selectedConversation ? (
          <div className="flex h-full min-h-[640px] flex-col items-center justify-center px-6 text-center text-slate-500">
            <MessagePlaceholder />
          </div>
        ) : (
          <div className="flex h-full min-h-[640px] flex-col">
            <div className="border-b border-slate-200 bg-white p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700">
                    {selectedConversation.deskLabel}
                  </p>
                  <h2 className="mt-1 text-xl font-extrabold text-slate-900">
                    {selectedConversation.subject}
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {selectedConversation.requester?.name} · {selectedConversation.requester?.email}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedConversation.lender && <ContextChip label={`Lender: ${selectedConversation.lender}`} />}
                    {selectedConversation.loanType && <ContextChip label={`Loan: ${selectedConversation.loanType}`} />}
                    {selectedConversation.propertyState && <ContextChip label={`State: ${selectedConversation.propertyState}`} />}
                  </div>
                </div>
                <div className="flex flex-col gap-2 lg:min-w-[360px] lg:items-end">
                  <div className="flex flex-wrap justify-start gap-2 lg:justify-end">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-slate-600">
                      {selectedConversation.statusLabel}
                    </span>
                    {selectedConversation.escalated && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-red-700">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        Escalated
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500">
                    Last staff response: {getLastStaffResponder(selectedConversation) || 'No staff response yet'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void handleEscalate()}
                      disabled={submitting || selectedConversation.escalated || selectedConversation.status === SupportConversationStatus.RESOLVED}
                      aria-busy={pendingAction === 'escalate'}
                      className="inline-flex items-center gap-2 rounded-xl bg-red-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pendingAction === 'escalate' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <AlertTriangle className="h-4 w-4" />
                      )}
                      Escalate
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleStatusChange(SupportConversationStatus.RESOLVED)}
                      disabled={submitting || selectedConversation.status === SupportConversationStatus.RESOLVED}
                      aria-busy={pendingAction === 'resolve'}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pendingAction === 'resolve' ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="h-4 w-4" />
                      )}
                      Resolved
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 p-4">
              {selectedConversation.attachments.length > 0 && (
                <div className="rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
                  <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-700">
                    <Paperclip className="h-4 w-4" />
                    Attachments
                  </p>
                  <div className="grid gap-2 md:grid-cols-2">
                    {selectedConversation.attachments.map((attachment) => (
                      <button
                        key={attachment.id}
                        type="button"
                        onClick={() => void handleDownloadAttachment(attachment.id)}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs hover:bg-blue-50"
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-bold text-slate-800">
                            {attachment.filename}
                          </span>
                          <span className="text-slate-500">
                            {attachment.purpose === SupportAttachmentPurpose.MISMO ? 'MISMO' : 'Attachment'} · {formatBytes(attachment.sizeBytes)}
                          </span>
                        </span>
                        {downloadingAttachmentId === attachment.id ? (
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-600" />
                        ) : (
                          <Download className="h-4 w-4 shrink-0 text-blue-600" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {selectedConversation.messages.map((message) => {
                const requesterMessage =
                  message.author.role === UserRole.LOAN_OFFICER || message.author.role === UserRole.LOA;
                const staffTone = staffToneFor(message.authorId);
                return (
                  <div
                    key={message.id}
                    className={`flex ${requesterMessage ? 'justify-start' : 'justify-end'}`}
                  >
                    <div
                      className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                        requesterMessage
                          ? 'border border-slate-200 bg-white text-slate-800'
                          : staffTone.bubble
                      }`}
                    >
                      <p className="whitespace-pre-wrap leading-6">{message.body}</p>
                      <p className={`mt-2 text-[10px] ${requesterMessage ? 'text-slate-400' : staffTone.meta}`}>
                        {message.author.name} · {formatDateTime(message.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-200 bg-white p-4">
              <textarea
                value={reply}
                onChange={(event) => setReply(event.target.value)}
                rows={4}
                placeholder="Reply to the requester..."
                className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
              <button
                type="button"
                onClick={handleReply}
                disabled={submitting || !reply.trim()}
                className="app-btn-primary mt-3 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Send Reply
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ContextChip({ label }: { label: string }) {
  return (
    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
      {label}
    </span>
  );
}

function QueueConversationButton({
  conversation,
  active,
  onOpen,
}: {
  conversation: SupportConversationItem;
  active: boolean;
  onOpen: () => void;
}) {
  const resolved = conversation.status === SupportConversationStatus.RESOLVED;
  const lastMessage = conversation.messages[0];
  const staffResponder = getLastStaffResponder(conversation);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full border-b border-slate-100 p-4 text-left transition ${
        active
          ? resolved
            ? 'bg-emerald-50'
            : 'bg-blue-50'
          : resolved
            ? 'bg-emerald-50/70 hover:bg-emerald-100/70'
            : 'bg-white hover:bg-slate-50'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`text-[11px] font-bold uppercase tracking-wide ${resolved ? 'text-emerald-700' : 'text-blue-700'}`}>
            {conversation.deskLabel}
          </p>
          <h3 className="mt-1 flex items-center gap-1.5 text-sm font-bold text-slate-900">
            {conversation.escalated && (
              <AlertTriangle className="h-4 w-4 shrink-0 fill-red-100 text-red-600" aria-label="Escalated" />
            )}
            <span className="truncate">{conversation.subject}</span>
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {conversation.requester?.name || 'Unknown requester'} · {formatDateTime(conversation.lastMessageAt)}
          </p>
          <p className="mt-1 text-[11px] font-medium text-slate-500">
            {staffResponder ? `Last staff: ${staffResponder}` : lastMessage ? `Last reply: ${lastMessage.author.name}` : 'No replies yet'}
          </p>
        </div>
        {conversation.unreadCount > 0 && (
          <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
            {conversation.unreadCount}
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
          resolved
            ? 'border-emerald-200 bg-emerald-100 text-emerald-700'
            : 'border-slate-200 bg-white text-slate-600'
        }`}>
          {conversation.statusLabel}
        </span>
        {conversation.escalated && (
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
            Escalated
          </span>
        )}
      </div>
    </button>
  );
}

function MessagePlaceholder() {
  return (
    <>
      <Inbox className="mb-3 h-10 w-10 text-slate-300" />
      <h2 className="text-lg font-bold text-slate-900">Select a support request</h2>
      <p className="mt-1 max-w-sm text-sm">
        Open a conversation from the queue to reply, escalate for attention, or mark it resolved.
      </p>
    </>
  );
}
