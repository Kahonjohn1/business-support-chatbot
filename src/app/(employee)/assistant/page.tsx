import type { Metadata } from "next";
import { ChevronDown } from "lucide-react";
import { AssistantWorkspace } from "@/components/employee/AssistantWorkspace";
import { PageHeader } from "@/components/employee/PageHeader";
import { requireEmployee } from "@/lib/employee/access";

export const metadata: Metadata = {
  title: "AI Assistant",
};

export default async function AssistantPage() {
  const { user } = await requireEmployee();

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="AI Assistant"
        title="How can I help you today?"
        description="Ask me to find information or help you get work done."
      />

      <AssistantWorkspace userName={user.name} />

      <details className="rounded-xl border border-border bg-surface shadow-xs">
        <summary className="cursor-pointer list-none px-4 py-3 text-xs font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-action-teal [&::-webkit-details-marker]:hidden">
          <span className="flex items-center justify-between gap-2">
            What can I do?
            <ChevronDown className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </span>
        </summary>
        <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Use the shortcuts or type a question. You can edit or copy responses in the chat; nothing
          is sent from this page. Requests that change records still follow approval checks.
        </p>
      </details>
    </div>
  );
}
