"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ClipboardCheck,
  Copy,
  FolderKanban,
  ListTodo,
  Loader2,
  Mail,
  Pencil,
  RotateCcw,
  Send,
  Sparkles,
} from "lucide-react";
import { MAX_MESSAGES, MAX_MESSAGE_CHARS } from "@/lib/chatLimits";
import { AssistantMessageContent } from "./AssistantMessageContent";
import { Avatar } from "./Avatar";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface AssistantWorkspaceProps {
  userName: string;
}

const SHORTCUTS = [
  {
    title: "Check projects",
    prompt: "Give me an update on our projects.",
    icon: FolderKanban,
  },
  {
    title: "Manage tasks",
    prompt: "Which tasks need attention?",
    icon: ListTodo,
  },
  {
    title: "Draft an email",
    prompt: "Help me draft a professional email.",
    icon: Mail,
  },
  {
    title: "Check approvals",
    prompt: "Show me pending approval requests.",
    icon: ClipboardCheck,
  },
];

function messageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function errorText(value: unknown): string {
  if (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string" &&
    value.error.trim()
  ) {
    return value.error;
  }
  return "The assistant could not answer right now.";
}

export function AssistantWorkspace({ userName }: AssistantWorkspaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usedTools, setUsedTools] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading, editingId]);

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    const history = [...messages, { id: messageId(), role: "user" as const, content }].slice(
      -MAX_MESSAGES
    );
    const requestMessages = history.map(({ role, content: messageContent }) => ({
      role,
      content: messageContent,
    }));

    setMessages(history);
    setInput("");
    setError(null);
    setUsedTools([]);
    setEditingId(null);
    setCopiedId(null);
    setLoading(true);

    try {
      const response = await fetch("/api/employee/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages }),
      });
      const payload = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) throw new Error(errorText(payload));

      if (
        typeof payload !== "object" ||
        payload === null ||
        !("message" in payload) ||
        typeof payload.message !== "string" ||
        !payload.message.trim()
      ) {
        throw new Error("The assistant returned an empty response.");
      }

      const answer = payload.message;
      const tools =
        "usedTools" in payload && Array.isArray(payload.usedTools)
          ? payload.usedTools.filter((tool): tool is string => typeof tool === "string")
          : [];

      setMessages((current) => [
        ...current,
        { id: messageId(), role: "assistant", content: answer },
      ]);
      setUsedTools(tools);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The assistant request failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(input);
  }

  function startNewChat() {
    setMessages([]);
    setError(null);
    setUsedTools([]);
    setInput("");
    setEditingId(null);
    setEditValue("");
    setCopiedId(null);
  }

  function startEditing(message: ChatMessage) {
    setEditingId(message.id);
    setEditValue(message.content);
    setCopiedId(null);
  }

  function saveEdit() {
    if (!editingId || !editValue.trim()) return;
    setMessages((current) =>
      current.map((message) =>
        message.id === editingId ? { ...message, content: editValue.trim() } : message
      )
    );
    setEditingId(null);
    setEditValue("");
  }

  async function copyMessage(message: ChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedId(message.id);
    } catch {
      setCopiedId(null);
    }
  }

  return (
    <div className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-xs">
      <div className="flex items-center justify-between gap-2 border-b border-border bg-surface px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-selected-teal text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="text-xs font-semibold text-foreground">Conversation</p>
        </div>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={startNewChat}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            New chat
          </button>
        ) : null}
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-6" aria-live="polite">
        {messages.length === 0 ? (
          <div className="mx-auto w-full max-w-3xl">
            <div className="grid gap-2.5 sm:grid-cols-2">
              {SHORTCUTS.map((shortcut) => {
                const Icon = shortcut.icon;
                return (
                  <button
                    key={shortcut.title}
                    type="button"
                    disabled={loading}
                    onClick={() => void sendMessage(shortcut.prompt)}
                    className="rounded-xl border border-border bg-surface px-3.5 py-3 text-left transition-colors hover:border-action-teal hover:bg-selected-teal/40 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-action-teal" aria-hidden="true" />
                      <span className="text-xs font-semibold text-foreground">{shortcut.title}</span>
                    </span>
                    <span className="mt-1.5 block text-[11px] leading-relaxed text-muted-foreground">
                      {shortcut.prompt}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        {messages.map((message) => {
          const isAssistant = message.role === "assistant";
          return (
            <div key={message.id} className={`flex gap-2.5 ${isAssistant ? "" : "flex-row-reverse"}`}>
              {isAssistant ? (
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-selected-teal text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              ) : (
                <Avatar name={userName} size="sm" />
              )}
              <div className={`min-w-0 max-w-[85%] ${isAssistant ? "" : "text-right"}`}>
                {isAssistant && editingId === message.id ? (
                  <div className="rounded-2xl rounded-tl-sm border border-border bg-surface p-2.5">
                    <textarea
                      value={editValue}
                      onChange={(event) => setEditValue(event.target.value)}
                      rows={5}
                      aria-label="Edit assistant draft"
                      className="w-full resize-y bg-transparent text-xs leading-relaxed text-foreground focus:outline-none"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-lg px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={saveEdit}
                        className="rounded-lg bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground hover:bg-primary-hover"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    className={`min-w-0 rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      isAssistant
                        ? "break-words rounded-tl-sm border border-border bg-surface text-foreground"
                        : "whitespace-pre-wrap break-words rounded-tr-sm bg-primary text-primary-foreground"
                    }`}
                  >
                    {isAssistant ? <AssistantMessageContent value={message.content} /> : message.content}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span>{isAssistant ? "Assistant" : userName}</span>
                  {isAssistant && editingId !== message.id ? (
                    <>
                      <button
                        type="button"
                        onClick={() => void copyMessage(message)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <Copy className="h-3 w-3" aria-hidden="true" />
                        {copiedId === message.id ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditing(message)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        <Pencil className="h-3 w-3" aria-hidden="true" />
                        Edit
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}

        {loading ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            Checking...
          </div>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-start gap-2 border-t border-border bg-danger-subtle px-4 py-2.5 text-[11px] text-danger">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {usedTools.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-surface px-4 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Checked
          </span>
          {usedTools.map((tool) => (
            <span
              key={tool}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              {tool.replaceAll("_", " ")}
            </span>
          ))}
        </div>
      ) : null}

      <div className="border-t border-border bg-surface px-4 py-3">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
          <input
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            maxLength={MAX_MESSAGE_CHARS}
            placeholder="Ask a question or draft an email..."
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            aria-label="Assistant message"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
