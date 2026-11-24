import Link from "next/link";
import { ArrowUpRight, Sparkles } from "lucide-react";
import { assistantMessages, assistantPrompts } from "@/lib/employee/mockData";
import { Avatar } from "./Avatar";

export function AssistantWorkspace({ compact = false }: { compact?: boolean }) {
  const messages = compact ? assistantMessages.slice(0, 2) : assistantMessages;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-background">
      <div className="flex items-center gap-2.5 border-b border-border bg-surface px-4 py-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-selected-teal text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
          <Sparkles className="h-4 w-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs font-semibold text-foreground">AI Operations Assistant</p>
          <p className="text-[10px] text-muted-foreground">Illustrative conversation preview</p>
        </div>
      </div>

      <div className={`space-y-4 overflow-y-auto px-4 py-4 ${compact ? "max-h-72" : "max-h-[560px]"}`}>
        {messages.map((message) => {
          const isAssistant = message.role === "assistant";
          return (
            <div key={message.id} className={`flex gap-2.5 ${isAssistant ? "" : "flex-row-reverse"}`}>
              {isAssistant ? (
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-selected-teal text-brand-teal dark:bg-[#102A2E] dark:text-[#7FD9E2]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              ) : (
                <Avatar name="Jordan Blake" size="sm" />
              )}
              <div className={`max-w-[85%] ${isAssistant ? "" : "text-right"}`}>
                <div
                  className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed ${
                    isAssistant
                      ? "rounded-tl-sm border border-border bg-surface text-foreground"
                      : "rounded-tr-sm bg-primary text-primary-foreground"
                  }`}
                >
                  {message.content}
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">{message.time}</p>
              </div>
            </div>
          );
        })}
      </div>

      {!compact ? (
        <div className="border-t border-border bg-surface px-4 py-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Suggested prompts
          </p>
          <div className="flex flex-wrap gap-2">
            {assistantPrompts.map((prompt) => (
              <button
                key={prompt}
                type="button"
                disabled
                className="cursor-not-allowed rounded-full border border-border px-3 py-1.5 text-[11px] font-medium text-muted-foreground opacity-80"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="border-t border-border bg-surface p-3">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5">
          <input
            type="text"
            readOnly
            placeholder="Ask about projects, tasks, approvals..."
            className="min-w-0 flex-1 bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            aria-label="Assistant message preview"
          />
          <button
            type="button"
            disabled
            className="cursor-not-allowed rounded-lg bg-muted px-2.5 py-1.5 text-[11px] font-semibold text-muted-foreground opacity-80"
          >
            Preview
          </button>
        </div>
        {compact ? (
          <Link
            href="/assistant"
            className="mt-2.5 inline-flex items-center gap-1.5 text-[11px] font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
          >
            Open assistant workspace
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        ) : (
          <p className="mt-2 text-[10px] text-muted-foreground">
            Responses are illustrative. No model or company data source is connected.
          </p>
        )}
      </div>
    </div>
  );
}
