'use client';

import React from 'react';
import { HelpCircle, Loader2, MessageCircle, Send, X } from 'lucide-react';
import { SupportDesk, UserRole } from '@prisma/client';
import { useSession } from 'next-auth/react';
import {
  createSupportConversation,
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
  { value: SupportDesk.SCENARIO, label: 'Scenario Desk', help: 'Loan scenarios, guidelines, lender fit.' },
  { value: SupportDesk.PRICING, label: 'Pricing Desk', help: 'Pricing, rates, lock questions.' },
  { value: SupportDesk.HELP, label: 'Help Desk', help: 'Portal, IT, and general support.' },
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

export function SupportChatWidget({ activeRole }: SupportChatWidgetProps) {
  const { data: session } = useSession();
  const canOpenWidget = canUseSupportChatPilot({
    activeRole,
    roles: session?.user?.roles as UserRole[] | undefined,
    name: session?.user?.name,
    email: session?.user?.email,
  });
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [conversations, setConversations] = React.useState<ConversationSummary[]>([]);
  const [loans, setLoans] = React.useState<LoanOption[]>([]);
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);
  const [activeConversation, setActiveConversation] = React.useState<ConversationSummary | null>(null);
  const [replyBody, setReplyBody] = React.useState('');
  const [form, setForm] = React.useState<{
    desk: SupportDesk;
    subject: string;
    body: string;
    loanId: string;
    lender: string;
    loanType: string;
    propertyState: string;
  }>({
    desk: SupportDesk.SCENARIO,
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
  }, [activeConversationId, loadBootstrap, open]);

  const openConversation = async (conversationId: string, showLoader = true) => {
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
  };

  const handleCreate = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createSupportConversation({
        desk: form.desk,
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
      setConversations((prev) => [nextConversation, ...prev.filter((item) => item.id !== nextConversation.id)]);
      setActiveConversation(nextConversation);
      setActiveConversationId(nextConversation.id);
      setForm({
        desk: SupportDesk.SCENARIO,
        subject: '',
        body: '',
        loanId: '',
        lender: '',
        loanType: '',
        propertyState: '',
      });
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

  if (!canOpenWidget) return null;

  const unreadTotal = conversations.reduce((sum, conversation) => sum + conversation.unreadCount, 0);
  const selectedLoan = loans.find((loan) => loan.id === form.loanId);

  return (
    <div className="fixed bottom-6 right-6 z-[55] flex flex-col items-end gap-3">
      {open && (
        <section
          data-live-refresh-pause="true"
          className="flex h-[min(680px,calc(100vh-6rem))] w-[min(420px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
          aria-label="Support chat"
        >
          <div className="border-b border-slate-200 bg-gradient-to-r from-blue-600 to-indigo-600 px-4 py-3 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-100">
                  BISU Support
                </p>
                <h2 className="text-lg font-extrabold">How can we help?</h2>
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

          <div className="flex min-h-0 flex-1 flex-col">
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

            <div className="grid min-h-0 flex-1 grid-cols-1">
              {activeConversation ? (
                <div className="flex min-h-0 flex-col">
                  <div className="border-b border-slate-100 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveConversation(null);
                        setActiveConversationId(null);
                      }}
                      className="mb-2 text-xs font-bold text-blue-700 hover:text-blue-800"
                    >
                      Back to chats
                    </button>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">
                          {activeConversation.deskLabel}
                        </p>
                        <h3 className="text-sm font-bold text-slate-900">{activeConversation.subject}</h3>
                      </div>
                      <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                        {activeConversation.statusLabel}
                      </span>
                    </div>
                  </div>
                  <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-slate-50/70 px-4 py-4">
                    {activeConversation.messages.map((message) => {
                      const isMine = message.authorId === activeConversation.requesterId;
                      return (
                        <div
                          key={message.id}
                          className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}
                        >
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
                      onChange={(event) => setReplyBody(event.target.value)}
                      placeholder="Type a reply..."
                      rows={3}
                      className="w-full resize-none rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                    />
                    <button
                      type="button"
                      onClick={handleReply}
                      disabled={submitting || !replyBody.trim()}
                      className="app-btn-primary mt-2 w-full disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      Send Reply
                    </button>
                  </div>
                </div>
              ) : (
                <div className="min-h-0 overflow-y-auto p-4">
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                    <p className="text-sm font-bold text-slate-900">Start a new request</p>
                    <div className="mt-3 grid gap-3">
                      <select
                        value={form.desk}
                        onChange={(event) =>
                          setForm((prev) => ({ ...prev, desk: event.target.value as SupportDesk }))
                        }
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        {DESK_OPTIONS.map((desk) => (
                          <option key={desk.value} value={desk.value}>
                            {desk.label}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500">
                        {DESK_OPTIONS.find((desk) => desk.value === form.desk)?.help}
                      </p>
                      <input
                        value={form.subject}
                        onChange={(event) => setForm((prev) => ({ ...prev, subject: event.target.value }))}
                        placeholder="Subject"
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                      <select
                        value={form.loanId}
                        onChange={(event) => {
                          const loan = loans.find((item) => item.id === event.target.value);
                          setForm((prev) => ({
                            ...prev,
                            loanId: event.target.value,
                            loanType: prev.loanType || loan?.program || '',
                          }));
                        }}
                        className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">No related loan</option>
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
                          onChange={(event) => setForm((prev) => ({ ...prev, lender: event.target.value }))}
                          placeholder="Lender"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                        <input
                          value={form.loanType}
                          onChange={(event) => setForm((prev) => ({ ...prev, loanType: event.target.value }))}
                          placeholder="Loan type"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                        <input
                          value={form.propertyState}
                          onChange={(event) => setForm((prev) => ({ ...prev, propertyState: event.target.value }))}
                          placeholder="State"
                          className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                        />
                      </div>
                      <textarea
                        value={form.body}
                        onChange={(event) => setForm((prev) => ({ ...prev, body: event.target.value }))}
                        placeholder="Describe what you need help with..."
                        rows={4}
                        className="resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={handleCreate}
                        disabled={submitting || !form.subject.trim() || !form.body.trim()}
                        className="app-btn-primary disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Start Chat
                      </button>
                    </div>
                  </div>

                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-bold text-slate-900">Recent chats</h3>
                      <button
                        type="button"
                        onClick={() => void loadBootstrap(true)}
                        className="text-xs font-bold text-blue-700 hover:text-blue-800"
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="space-y-2">
                      {conversations.map((conversation) => (
                        <button
                          key={conversation.id}
                          type="button"
                          onClick={() => void openConversation(conversation.id)}
                          className="w-full rounded-xl border border-slate-200 bg-white p-3 text-left transition hover:border-blue-200 hover:bg-blue-50/40"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">
                                {conversation.deskLabel}
                              </p>
                              <p className="text-sm font-bold text-slate-900">{conversation.subject}</p>
                              <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                                {conversation.messages[0]?.body || 'No messages yet'}
                              </p>
                            </div>
                            {conversation.unreadCount > 0 && (
                              <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-bold text-white">
                                {conversation.unreadCount}
                              </span>
                            )}
                          </div>
                        </button>
                      ))}
                      {conversations.length === 0 && (
                        <p className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-sm text-slate-500">
                          No support chats yet.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl ring-4 ring-blue-100 transition hover:bg-blue-700 focus:outline-none focus:ring-4 focus:ring-blue-200"
        aria-label="Open support chat"
      >
        {open ? <X className="h-6 w-6" /> : <MessageCircle className="h-6 w-6" />}
        {unreadTotal > 0 && (
          <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadTotal}
          </span>
        )}
        {!open && unreadTotal === 0 && (
          <span className="absolute -left-1 -top-1 rounded-full bg-white p-1 text-blue-600 shadow">
            <HelpCircle className="h-3.5 w-3.5" />
          </span>
        )}
      </button>
    </div>
  );
}
