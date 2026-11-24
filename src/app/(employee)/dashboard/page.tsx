import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowUpRight,
  CheckCircle2,
  FolderKanban,
  ListTodo,
  Plus,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { ActivityTimeline } from "@/components/employee/ActivityTimeline";
import { AssistantWorkspace } from "@/components/employee/AssistantWorkspace";
import { Avatar } from "@/components/employee/Avatar";
import { MetricCard } from "@/components/employee/MetricCard";
import { PageHeader } from "@/components/employee/PageHeader";
import { PreviewButton } from "@/components/employee/PreviewButton";
import { ProgressBar } from "@/components/employee/ProgressBar";
import { SectionCard } from "@/components/employee/SectionCard";
import { StatusBadge } from "@/components/employee/StatusBadge";
import { requireEmployee } from "@/lib/employee/access";
import { hasPermission } from "@/lib/employee/roles";
import { getEmployeeCompanyData } from "@/lib/employee/workspaceData";
import { projectStatusTone, taskPriorityTone } from "@/lib/employee/operationalTypes";

export const metadata: Metadata = {
  title: "Overview",
};

const metricIcons: LucideIcon[] = [FolderKanban, ListTodo, ShieldCheck, CheckCircle2];

function countLabel(value: number): string {
  return String(value).padStart(2, "0");
}

export default async function DashboardPage() {
  const { user } = await requireEmployee();
  const { projects, tasks, approvals, activities } = await getEmployeeCompanyData();
  const canReviewApprovals = hasPermission(user.role, "approvals:review");

  const activeProjects = projects.filter((project) => project.status === "active").length;
  const blockedProjects = projects.filter((project) => project.status === "blocked").length;
  const openTasks = tasks.filter((task) => task.status !== "done").length;
  const highPriorityTasks = tasks.filter(
    (task) => task.priority === "high" && task.status !== "done"
  ).length;
  const completedTasks = tasks.filter((task) => task.status === "done").length;
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const myTasks = tasks
    .filter(
      (task) =>
        task.assigneeId === user.id || (!task.assigneeId && task.assignee === user.name)
    )
    .slice(0, 4);

  const metrics = [
    {
      label: "Active projects",
      value: countLabel(activeProjects),
      hint: `${blockedProjects} blocked`,
      tone: "teal" as const,
    },
    {
      label: "Open tasks",
      value: countLabel(openTasks),
      hint: `${highPriorityTasks} high priority`,
      tone: "blue" as const,
    },
    {
      label: "Pending approvals",
      value: countLabel(pendingApprovals.length),
      hint: `${approvals.length} visible requests`,
      tone: "amber" as const,
    },
    {
      label: "Completed tasks",
      value: countLabel(completedTasks),
      hint: `Across ${projects.length} projects`,
      tone: "violet" as const,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Company overview"
        title={`Good morning, ${user.name.split(" ")[0] ?? user.name}`}
        description="A concentrated view of delivery health, work in progress, approvals, and recent operational activity."
        actions={
          <>
            <PreviewButton icon={Plus}>New project</PreviewButton>
            <Link
              href="/assistant"
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground shadow-xs transition-colors hover:bg-primary-hover"
            >
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              Ask assistant
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric, index) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            hint={metric.hint}
            icon={metricIcons[index] ?? FolderKanban}
            tone={metric.tone}
          />
        ))}
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="Active projects"
          description="Live portfolio snapshot from records available to your account."
          className="xl:col-span-2"
          action={
            <Link
              href="/projects"
              className="inline-flex items-center gap-1 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
            >
              View all
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {projects.slice(0, 4).map((project) => (
              <div
                key={project.id}
                className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-muted-foreground">{project.code}</span>
                    <StatusBadge tone={projectStatusTone(project.status)}>
                      {project.statusLabel}
                    </StatusBadge>
                  </div>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">{project.name}</p>
                </div>
                <div className="flex min-w-0 items-center gap-4 sm:w-[52%]">
                  <ProgressBar value={project.progress} className="flex-1" />
                  <Avatar name={project.owner} size="sm" />
                  <span className="hidden w-20 shrink-0 text-right text-[11px] text-muted-foreground sm:block">
                    {project.updated}
                  </span>
                </div>
              </div>
            ))}
            {projects.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No projects are available to this account.
              </p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="AI Operations Assistant"
          description="Ask about portfolio risk, pending work, and review queues."
          bodyClassName="p-3 sm:p-3"
        >
          <AssistantWorkspace compact />
        </SectionCard>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <SectionCard
          title="My tasks"
          description="Tasks assigned to you or owned by you in the accessible company records."
          className="xl:col-span-2"
          action={
            <Link
              href="/tasks"
              className="inline-flex items-center gap-1 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
            >
              Open task queue
              <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {myTasks.map((task) => (
              <div key={task.id} className="flex items-center justify-between gap-4 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground">{task.code}</p>
                  <p className="mt-0.5 truncate text-sm font-medium text-foreground">{task.title}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusBadge tone={taskPriorityTone(task.priority)}>
                    {task.priorityLabel}
                  </StatusBadge>
                  <span className="hidden text-xs text-muted-foreground sm:block">{task.updated}</span>
                </div>
              </div>
            ))}
            {myTasks.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No tasks are assigned to you.
              </p>
            ) : null}
          </div>
        </SectionCard>

        <SectionCard
          title="Pending approvals"
          description="Requests awaiting review."
          action={
            canReviewApprovals ? (
              <Link
                href="/approvals"
                className="inline-flex items-center gap-1 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
              >
                Review
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            ) : undefined
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-border">
            {pendingApprovals.slice(0, 3).map((approval) => (
              <div key={approval.id} className="px-4 py-3 sm:px-5">
                <p className="text-sm font-medium leading-snug text-foreground">{approval.title}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {approval.type} · {approval.submitted}
                </p>
              </div>
            ))}
            {pendingApprovals.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No pending approvals.
              </p>
            ) : null}
          </div>
        </SectionCard>
      </div>

      <SectionCard
        title="Recent project activity"
        description="Latest approval and tool activity available to your account."
        action={
          <Link
            href="/activity"
            className="inline-flex items-center gap-1 text-xs font-semibold text-action-teal hover:underline dark:text-[#7FD9E2]"
          >
            Full timeline
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        }
      >
        {activities.length > 0 ? (
          <ActivityTimeline items={activities.slice(0, 5)} compact />
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No recent activity is available.
          </p>
        )}
      </SectionCard>
    </div>
  );
}
