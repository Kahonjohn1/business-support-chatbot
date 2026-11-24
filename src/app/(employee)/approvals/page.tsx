import type { Metadata } from "next";
import { Check, Clock, FolderKanban, MessageSquare, X } from "lucide-react";
import { approvals, type Approval } from "@/lib/employee/mockData";
import { AvatarWithName } from "@/components/employee/Avatar";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { requirePermission } from "@/lib/employee/access";

export const metadata: Metadata = {
  title: "Approvals",
};

function approvalTone(status: Approval["status"]) {
  if (status === "Approved") return "success" as const;
  if (status === "Rejected") return "danger" as const;
  return "warning" as const;
}

export default async function ApprovalsPage() {
  await requirePermission("approvals:review");

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Review queue"
        title="Approvals"
        description="Review knowledge, automation, access, and workflow requests before they move forward."
        actions={<PreviewButton icon={Check}>New request</PreviewButton>}
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Awaiting review</p>
            <Clock className="h-4 w-4 text-[#A15C0B]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">05</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Across four request types</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Oldest pending</p>
            <Clock className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">2 days</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Knowledge base request</p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Decided this week</p>
            <Check className="h-4 w-4 text-action-teal" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">12</p>
          <p className="mt-2 text-[11px] text-muted-foreground">Preview reporting metric</p>
        </div>
      </div>

      <SectionCard
        title="Pending requests"
        description="Approval actions are disabled because no workflow engine is connected."
        bodyClassName="p-3 sm:p-4"
      >
        <div className="space-y-3">
          {approvals.map((approval) => (
            <article
              key={approval.id}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={approvalTone(approval.status)}>
                      {approval.status}
                    </StatusBadge>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {approval.type}
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold leading-snug text-foreground">
                    {approval.title}
                  </h3>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {approval.detail}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
                    <AvatarWithName name={approval.requestedBy} meta={`Submitted ${approval.submitted}`} />
                    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <FolderKanban className="h-3.5 w-3.5" aria-hidden="true" />
                      {approval.project}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Impact: <span className="font-medium text-foreground">{approval.impact}</span>
                    </span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <PreviewButton icon={X} variant="secondary">
                    Request changes
                  </PreviewButton>
                  <PreviewButton icon={Check}>Approve</PreviewButton>
                </div>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Review principles" bodyClassName="p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex gap-2.5">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Require a written rationale for customer-facing or access-related decisions.
            </p>
          </div>
          <div className="flex gap-2.5">
            <FolderKanban className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Link each request to the project or operational area it affects.
            </p>
          </div>
          <div className="flex gap-2.5">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Preserve a complete audit trail when approvals become operational.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
