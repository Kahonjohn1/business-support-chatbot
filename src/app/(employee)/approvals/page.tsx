import type { Metadata } from "next";
import { AlertTriangle, Check, Clock, FolderKanban, MessageSquare, ShieldCheck } from "lucide-react";
import { AvatarWithName } from "@/components/employee/Avatar";
import { ApprovalDecisionActions } from "@/components/employee/ApprovalDecisionActions";
import { PageHeader } from "@/components/employee/PageHeader";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { requirePermission } from "@/lib/employee/access";
import {
  approvalStatusTone,
  getApprovalQueue,
  getEmployeeCompanyRole,
  type ApprovalRecord,
} from "@/lib/employee/reviewData";

export const metadata: Metadata = {
  title: "Approvals",
};

export default async function ApprovalsPage() {
  const session = await requirePermission("approvals:review");
  const [approvals, companyRole] = await Promise.all([
    getApprovalQueue(),
    getEmployeeCompanyRole(session.user.id),
  ]);
  const canDecide = companyRole === "owner" || companyRole === "admin";

  const pending = approvals.filter((approval) => approval.status === "pending");
  const decidedThisWeek = approvals.filter((approval) => approval.decidedRecently).length;
  const oldestPending = pending.reduce<ApprovalRecord | null>((oldest, approval) => {
    if (!oldest) return approval;
    return new Date(approval.createdAt) < new Date(oldest.createdAt) ? approval : oldest;
  }, null);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Review queue"
        title="Approvals"
        description="Company approval requests available to your account, with decisions recorded through the database approval workflow."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Awaiting review</p>
            <Clock className="h-4 w-4 text-[#A15C0B]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(pending.length).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {new Set(pending.map((approval) => approval.toolName)).size} request tools
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Oldest pending</p>
            <AlertTriangle className="h-4 w-4 text-[#A15C0B]" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {oldestPending ? `${oldestPending.ageDays}d` : "—"}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {oldestPending?.toolName ?? "No pending requests"}
          </p>
        </div>
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Decided this week</p>
            <Check className="h-4 w-4 text-action-teal" aria-hidden="true" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-foreground">
            {String(decidedThisWeek).padStart(2, "0")}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground">Based on decision timestamps</p>
        </div>
      </div>

      <SectionCard
        title="Approval requests"
        description="Live records from the company approvals table."
        bodyClassName="p-3 sm:p-4"
      >
        <div className="space-y-3">
          {approvals.map((approval) => (
            <article
              key={approval.id}
              className="rounded-xl border border-border bg-background p-4"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={approvalStatusTone(approval.status)}>
                      {approval.statusLabel}
                    </StatusBadge>
                    <span className="text-[11px] font-medium text-muted-foreground">
                      {approval.ref}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {approval.toolName}
                    </span>
                  </div>
                  <h3 className="mt-2 text-sm font-semibold leading-snug text-foreground">
                    {approval.summary}
                  </h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Request {approval.requestId}
                  </p>

                  <div className="mt-3 grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                    <p>Submitted {approval.createdLabel}</p>
                    <p>Expires {approval.expiresLabel}</p>
                    <p>Decision {approval.decisionLabel}</p>
                    <p>Execution {approval.executionLabel}</p>
                    {approval.conversationId ? <p>Conversation {approval.conversationId}</p> : null}
                    {approval.taskId ? <p>Task {approval.taskId}</p> : null}
                    {approval.failureReason ? (
                      <p className="text-danger">Failure: {approval.failureReason}</p>
                    ) : null}
                  </div>

                  {approval.rawArguments ? (
                    <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed text-foreground">
                      {approval.rawArguments}
                    </pre>
                  ) : null}
                  <pre className="mt-3 overflow-x-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed text-muted-foreground">
                    {approval.detailsLabel}
                  </pre>

                  <div className="mt-3">
                    <AvatarWithName
                      name={approval.requesterLabel}
                      meta={`Requested by user ${approval.requestedBy ?? "unknown"}`}
                    />
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-stretch gap-2">
                  {approval.status === "pending" && canDecide ? (
                    <ApprovalDecisionActions
                      approvalId={approval.id}
                      approvalRef={approval.ref}
                    />
                  ) : null}
                  {approval.status === "pending" && !canDecide ? (
                    <p className="max-w-xs text-right text-[11px] text-muted-foreground">
                      Decisions require a company owner or admin role.
                    </p>
                  ) : null}
                </div>
              </div>
            </article>
          ))}
          {approvals.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No approval requests are available to this account.
            </p>
          ) : null}
        </div>
      </SectionCard>

      <SectionCard title="Decision handling" bodyClassName="p-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex gap-2.5">
            <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Approve and reject actions call the existing decision procedure for the selected
              approval.
            </p>
          </div>
          <div className="flex gap-2.5">
            <FolderKanban className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Decision user and decision time are written by the database procedure, not by the
              browser.
            </p>
          </div>
          <div className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-action-teal" aria-hidden="true" />
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Employee review permission and company membership are both checked before a decision
              is recorded.
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
