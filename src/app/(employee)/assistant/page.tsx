import type { Metadata } from "next";
import { Database, FileText, Lock, ShieldCheck, Sparkles, Workflow } from "lucide-react";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";
import { AssistantWorkspace } from "@/components/employee/AssistantWorkspace";

export const metadata: Metadata = {
  title: "AI Assistant",
};

const previewCapabilities = [
  {
    icon: FileText,
    title: "Portfolio summaries",
    description: "Preview how leadership updates can combine project health, risks, and deadlines.",
  },
  {
    icon: Workflow,
    title: "Operational triage",
    description: "Surface urgent tasks, blocked work, and approvals awaiting review.",
  },
  {
    icon: Database,
    title: "Company context",
    description: "Future answers can be grounded in approved internal records and documentation.",
  },
  {
    icon: ShieldCheck,
    title: "Review boundaries",
    description: "Designed for human validation; writes and decisions remain outside this preview.",
  },
];

export default function AssistantPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Internal intelligence"
        title="AI Assistant"
        description="A preview of an internal operations assistant for summarising work, identifying risk, and preparing reviews."
        actions={<PreviewButton icon={Sparkles}>New conversation</PreviewButton>}
      />

      <div className="rounded-2xl border border-border bg-selected-teal px-4 py-3.5 text-xs leading-relaxed text-brand-teal dark:bg-[#102A2E] dark:text-[#A8E6EC]">
        This workspace uses a scripted illustrative conversation. No language model, company data source,
        or action-taking integration is connected.
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard
          title="Conversation preview"
          description="Representative employee questions and assistant responses."
          bodyClassName="p-3 sm:p-4"
        >
          <AssistantWorkspace />
        </SectionCard>

        <div className="space-y-5">
          <SectionCard title="Preview capabilities" bodyClassName="p-3">
            <ul className="space-y-2">
              {previewCapabilities.map((capability) => {
                const Icon = capability.icon;
                return (
                  <li
                    key={capability.title}
                    className="rounded-xl border border-border bg-background p-3"
                  >
                    <div className="flex items-center gap-2">
                      <Icon className="h-4 w-4 text-action-teal" aria-hidden="true" />
                      <p className="text-xs font-semibold text-foreground">{capability.title}</p>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                      {capability.description}
                    </p>
                  </li>
                );
              })}
            </ul>
          </SectionCard>

          <SectionCard title="Access posture" bodyClassName="p-4">
            <div className="flex gap-2.5">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Lock className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                This frontend does not authenticate users, read private records, or perform actions.
                Authentication and data access must be designed before this area becomes operational.
              </p>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
