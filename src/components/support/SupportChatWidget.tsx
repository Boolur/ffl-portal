'use client';

import React from 'react';
import {
  DollarSign,
  Download,
  FileText,
  HelpCircle,
  Loader2,
  MessageCircle,
  Paperclip,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import { SupportAttachmentPurpose, SupportDesk, UserRole } from '@prisma/client';
import { useSession } from 'next-auth/react';
import {
  createSupportAttachmentUploadUrl,
  createSupportConversation,
  finalizeSupportAttachment,
  getSupportAttachmentDownloadUrl,
  getSupportChatBootstrap,
  getSupportConversation,
  sendSupportMessage,
} from '@/app/actions/supportChatActions';
import { canUseSupportChatPilot } from '@/lib/supportChatPilot';

type ConversationSummary = {
  id: string;
  desk: SupportDesk;
  deskLabel: string;
  statusLabel: string;
  subject: string;
  requesterId: string;
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

type LoanOption = {
  id: string;
  loanNumber: string;
  borrowerName: string;
  program: string | null;
};

type SupportChatWidgetProps = {
  activeRole: UserRole;
};

const DESK_OPTIONS = [
  {
    value: SupportDesk.SCENARIO,
    label: 'Scenario Desk',
    shortLabel: 'Scenario',
    help: 'Ask guideline, structure, lender-fit, or loan-type questions.',
    icon: Sparkles,
    tone: 'from-violet-600 to-indigo-600',
    chip: 'border-violet-200 bg-violet-50 text-violet-700',
  },
  {
    value: SupportDesk.PRICING,
    label: 'Pricing Desk',
    shortLabel: 'Pricing',
    help: 'Get help with pricing, rates, locks, or a MISMO/pricing file.',
    icon: DollarSign,
    tone: 'from-emerald-600 to-teal-600',
    chip: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  },
  {
    value: SupportDesk.HELP,
    label: 'Help Desk',
    shortLabel: 'Help',
    help: 'Portal, IT, workflow, or general support questions.',
    icon: HelpCircle,
    tone: 'from-blue-600 to-cyan-600',
    chip: 'border-blue-200 bg-blue-50 text-blue-700',
  },
];

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

function getDeskOption(desk: SupportDesk) {
  return DESK_OPTIONS.find((option) => option.value === desk) || DESK_OPTIONS[0];
}

export function SupportChatWidget({ activeRole }: SupportChatWidgetProps) {
  const { data: session } = useSession();
  const canOpenWidget = canUseSupportChatPilot({
    activeRole,
    roles: session?.user?.roles as UserRole[] | undefined,
    name: session?.user?.name,
    email: session?.user?.email,
  });
  const [open, setOpen] = React.useState(false);
  const [tab, setTab] = React.useState<'previous' | 'new'>('previous');
  const [selectedDesk, setSelectedDesk] = React.useState<SupportDesk | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [loans, setLoans] = React.useState<LoanOption[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);
  const [activeConversation, setActiveConversation] = React.useState<ConversationSummary | null>(null);
  const [replyBody, setReplyBody] = React.useState('');
  const [mismoFile, setMismoFile] = React.useState<File | null>(null);
  const [downloadingAttachmentId, setDownloadingAttachmentId] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<{
    subject: string;
    body: string;
    loanId: string;
    lender: string;
    loanType: string;
    propertyState: string;
  }>({
    subject: '',
    body: '',
    loanId: '',
    lender: '',
    loanType: '',
    propertyState: '',
  });

  const loadBootstrap = React.useCallback(async (showLoader = false) => {
    if (!canOpenWidget) return;
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const result = await getSupportChatBootstrap();
      if (!result.success) {
        setError(result.error || 'Unable to load support chats.');
        return;
      }
      setConversations(result.conversations as ConversationSummary[]);
      setLoans(result.loans as LoanOption[]);
    } finally {
      if (showLoader) setLoading(false);
    }
  }, [canOpenWidget]);

  const openConversation = React.useCallback(async (conversationId: string, showLoader = true) => {
    setActiveConversationId(conversationId);
    if (showLoader) setLoading(true);
    setError(null);
    try {
      const result = await getSupportConversation(conversationId);
      if (!result.success) {
        setError(result.error || 'Unable to open conversation.');
        return;
      }
      setActiveConversation(result.conversation as ConversationSummary);
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === conversationId
            ? { ...conversation, ...(result.conversation as ConversationSummary), unreadCount: 0 }
            : conversation
        )
      );
    } finally {
      if (showLoader) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (!open) return;
    void loadBootstrap(true);
  }, [loadBootstrap, open]);

  React.useEffect(() => {
    if (!open) return;
    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void loadBootstrap(false);
      if (activeConversationId) {
        void openConversation(activeConversationId, false);
      }
    }, 30000);
    return () => window.clearInterval(interval);
  }, [activeConversationId, loadBootstrap, open, openConversation]);

  const resetNewChatForm = () => {
    setForm({
      subject: '',
      body: '',
      loanId: '',
      lender: '',
      loanType: '',
      propertyState: '',
    });
    setMismoFile(null);
    setSelectedDesk(null);
  };

  const uploadMismoFile = async (conversationId: string, file: File) => {
    const upload = await createSupportAttachmentUploadUrl({
      conversationId,
      filename: file.name,
    });
    if (!upload.success || !upload.signedUrl || !upload.path) {
      throw new Error(upload.error || 'Failed to initialize MISMO upload.');
    }

    const put = await fetch(upload.signedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
      },
      body: file,
    });
    if (!put.ok) {
      throw new Error('Failed to upload MISMO file.');
    }

    const saved = await finalizeSupportAttachment({
      conversationId,
      storagePath: upload.path,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      purpose: SupportAttachmentPurpose.MISMO,
    });
    if (!saved.success) {
      throw new Error(saved.error || 'Failed to save MISMO upload.');
    }
  };

  const handleCreate = async () => {
    if (!selectedDesk || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createSupportConversation({
        desk: selectedDesk,
        subject: form.subject,
        body: form.body,
        loanId: form.loanId || null,
        lender: form.lender || null,
        loanType: form.loanType || null,
        propertyState: form.propertyState || null,
      });
      if (!result.success) {
        setError(result.error || 'Unable to start chat.');
        return;
      }

      const nextConversation = result.conversation as ConversationSummary;
      if (mismoFile && (selectedDesk === SupportDesk.SCENARIO || selectedDesk === SupportDesk.PRICING)) {
        await uploadMismoFile(nextConversation.id, mismoFile);
      }

      await loadBootstrap(false);
      await openConversation(nextConversation.id, false);
      setTab('previous');
      resetNewChatForm();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Unable to start chat.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async () => {
    if (!activeConversationId || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await sendSupportMessage({
        conversationId: activeConversationId,
        body: replyBody,
      });
      if (!result.success) {
        setError(result.error || 'Unable to send reply.');
        return;
      }
      setReplyBody('');
      setActiveConversation(result.conversation as ConversationSummary);
      setConversations((prev) =>
        [result.conversation as ConversationSummary, ...prev.filter((item) => item.id !== activeConversationId)]
      );
    } finally {
      setSubmitting(false);
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

  if (!canOpenWidget) return null;

  const unreadTotal = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
  const selectedLoan = loans.find((loan) => loan.id === form.loanId);
  const activeDesk = selectedDesk ? getDeskOption(selectedDesk) : null;
  const showMismoUpload = selectedDesk === SupportDesk.SCENARIO || selectedDesk === SupportDesk.PRICING;

  return (
    <div className="fixed bottom-6 left-6 z-[55] flex flex-col items-start gap-3">
      {open && (
        <section
          data-live-refresh-pause="true"
          className="flex h-[min(720px,calc(100vh-6rem))] w-[min(460px,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
          aria-label="Support chat"
        >
          <div className="border-b border-[#3e8dc8]/30 bg-gradient-to-r from-[#2f75aa] via-[#3e8dc8] to-[#63a7d4] px-4 py-4 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-100">
                  BISU Support
                </p>
                <h2 className="text-xl font-extrabold">Support Center</h2>
                <p className="mt-1 text-xs text-blue-100">
                  Centralized help for scenarios, pricing, and IT support.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-blue-100 transition hover:bg-white/15 hover:text-white"
                aria-label="Close support chat"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 border-b border-slate-200 bg-slate-50 p-2">
            <button
              type="button"
              onClick={() => {
                setTab('previous');
                resetNewChatForm();
              }}
              className={`rounded-2xl px-3 py-2 text-sm font-bold transition ${
                tab === 'previous'
                  ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-100'
                  : 'text-slate-500 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              Previous Chats
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('new');
                setActiveConversation(null);
                setActiveConversationId(null);
              }}
              className={`rounded-2xl px-3 py-2 text-sm font-bold transition ${
                tab === 'new'
                  ? 'bg-white text-blue-700 shadow-sm ring-1 ring-blue-100'
                  : 'text-slate-500 hover:bg-white/70 hover:text-slate-900'
              }`}
            >
              New Chat
            </button>
          </div>

          {error && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700">
              {error}
            </div>
          )}
          {loading && (
            <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading support chats...
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-hidden">
            {activeConversation ? (
              <ThreadView
                conversation={activeConversation}
                replyBody={replyBody}
                submitting={submitting}
                downloadingAttachmentId={downloadingAttachmentId}
                onBack={() => {
                  setActiveConversation(null);
                  setActiveConversationId(null);
                }}
                onReplyBodyChange={setReplyBody}
                onReply={handleReply}
                onDownloadAttachment={handleDownloadAttachment}
              />
            ) : tab === 'previous' ? (
              <PreviousChats
                conversations={conversations}
                onOpenConversation={(conversationId) => void openConversation(conversationId)}
                onRefresh={() => void loadBootstrap(true)}
              />
            ) : selectedDesk ? (
              <NewChatForm
                desk={selectedDesk}
                deskOption={activeDesk}
                form={form}
                loans={loans}
                selectedLoan={selectedLoan}
                mismoFile={mismoFile}
                showMismoUpload={showMismoUpload}
                submitting={submitting}
                onBack={() => setSelectedDesk(null)}
                onFormChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
                onFileChange={setMismoFile}
                onSubmit={handleCreate}
              />
            ) : (
              <DeskPicker onSelectDesk={setSelectedDesk} />
            )}
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-[#3e8dc8] text-white shadow-2xl ring-4 ring-[#3e8dc8]/20 transition hover:scale-[1.02] hover:bg-[#347eb5] focus:outline-none focus:ring-4 focus:ring-[#3e8dc8]/30"
        aria-label="Open support chat"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {unreadTotal > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadTotal}
          </span>
        )}
      </button>
    </div>
  );
}

function DeskPicker({ onSelectDesk }: { onSelectDesk: (desk: SupportDesk) => void }) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
        <p className="text-sm font-bold text-blue-950">What type of help do you need?</p>
        <p className="mt-1 text-xs leading-5 text-blue-800">
          Pick the desk that best matches your question. We will route it to the right team member.
        </p>
      </div>
      <div className="grid gap-3">
        {DESK_OPTIONS.map((desk) => {
          const Icon = desk.icon;
          return (
            <button
              key={desk.value}
              type="button"
              onClick={() => onSelectDesk(desk.value)}
              className="group overflow-hidden rounded-3xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg"
            >
              <div className="flex items-center gap-4">
                <div className={`flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br ${desk.tone} text-white shadow-lg`}>
                  <Icon className="h-7 w-7" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-base font-extrabold text-slate-900">{desk.label}</h3>
                  <p className="mt-1 text-sm leading-5 text-slate-500">{desk.help}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PreviousChats({
  conversations,
  onOpenConversation,
  onRefresh,
}: {
  conversations: ConversationSummary[];
  onOpenConversation: (conversationId: string) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-extrabold text-slate-900">Previous Chats</h3>
          <p className="text-xs text-slate-500">{conversations.length} recent conversations</p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-blue-700 shadow-sm hover:bg-blue-50"
        >
          Refresh
        </button>
      </div>
      <div className="space-y-2">
        {conversations.map((conversation) => {
          const desk = getDeskOption(conversation.desk);
          const latestMessage = conversation.messages[0]?.body || 'No messages yet';
          return (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onOpenConversation(conversation.id)}
              className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${desk.chip}`}>
                    {conversation.deskLabel}
                  </span>
                  <p className="mt-2 text-sm font-bold text-slate-900">{conversation.subject}</p>
                  <p className="mt-1 line-clamp-1 text-xs text-slate-500">{latestMessage}</p>
                  <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(conversation.lastMessageAt)}</p>
                </div>
                {conversation.unreadCount > 0 && (
                  <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                    {conversation.unreadCount}
                  </span>
                )}
              </div>
            </button>
          );
        })}
        {conversations.length === 0 && (
          <p className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
            No support chats yet. Start a new chat when you need help.
          </p>
        )}
      </div>
    </div>
  );
}

function NewChatForm({
  desk,
  deskOption,
  form,
  loans,
  selectedLoan,
  mismoFile,
  showMismoUpload,
  submitting,
  onBack,
  onFormChange,
  onFileChange,
  onSubmit,
}: {
  desk: SupportDesk;
  deskOption: (typeof DESK_OPTIONS)[number] | null;
  form: {
    subject: string;
    body: string;
    loanId: string;
    lender: string;
    loanType: string;
    propertyState: string;
  };
  loans: LoanOption[];
  selectedLoan?: LoanOption;
  mismoFile: File | null;
  showMismoUpload: boolean;
  submitting: boolean;
  onBack: () => void;
  onFormChange: (patch: Partial<typeof form>) => void;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
}) {
  const Icon = deskOption?.icon || MessageCircle;
  const contextHelp =
    desk === SupportDesk.SCENARIO
      ? 'Scenario questions route best when lender, loan type, and state are filled in.'
      : desk === SupportDesk.PRICING
        ? 'Pricing questions route best with lender, loan type, and MISMO/pricing context.'
        : 'Help Desk requests only need a clear subject and description.';

  return (
    <div className="h-full overflow-y-auto p-4">
      <button
        type="button"
        onClick={onBack}
        className="mb-3 text-xs font-bold text-blue-700 hover:text-blue-800"
      >
        Back to desk options
      </button>
      <div className={`mb-4 rounded-3xl bg-gradient-to-br ${deskOption?.tone || 'from-blue-600 to-indigo-600'} p-4 text-white shadow-lg`}>
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/20">
            <Icon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-white/75">New Chat</p>
            <h3 className="text-lg font-extrabold">{deskOption?.label}</h3>
          </div>
        </div>
      </div>
      <div className="grid gap-3">
        <input
          value={form.subject}
          onChange={(event) => onFormChange({ subject: event.target.value })}
          placeholder={
            desk === SupportDesk.HELP
              ? 'What do you need help with?'
              : desk === SupportDesk.PRICING
                ? 'Pricing question subject'
                : 'Scenario question subject'
          }
          className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        {(desk === SupportDesk.SCENARIO || desk === SupportDesk.PRICING) && (
          <>
            <select
              value={form.loanId}
              onChange={(event) => {
                const loan = loans.find((item) => item.id === event.target.value);
                onFormChange({
                  loanId: event.target.value,
                  loanType: form.loanType || loan?.program || '',
                });
              }}
              className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">No related loan in portal</option>
              {loans.map((loan) => (
                <option key={loan.id} value={loan.id}>
                  {loan.borrowerName} · {loan.loanNumber}
                </option>
              ))}
            </select>
            {selectedLoan && (
              <p className="text-[11px] text-slate-500">
                Selected loan program: {selectedLoan.program || 'Not specified'}
              </p>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <input
                value={form.lender}
                onChange={(event) => onFormChange({ lender: event.target.value })}
                placeholder="Lender"
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={form.loanType}
                onChange={(event) => onFormChange({ loanType: event.target.value })}
                placeholder="Loan type"
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
              <input
                value={form.propertyState}
                onChange={(event) => onFormChange({ propertyState: event.target.value })}
                placeholder="State"
                className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm"
              />
            </div>
          </>
        )}
        <p className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
          {contextHelp}
        </p>
        {showMismoUpload && (
          <label className="block rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 px-3 py-3 text-sm text-blue-900">
            <span className="flex items-center gap-2 font-bold">
              <Paperclip className="h-4 w-4" />
              MISMO Upload
            </span>
            <span className="mt-1 block text-xs text-blue-700">
              Optional file for loans or pricing scenarios not already in the portal.
            </span>
            <input
              type="file"
              accept=".xml,.mismo,.txt,.pdf,.doc,.docx"
              onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
              className="mt-3 block w-full text-xs text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-xs file:font-bold file:text-white hover:file:bg-blue-700"
            />
            {mismoFile && (
              <span className="mt-2 block text-xs font-semibold text-blue-800">
                Selected: {mismoFile.name} ({formatBytes(mismoFile.size)})
              </span>
            )}
          </label>
        )}
        <textarea
          value={form.body}
          onChange={(event) => onFormChange({ body: event.target.value })}
          placeholder="Describe what you need help with..."
          rows={5}
          className="resize-none rounded-2xl border border-slate-200 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <button
          type="button"
          onClick={onSubmit}
          disabled={submitting || !form.subject.trim() || !form.body.trim()}
          className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Start {deskOption?.shortLabel || 'Support'} Chat
        </button>
      </div>
    </div>
  );
}

function ThreadView({
  conversation,
  replyBody,
  submitting,
  downloadingAttachmentId,
  onBack,
  onReplyBodyChange,
  onReply,
  onDownloadAttachment,
}: {
  conversation: ConversationSummary;
  replyBody: string;
  submitting: boolean;
  downloadingAttachmentId: string | null;
  onBack: () => void;
  onReplyBodyChange: (value: string) => void;
  onReply: () => void;
  onDownloadAttachment: (attachmentId: string) => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-slate-100 px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="mb-2 text-xs font-bold text-blue-700 hover:text-blue-800"
        >
          Back to chats
        </button>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">
              {conversation.deskLabel}
            </p>
            <h3 className="text-sm font-bold text-slate-900">{conversation.subject}</h3>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
            {conversation.statusLabel}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 px-4 py-4">
        {conversation.attachments.length > 0 && (
          <div className="rounded-2xl border border-blue-100 bg-white p-3 shadow-sm">
            <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-blue-700">
              <FileText className="h-4 w-4" />
              Attachments
            </p>
            <div className="space-y-2">
              {conversation.attachments.map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => onDownloadAttachment(attachment.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-xs hover:bg-blue-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-bold text-slate-800">{attachment.filename}</span>
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
        {conversation.messages.map((message) => {
          const isMine = message.authorId === conversation.requesterId;
          return (
            <div key={message.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  isMine
                    ? 'bg-blue-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-800'
                }`}
              >
                <p className="whitespace-pre-wrap">{message.body}</p>
                <p className={`mt-1 text-[10px] ${isMine ? 'text-blue-100' : 'text-slate-400'}`}>
                  {message.author.name} · {formatDateTime(message.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-slate-200 p-3">
        <textarea
          value={replyBody}
          onChange={(event) => onReplyBodyChange(event.target.value)}
          placeholder="Type a reply..."
          rows={3}
          className="w-full resize-none rounded-2xl border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        />
        <button
          type="button"
          onClick={onReply}
          disabled={submitting || !replyBody.trim()}
          className="app-btn-primary mt-2 w-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send Reply
        </button>
      </div>
    </div>
  );
}
